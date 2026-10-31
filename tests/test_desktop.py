"""Contrato desktop: arquivos locais e adaptação HTTP, sem duplicar regras de negócio."""
import base64
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse
from backend.desktop import DesktopFrontend, api_path

async def echo(scope,receive,send):
    body=b''
    while True:
        event=await receive();body+=event.get('body',b'')
        if not event.get('more_body'):break
    await JSONResponse({'path':scope['path'],'query':scope['query_string'].decode(),'body':base64.b64encode(body).decode(),'headers':dict((k.decode(),v.decode()) for k,v in scope['headers'])},status_code=201)(scope,receive,send)

class TestDesktop(unittest.TestCase):
    def setUp(self):
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup);self.folder=Path(folder.name)
        (self.folder/'index.html').write_text('<html>Ponto Docente</html>')
        (self.folder/'app.js').write_text('console.log(1)')
        (self.folder/'.env').write_text('segredo')
        self.client=TestClient(DesktopFrontend(echo,self.folder))

    def test_mapeamento_contrato_existente(self):
        cases=[('/api/servers','GET','/servidores'),('/api/servers/12','PUT','/servidores/12'),('/api/servers/import/preview','POST','/servidores/importar/preview'),('/api/timesheets/5/file','GET','/folhas/5/arquivo'),('/api/timesheets/5/pages/2/import','POST','/folhas/5/paginas/2/importar'),('/api/system/lock/renew','POST','/sistema/lock/renovar'),('/api/email-account','DELETE','/emails/conta'),('/api/emails/retry','POST','/emails/reenviar-erros'),('/api/academic/folhas/geradas/5/download','GET','/folhas/geradas/5/download'),('/api/academic/datas-especiais/importar/confirm','POST','/datas-especiais/importar/confirm')]
        for path,method,target in cases:self.assertEqual(api_path(path,method),target)
        for path in ['/api/academic/../servidores','/api/servers/abc','/api/system/lock/destruir']:
            self.assertIsNone(api_path(path,'GET'))

    def test_preserva_corpo_query_headers_sem_proxy_intermediario(self):
        body=b'--boundary\r\nconteudo\x00\xff'
        result=self.client.post('/api/timesheets/upload?substituir=true',content=body,headers={'content-type':'multipart/form-data; boundary=boundary','Idempotency-Key':'chave','X-Client-Id':'cliente','X-Email-Client-Id':'conta','If-Match':'versao'})
        self.assertEqual(result.status_code,201);data=result.json()
        self.assertEqual(data['path'],'/folhas/upload');self.assertEqual(data['query'],'substituir=true')
        self.assertEqual(base64.b64decode(data['body']),body)
        for key,value in [('idempotency-key','chave'),('x-client-id','cliente'),('x-email-client-id','conta'),('if-match','versao')]:self.assertEqual(data['headers'][key],value)

    def test_index_assets_sem_fallback_para_erros(self):
        self.assertEqual(self.client.get('/').status_code,200)
        self.assertEqual(self.client.get('/app.js').status_code,200)
        for path in ['/assets/ausente.js','/.env','/api/nao-existe','/nao-existe']:
            self.assertEqual(self.client.get(path).status_code,404,path)
        self.assertEqual(self.client.get('/_ponto/health').json()['frontend'],'static')

    def test_conta_email_requer_https_ou_loopback(self):
        self.assertEqual(self.client.post('/api/email-account',json={},headers={'origin':'http://192.168.1.10'}).status_code,400)
        self.assertEqual(self.client.post('/api/email-account',json={},headers={'origin':'https://equipe.local'}).status_code,201)
        self.assertEqual(self.client.post('/api/email-account',json={},headers={'origin':'http://localhost:5173'}).status_code,201)

    def test_sem_frontend_nao_inicia(self):
        with self.assertRaisesRegex(RuntimeError,'Frontend desktop ausente'):DesktopFrontend(echo,self.folder/'ausente')
