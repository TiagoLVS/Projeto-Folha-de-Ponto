"""Integração real; configure somente FOLHA_TEST_DSN para banco descartável."""
import asyncio
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
import psycopg
import pymupdf
from backend.api import app
from backend.database import repository
from backend.services import folhas_recebidas


def request(method,url,payload=None,body=None,content_type='application/json',headers=None):
    path,_,query=url.partition('?');events=[]
    content=body if body is not None else json.dumps(payload).encode() if payload is not None else b''
    async def receive(): return {'type':'http.request','body':content,'more_body':False}
    async def send(event): events.append(event)
    asyncio.run(app({'type':'http','asgi':{'version':'3.0','spec_version':'2.4'},'http_version':'1.1','method':method,'scheme':'http','path':path,'raw_path':path.encode(),'query_string':query.encode(),'root_path':'','headers':[(b'content-type',content_type.encode())]+[(k.lower().encode(),v.encode()) for k,v in (headers or {}).items()],'server':('test',80),'client':('test',1234)},receive,send))
    start=next(e for e in events if e['type']=='http.response.start')
    data=b''.join(e.get('body',b'') for e in events if e['type']=='http.response.body')
    return start['status'],json.loads(data) if b'application/json' in dict(start['headers']).get(b'content-type',b'') else data


def pdf(pages=1):
    with pymupdf.open() as doc:
        for i in range(pages): doc.new_page().insert_text((30,30),f'Folha teste {i+1}')
        return doc.tobytes()


def multipart(file, filename='folha.pdf',fields=None,mime='application/pdf'):
    data=b''
    for key,value in (fields or {}).items():
        data+=f'--test\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode()
    data+=f'--test\r\nContent-Disposition: form-data; name="arquivo"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode()+file+b'\r\n--test--\r\n'
    return data


@unittest.skipUnless(os.getenv('FOLHA_TEST_DSN'),'Defina FOLHA_TEST_DSN para um banco de testes.')
class TestPersistencia(unittest.TestCase):
    def setUp(self):
        self.dsn=os.environ['FOLHA_TEST_DSN'];self.schema='test_'+uuid4().hex
        with psycopg.connect(self.dsn,autocommit=True) as conn: conn.execute(f'CREATE SCHEMA {self.schema}')
        self.addCleanup(self.drop_schema)
        context=patch.object(repository,'conectar',self.connect);context.start();self.addCleanup(context.stop)
        with self.connect() as conn: conn.execute(Path('database/folha_pontos.sql').read_text())
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup);self.folder=Path(folder.name)
        context=patch.object(folhas_recebidas,'PASTA_FOLHAS',self.folder);context.start();self.addCleanup(context.stop)
        context=patch.dict(os.environ,DIGEP_EMAIL='digep@example.com',DIGEP_SENHA_APP='test-only',DIGEP_MODO_TESTE='false',SMTP_USER='',SMTP_PASSWORD='');context.start();self.addCleanup(context.stop)
        context=patch('backend.services.enviar_email.enviar_email',return_value=('ENVIADO','',None));self.smtp=context.start();self.addCleanup(context.stop)
        self.payload=dict(name='Ana',registration='12345',cpf='001.234.567-89',email='ANA@EXEMPLO.COM',department='Ensino',workload=40)

    def connect(self): return psycopg.connect(self.dsn,options=f'-c search_path={self.schema}')
    def drop_schema(self):
        with psycopg.connect(self.dsn,autocommit=True) as conn: conn.execute(f'DROP SCHEMA {self.schema} CASCADE')

    def professor(self,registration='12345'):
        status,data=request('POST','/servidores',{**self.payload,'registration':registration,'cpf':registration.zfill(11)})
        self.assertEqual(status,201,data);return data['id_servidor']

    def upload(self,person,period='2026-09',content=None,overwrite=None,key=None):
        fields={'id_servidor':person,'competencia':period,'sobrescrever':'true' if overwrite else 'false'}
        if overwrite: fields['id_folha_existente']=overwrite
        return request('POST','/folhas/upload',body=multipart(content if content is not None else pdf(),fields=fields),content_type='multipart/form-data; boundary=test',headers={'Idempotency-Key':key or uuid4().hex})

    def test_crud_cpf_e_exclusao_protegida(self):
        self.assertEqual(request('GET','/servidores'),(200,[]))
        first=self.professor();second=self.professor('67890')
        payload={**self.payload,'registration':'54321','cpf':'00000012345','name':' Ana Atualizada ','workload':20}
        status,updated=request('PUT',f'/servidores/{first}',payload)
        self.assertEqual(status,200);self.assertEqual(updated['nome'],'Ana Atualizada');self.assertEqual(updated['cpf'],'00000012345')
        self.assertEqual(request('POST','/servidores',{**payload,'registration':'99999'})[0],409)
        self.assertEqual(request('POST','/servidores',{**payload,'cpf':None})[0],422)
        self.assertEqual(request('PUT',f'/servidores/{second}',{**payload,'registration':'67890'})[0],409)
        self.assertEqual(request('DELETE',f'/servidores/{second}'),(204,b''))
        self.assertEqual(request('DELETE',f'/servidores/{second}')[0],404)
        self.upload(first)
        self.assertEqual(request('DELETE',f'/servidores/{first}')[0],409)

    def test_legado_sem_cpf_pode_ser_corrigido(self):
        with self.connect() as conn:
            identifier=conn.execute("INSERT INTO servidor(nome,matricula,email) VALUES('Legado','55555','a@example.com') RETURNING id_servidor").fetchone()[0]
        payload={**self.payload,'registration':'55555','cpf':None}
        self.assertEqual(request('PUT',f'/servidores/{identifier}',payload)[0],200)
        self.assertEqual(request('PUT',f'/servidores/{identifier}',{**payload,'cpf':'001.234.567-89'})[1]['cpf'],'00123456789')

    def test_confirmacao_correcao_envio_idempotente_e_historico(self):
        person=self.professor();identifier=self.upload(person)[1]['id_folha']
        status,saved=request('PATCH',f'/folhas/{identifier}',dict(id_servidor=person,competencia='2026-09'))
        self.assertEqual(status,200,saved);self.assertTrue(saved['confirmado_em']);self.assertEqual(saved['envio']['status'],'ENVIADO')
        self.assertEqual(self.smtp.call_count,1)
        request('PATCH',f'/folhas/{identifier}',dict(id_servidor=person,competencia='2026-09'))
        self.assertEqual(self.smtp.call_count,1)
        records=request('GET',f'/folhas?id_servidor={person}')[1]
        self.assertEqual(records[0]['envio']['status'],'ENVIADO');self.assertEqual(records[0]['id_folha'],identifier)
        other=self.professor('67890')
        self.assertEqual(request('PATCH',f'/folhas/{identifier}',dict(id_servidor=other,competencia='2026-10'))[0],200)
        self.assertEqual(request('GET',f'/folhas?id_servidor={person}')[1],[])
        self.assertEqual(repository.listar_folhas_para_envio(2026,10,[other])[0]['id_folha'],identifier)

    def test_conflito_e_OLD_com_invalidacao_da_nova_versao(self):
        person=self.professor();original=pdf();old=self.upload(person,content=original)[1]
        request('PATCH',f'/folhas/{old["id_folha"]}',dict(id_servidor=person,competencia='2026-09'))
        self.assertEqual(self.upload(person)[0],409)
        status,new=self.upload(person,content=pdf(2),overwrite=old['id_folha'])
        self.assertEqual(status,201,new);self.assertNotEqual(new['id_folha'],old['id_folha'])
        self.assertEqual(new['status_ocr'],'REVISAR');self.assertIsNone(new['confirmado_em']);self.assertIsNone(new['envio'])
        backups=list(self.folder.rglob('*_OLD_*.pdf'));self.assertEqual(len(backups),1);self.assertEqual(backups[0].read_bytes(),original)
        self.assertEqual(request('GET',f'/folhas/{old["id_folha"]}/arquivo')[0],404)
        self.assertEqual(len(request('GET','/folhas')[1]),1)
        self.assertEqual(request('DELETE',f'/folhas/{new["id_folha"]}'),(204,b''))
        self.assertEqual(request('GET','/folhas')[1],[])

    def test_upload_idempotente_e_validacao_pdf(self):
        person=self.professor();content=pdf();key=uuid4().hex
        first=self.upload(person,content=content,key=key)
        self.assertEqual(self.upload(person,content=content,key=key),first)
        self.assertEqual(self.upload(person,content=b'%PDF-nao-pode-abrir')[0],422)
        self.assertEqual(self.upload(person,period='2026-13')[0],422)
        self.assertEqual(request('POST','/folhas/upload',body=multipart(b'image',filename='imagem.png',fields={'id_servidor':person,'competencia':'2026-09'},mime='image/png'),content_type='multipart/form-data; boundary=test',headers={'Idempotency-Key':'nao-pdf'})[0],400)

    def test_download_e_nomes_seguros(self):
        person=self.professor();doc=self.upload(person)[1]
        self.assertTrue(request('GET',f'/folhas/{doc["id_folha"]}/arquivo')[1].startswith(b'%PDF'))
        self.assertEqual(folhas_recebidas.sanitizar_nome('../../João \\ Silva /:*?'), 'Joao_Silva')
        with self.connect() as conn: conn.execute('UPDATE folha_ponto SET caminho_arquivo=%s WHERE id_folha=%s',('/etc/passwd',doc['id_folha']))
        self.assertEqual(request('GET',f'/folhas/{doc["id_folha"]}/arquivo')[0],404)

    def test_download_aberto_preserva_revisao_durante_substituicao(self):
        person=self.professor();content=pdf();old=self.upload(person,content=content)[1]
        file,name=folhas_recebidas.abrir_download(old['id_folha'])
        try:
            self.assertEqual(self.upload(person,content=pdf(2),overwrite=old['id_folha'])[0],201)
            self.assertEqual(file.read(),content)
        finally:
            file.close()

    def test_folha_legada_sem_vinculo_pode_ser_confirmada(self):
        person=self.professor();path=self.folder/'legada.pdf';path.write_bytes(pdf())
        with self.connect() as conn:
            identifier=conn.execute("INSERT INTO folha_ponto(caminho_arquivo,nome_arquivo,status_ocr) VALUES(%s,'legada.pdf','REVISAR') RETURNING id_folha",(str(path),)).fetchone()[0]
        self.assertIn(identifier,[row['id_folha'] for row in request('GET','/folhas/pendentes')[1]])
        status,result=request('PATCH',f'/folhas/{identifier}',dict(id_servidor=person,competencia='2026-09'))
        self.assertEqual(status,200,result)
        self.assertEqual(result['id_servidor'],person)
        self.assertTrue(result['confirmado_em'])
        self.assertNotIn(identifier,[row['id_folha'] for row in request('GET','/folhas/pendentes')[1]])

    def test_multipagina_duplicidades_e_importacao_por_pagina(self):
        person=self.professor();identifier=self.upload(person,content=pdf(2))[1]['id_folha']
        ocr=dict(matricula='12345',mes=9,ano=2026,competencia='2026-09',texto='Teste')
        with patch.object(folhas_recebidas,'executar_ocr',return_value=ocr) as reader:
            status,result=request('POST',f'/folhas/{identifier}/processar')
        self.assertEqual(status,200,result);self.assertEqual(reader.call_count,2)
        self.assertEqual(result['status_ocr'],'REVISAR');self.assertTrue(result['paginas'][1]['duplicidade'])
        self.assertEqual(request('PATCH',f'/folhas/{identifier}',dict(id_servidor=person,competencia='2026-09'))[0],422)
        status,single=request('POST',f'/folhas/{identifier}/paginas/1/importar',dict(id_servidor=person,competencia='2026-09',sobrescrever=True,id_folha_existente=identifier),headers={'Idempotency-Key':'pagina1'})
        self.assertEqual(status,201,single)
        content=request('GET',f'/folhas/{single["id_folha"]}/arquivo')[1]
        with pymupdf.open(stream=content,filetype='pdf') as doc: self.assertEqual(len(doc),1)
        self.assertEqual(request('GET','/folhas/pacotes')[1][0]['paginas'][0]['importado_id'],single['id_folha'])

    def test_rollback_preserva_original(self):
        person=self.professor();old=self.upload(person)[1]
        original=request('GET',f'/folhas/{old["id_folha"]}/arquivo')[1]
        with patch.object(folhas_recebidas.Arquivos,'gravar',side_effect=OSError('Erro simulado')):
            with self.assertRaises(OSError): folhas_recebidas.salvar_upload(self.folder/'Folhas_2026-09'/old['nome_arquivo'],person,'2026-09',True,old['id_folha'])
        self.assertEqual(request('GET',f'/folhas/{old["id_folha"]}/arquivo')[1],original)
        self.assertEqual(list(self.folder.rglob('*_OLD_*.pdf')),[])
