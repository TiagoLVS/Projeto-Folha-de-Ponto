"""Conta SMTP persistida com criptografia, isolada por instalação cliente."""
import os
import smtplib
import ssl
import socket
from contextvars import ContextVar
from dataclasses import dataclass, field
from backend.database import conta_email as armazenamento
from uuid import UUID

CLIENTE_HTTP = ContextVar('cliente_email_http', default=None)

@dataclass(frozen=True)
class Conta:
    email: str
    senha: str = field(repr=False)
    host: str
    porta: int
    seguranca: str


def modo_teste():
    return os.getenv('DIGEP_MODO_TESTE','true').lower() == 'true'


def cliente(value):
    try:return str(UUID(value)) if value else ''
    except (ValueError,TypeError,AttributeError):return ''


def obter(identifier=None):
    identifier=cliente(identifier if identifier is not None else CLIENTE_HTTP.get())
    if not identifier:return None
    data=armazenamento.obter(identifier)
    return Conta(**data) if data else None


def guardar(identifier,conta):
    identifier=cliente(identifier)
    if not identifier:raise ValueError('Abra o sistema novamente para conectar sua conta.')
    armazenamento.guardar(identifier,dict(email=conta.email,senha=conta.senha,host=conta.host,porta=conta.porta,seguranca=conta.seguranca))


def desconectar(identifier):
    identifier=cliente(identifier)
    if identifier:armazenamento.desconectar(identifier)


def transporte():
    conta=obter() if not modo_teste() else None
    if conta:return conta.host,conta.porta,conta.seguranca,conta.email
    if not modo_teste() and CLIENTE_HTTP.get() is not None:
        raise RuntimeError('Conecte sua conta de e-mail para enviar folhas.')
    try:
        host=os.getenv('SMTP_HOST','smtp.gmail.com').strip()
        port=int(os.getenv('SMTP_PORT','465'))
        security=os.getenv('SMTP_SECURITY','ssl').lower()
        if not host or not 1<=port<=65535 or security not in ('ssl','starttls'):raise ValueError
    except ValueError:raise RuntimeError('A configuração do serviço de e-mail precisa ser conferida pelo responsável.') from None
    return host,port,security,os.getenv('SMTP_USER','')


def entrar(identifier,email,senha):
    if modo_teste():raise ValueError('O sistema está em modo de teste; não é necessário conectar uma conta.')
    # Host/porta são definidos na instalação central, nunca recebidos do navegador.
    token=CLIENTE_HTTP.set(None)
    try:host,port,security,_=transporte()
    finally:CLIENTE_HTTP.reset(token)
    if host.lower() == 'smtp.gmail.com' and len(senha.replace(' ','')) == 16:
        senha=senha.replace(' ','')
    factory=smtplib.SMTP_SSL if security=='ssl' else smtplib.SMTP
    try:
        options={'timeout':15}
        if security=='ssl':options['context']=ssl.create_default_context()
        with factory(host,port,**options) as server:
            if security=='starttls':
                server.ehlo();server.starttls(context=ssl.create_default_context());server.ehlo()
            server.login(email,senha)
    except smtplib.SMTPAuthenticationError:
        raise ValueError('Não foi possível entrar nessa conta. Confira o e-mail e a senha de aplicativo/SMTP.') from None
    except socket.gaierror:
        raise ValueError('Não foi possível localizar o serviço de e-mail. Confira a conexão com a internet e tente novamente.') from None
    except (TimeoutError, socket.timeout):
        raise ValueError('O serviço de e-mail demorou para responder. A rede pode estar bloqueando a conexão; tente novamente ou use outra rede.') from None
    except ssl.SSLCertVerificationError:
        raise ValueError('Não foi possível verificar o certificado do serviço de e-mail. Confira a data e a hora do computador ou procure o responsável.') from None
    except ssl.SSLError:
        raise ValueError('Não foi possível estabelecer uma conexão segura com o serviço de e-mail. Procure o responsável para conferir a configuração.') from None
    except ConnectionRefusedError:
        raise ValueError('A conexão com o serviço de e-mail foi recusada. Procure o responsável para conferir a rede e a configuração de envio.') from None
    except Exception:
        raise ValueError('Não foi possível conectar ao serviço de e-mail. Tente novamente ou procure o responsável pelo sistema.') from None
    guardar(identifier,Conta(email,senha,host,port,security))


def estado(identifier):
    teste=modo_teste();conta=None if teste else obter(identifier)
    return dict(modo_teste=teste,conectado=bool(conta),email=conta.email if conta else None)
