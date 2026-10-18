from typing import Annotated
from fastapi import APIRouter, Header, Query
from pydantic import BaseModel, ConfigDict, Field
from psycopg.rows import dict_row
from backend.database import repository
from backend.services.enviar_email import enviar_folha_do_banco, validar_folha_envio
from backend.services.idempotencia import executar

router=APIRouter(prefix='/emails',tags=['Histórico de e-mail'])

@router.get('/historico')
def historico(nome:str=Query('',max_length=200),matricula:str=Query('',max_length=50),cpf:str=Query('',max_length=20),
              status:str=Query('',pattern=r'^(ENVIADO|ERRO|PROCESSANDO|NAO_CONFIGURADO)?$'),
              competencia:str=Query('',pattern=r'^(20\d{2}-(0[1-9]|1[0-2]))?$')):
    sql="""SELECT e.id_envio AS id,e.id_folha,e.id_documento,s.nome,s.matricula,s.cpf,
        CASE WHEN e.id_documento IS NULL THEN 'RECEBIDA' ELSE 'GERADA' END AS origem,
        e.email_destino,fg.versao,
        to_char(make_date(c.ano,c.mes,1),'YYYY-MM') AS competencia,
        CASE WHEN e.status_envio='PENDENTE' THEN 'PROCESSANDO' ELSE e.status_envio END AS status,
        COALESCE(e.data_envio,e.data_registro) AS criado_em,COALESCE(e.mensagem_erro,'') AS mensagem
        FROM envio e LEFT JOIN folha_ponto fp ON fp.id_folha=e.id_folha
        LEFT JOIN folha_gerada fg ON fg.id_documento=e.id_documento
        JOIN servidor s ON s.id_servidor=COALESCE(fp.id_servidor,fg.id_servidor)
        JOIN competencia c ON c.id_competencia=COALESCE(fp.id_competencia,fg.id_competencia) WHERE TRUE"""
    params=[]
    for field,value in [('s.nome',nome),('s.matricula',matricula),('s.cpf',''.join(c for c in cpf if c.isdigit()))]:
        if value: sql+=f' AND {field} ILIKE %s';params.append('%'+value+'%')
    if status: sql+=' AND e.status_envio=%s';params.append('PENDENTE' if status=='PROCESSANDO' else status)
    if competencia:
        ano,mes=map(int,competencia.split('-'));sql+=' AND c.ano=%s AND c.mes=%s';params.extend([ano,mes])
    with repository.conectar() as conn,conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql+' ORDER BY e.id_envio DESC',params);return cur.fetchall()

class Reenvio(BaseModel):
    model_config=ConfigDict(extra='forbid')
    log_ids:list[Annotated[int, Field(strict=True,gt=0,le=9223372036854775807)]]=Field(min_length=1,max_length=100)


def reenviar(ids):
    counts=dict(reenviados=0,ignorados=0,falhas=0,detalhes=[])
    seen=set()
    for identifier in ids:
        with repository.conectar() as conn,conn.cursor(row_factory=dict_row) as cur:
            cur.execute('SELECT * FROM envio WHERE id_envio=%s',(identifier,));log=cur.fetchone()
            field='id_documento' if log and log['id_documento'] is not None else 'id_folha'
            if log:
                cur.execute(f"SELECT 1 FROM envio WHERE {field}=%s AND id_envio>%s AND status_envio IN ('ENVIADO','PENDENTE')",(log[field],identifier));superseded=cur.fetchone()
            else:superseded=True
        if not log or log['status_envio']!='ERRO' or superseded or (field,log[field]) in seen:
            counts['ignorados']+=1;continue
        seen.add((field,log[field]))
        try:
            if field=='id_documento':
                from backend.services.envio_geradas import enviar_modelo
                result=enviar_modelo(log[field])
            else:
                sheet=repository.buscar_folha_para_envio(log['id_folha'])
                validar_folha_envio(sheet)
                result=enviar_folha_do_banco(sheet)
        except (ValueError,LookupError):
            counts['ignorados']+=1;continue
        counts['reenviados' if result['status']=='ENVIADO' else 'ignorados' if result['status']=='IGNORADO' else 'falhas']+=1
        counts['detalhes'].append(result)
    return counts

@router.post('/reenviar-erros')
def retry(payload:Reenvio,chave:str=Header(...,alias='Idempotency-Key',max_length=255)):
    from backend.database.repository import canonicalize_professor_ids
    from fastapi import HTTPException
    try: ids=canonicalize_professor_ids(payload.log_ids)
    except ValueError as error: raise HTTPException(422,str(error)) from error
    return executar(chave,'reenvio',{'log_ids':ids},lambda:reenviar(ids))
