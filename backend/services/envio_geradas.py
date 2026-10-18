"""Envio explícito de modelos em branco; usa SMTP e histórico existentes."""
from backend.config import MAX_GENERATION_BATCH
from fastapi import HTTPException
from psycopg.rows import dict_row
from backend.database import repository
from backend.services import enviar_email as smtp
from backend.services.geracao import validar_arquivo_documento


def configuracao():
    try:
        remetente,_,teste=smtp.carregar_configuracao_email()
        if not smtp.email_valido(remetente):raise RuntimeError('Remetente inválido.')
        return dict(configurado=True,modo_teste=teste,destinatario_teste=remetente if teste else None)
    except RuntimeError:
        return dict(configurado=False,modo_teste=False,destinatario_teste=None)


def buscar(cur,identifier):
    cur.execute('''SELECT fg.*,s.nome,s.email,s.matricula,
        to_char(make_date(c.ano,c.mes,1),'YYYY-MM') AS competencia,
        fg.versao=(SELECT max(x.versao) FROM folha_gerada x WHERE x.id_servidor=fg.id_servidor AND x.id_competencia=fg.id_competencia) AS recente
        FROM folha_gerada fg JOIN servidor s USING(id_servidor) JOIN competencia c USING(id_competencia)
        WHERE fg.id_documento=%s''',(identifier,))
    return cur.fetchone()


def ultimo(cur,identifier,destino,reenviar=False):
    cur.execute("""SELECT id_envio,status_envio FROM envio WHERE id_documento=%s AND lower(email_destino)=lower(%s)
        AND (status_envio='PENDENTE' OR (status_envio='ENVIADO' AND NOT %s))
        ORDER BY (status_envio='PENDENTE') DESC,id_envio DESC LIMIT 1""",(identifier,destino,reenviar))
    return cur.fetchone()


def validar(modelo,period=None):
    if not modelo:raise ValueError('Modelo não encontrado.')
    if period and modelo['competencia']!=period:raise ValueError('Modelo de outra competência.')
    if not modelo['recente']:raise ValueError('Existe uma versão mais recente para este servidor.')
    if not smtp.email_valido(modelo['email']):raise ValueError('Servidor sem e-mail válido.')
    path,_=validar_arquivo_documento(modelo)
    return path


def previa(period):
    config=configuracao();records=[]
    with repository.conectar() as conn,conn.cursor(row_factory=dict_row) as cur:
        cur.execute('''SELECT DISTINCT ON (fg.id_servidor) fg.id_documento FROM folha_gerada fg
            JOIN competencia c USING(id_competencia) WHERE to_char(make_date(c.ano,c.mes,1),'YYYY-MM')=%s
            ORDER BY fg.id_servidor,fg.versao DESC''',(period,))
        identifiers=[r['id_documento'] for r in cur.fetchall()]
        for identifier in identifiers:
            model=buscar(cur,identifier);motivo='';status=None
            try:validar(model,period)
            except (ValueError,LookupError):motivo='E-mail inválido ou PDF indisponível.'
            destino=config['destinatario_teste'] or model['email']
            apto_reenvio=not motivo
            sent=ultimo(cur,identifier,destino)
            if sent:
                status=sent['status_envio'];motivo='Já enviado.' if status=='ENVIADO' else 'Em processamento.'
                if status=='PENDENTE':apto_reenvio=False
            records.append(dict(id_documento=identifier,id_servidor=model['id_servidor'],nome=model['nome'],email=model['email'] or '',
                competencia=period,versao=model['versao'],apto=not motivo,apto_reenvio=apto_reenvio,motivo=motivo,status_envio=status))
    return {**config,'competencia':period,'limite_lote':MAX_GENERATION_BATCH,'documentos':records}


def enviar_modelo(identifier,period=None,reenviar=False):
    config=configuracao()
    if not config['configurado']:raise ValueError('Configure o remetente e as credenciais SMTP antes de enviar.')
    # Reserva curta por documento. O SMTP ocorre após gravar PENDENTE, fora da transação.
    with repository.conectar() as conn,conn.cursor(row_factory=dict_row) as cur:
        cur.execute('SELECT id_documento FROM folha_gerada WHERE id_documento=%s FOR UPDATE',(identifier,))
        if not cur.fetchone():raise ValueError('Modelo não encontrado.')
        model=buscar(cur,identifier);path=validar(model,period)
        destino=config['destinatario_teste'] or model['email'].strip()
        anterior=ultimo(cur,identifier,destino,reenviar)
        if anterior:return dict(id_documento=identifier,id_envio=anterior['id_envio'],status='IGNORADO',mensagem='Já enviado ou em processamento.')
        cur.execute("INSERT INTO envio(id_documento,email_destino,status_envio) VALUES(%s,%s,'PENDENTE') RETURNING id_envio",(identifier,destino))
        log_id=cur.fetchone()['id_envio']
    try:
        result=smtp.enviar_arquivo_registrado(log_id,model['nome'],model['email'],str(path),competencia=model['competencia'])
        return dict(id_documento=identifier,id_envio=log_id,status=result['status'],mensagem='' if result['status']=='ENVIADO' else 'Falha no envio. Confira o histórico de e-mails.')
    except Exception:
        repository.finalizar_envio(log_id,'ERRO','Não foi possível preparar ou enviar o modelo.')
        return dict(id_documento=identifier,id_envio=log_id,status='ERRO',mensagem='Falha no envio. Confira o histórico de e-mails.')


def enviar_lote(ids,period,reenviar=False):
    if not configuracao()['configurado']:raise HTTPException(422,'Configure DIGEP_EMAIL/SMTP_USER e a senha SMTP no .env antes de enviar.')
    result=dict(total=len(ids),enviados=0,ignorados=0,falhas=0,detalhes=[])
    for identifier in ids:
        try:item=enviar_modelo(identifier,period,reenviar)
        except (ValueError,LookupError) as error:item=dict(id_documento=identifier,status='ERRO',mensagem=str(error))
        result[{'ENVIADO':'enviados','IGNORADO':'ignorados','ERRO':'falhas'}[item['status']]]+=1
        result['detalhes'].append(item)
    return result
