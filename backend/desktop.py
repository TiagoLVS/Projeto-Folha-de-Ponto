"""Adaptador HTTP do desktop estático. Reutiliza as rotas/regras FastAPI existentes."""
import re
from pathlib import Path
from starlette.responses import JSONResponse
from starlette.staticfiles import StaticFiles

# Mesmo contrato /api usado pelos serviços compartilhados e pelos proxies Next.
ROUTES = [
    (r'/api/servers', '/servidores', {'GET', 'POST'}),
    (r'/api/servers/import/(preview|confirm)', r'/servidores/importar/\1', {'POST'}),
    (r'/api/servers/(\d+)', r'/servidores/\1', {'PUT', 'DELETE'}),
    (r'/api/email-account', '/emails/conta', {'GET', 'POST', 'DELETE'}),
    (r'/api/emails', '/emails/historico', {'GET'}),
    (r'/api/emails/retry', '/emails/reenviar-erros', {'POST'}),
    (r'/api/system/lock', '/sistema/lock', {'GET', 'DELETE'}),
    (r'/api/system/lock/acquire', '/sistema/lock/adquirir', {'POST'}),
    (r'/api/system/lock/renew', '/sistema/lock/renovar', {'POST'}),
    (r'/api/timesheets', '/folhas', {'GET'}),
    (r'/api/timesheets/upload', '/folhas/upload', {'POST'}),
    (r'/api/timesheets/send', '/folhas/enviar-lote', {'POST'}),
    (r'/api/timesheets/pending', '/folhas/pendentes', {'GET'}),
    (r'/api/timesheets/packages', '/folhas/pacotes', {'GET'}),
    (r'/api/timesheets/(\d+)', r'/folhas/\1', {'PATCH', 'DELETE'}),
    (r'/api/timesheets/(\d+)/file', r'/folhas/\1/arquivo', {'GET'}),
    (r'/api/timesheets/(\d+)/process', r'/folhas/\1/processar', {'POST'}),
    (r'/api/timesheets/(\d+)/pages/(\d+)/import', r'/folhas/\1/paginas/\2/importar', {'POST'}),
    (r'/api/academic/(datas-especiais(?:/(?:importar(?:/confirm)?|\d+))?|folhas/(?:configuracao|gerar|gerar-lote|geradas(?:/(?:download-lote|para-envio|enviar-lote|\d+(?:/download)?))?))', r'/\1', {'GET', 'POST', 'PUT', 'DELETE'}),
]


def api_path(path, method):
    for pattern, target, methods in ROUTES:
        match = re.fullmatch(pattern, path)
        if match and method in methods:
            return match.expand(target)
    return None


class DesktopFrontend:
    def __init__(self, app, directory):
        self.app = app
        self.directory = Path(directory).resolve()
        if not (self.directory / 'index.html').is_file():
            raise RuntimeError('Frontend desktop ausente. Extraia a pasta completa do aplicativo.')
        self.static = StaticFiles(directory=self.directory, html=True)

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        path, method = scope['path'], scope['method']
        if path == '/_ponto/health' and method == 'GET':
            return await JSONResponse({'api': 'ok', 'frontend': 'static'})(scope, receive, send)
        if path.startswith('/api/'):
            target = api_path(path, method)
            if not target:
                return await JSONResponse({'detail': 'Rota não encontrada.'}, status_code=404)(scope, receive, send)
            if path == '/api/email-account' and method == 'POST':
                from urllib.parse import urlparse
                origin = dict(scope.get('headers', [])).get(b'origin', b'').decode()
                parsed = urlparse(origin)
                if not (parsed.scheme == 'https' or (parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1', '::1'))):
                    return await JSONResponse({'detail': 'Use HTTPS para conectar sua conta com segurança.'}, status_code=400)(scope, receive, send)
            # Mantém corpo streaming, query, headers, status, binários, locks e idempotência.
            adapted = {**scope, 'path': target, 'raw_path': target.encode('ascii')}
            return await self.app(adapted, receive, send)
        if method in ('GET', 'HEAD'):
            candidate = self.directory / path.lstrip('/')
            if path == '/' or (candidate.is_file() and candidate.resolve().is_relative_to(self.directory)):
                if any(part.startswith('.') for part in Path(path).parts if part not in ('/', '.')):
                    return await JSONResponse({'detail': 'Arquivo não encontrado.'}, status_code=404)(scope, receive, send)
                return await self.static(scope, receive, send)
        return await JSONResponse({'detail': 'Rota não encontrada.'}, status_code=404)(scope, receive, send)
