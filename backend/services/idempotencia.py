import hashlib
import json
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from backend.database import repository


def executar(chave, operacao, payload, work):
    if not chave or not chave.strip() or len(chave)>255:
        raise HTTPException(422, 'Idempotency-Key obrigatória (até 255 caracteres).')
    key = f'{operacao}:{chave}'
    if len(key)>255:
        key = f'{operacao}:{hashlib.sha256(chave.encode()).hexdigest()}'
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    record = repository.registrar_requisicao_idempotente(key, digest, payload)
    if record['payload_hash'] != digest:
        raise HTTPException(409, 'A chave já identifica outra operação.')
    if not record['created']:
        if record['status']=='PROCESSANDO':
            raise HTTPException(409, 'A operação original ainda está em processamento. Consulte com a mesma chave.')
        if record['response_status_code']>=400:
            raise HTTPException(record['response_status_code'], record['response_body']['detail'])
        return record['response_body']
    try:
        result = jsonable_encoder(work())
    except Exception as error:
        status = error.status_code if isinstance(error,HTTPException) else 500
        message = error.detail if isinstance(error,HTTPException) else 'A operação falhou. Confira o histórico antes de repetir.'
        repository.finalizar_requisicao_idempotente(key,'ERRO',status,{'detail':message})
        if isinstance(error,HTTPException): raise
        raise HTTPException(status,message) from error
    repository.finalizar_requisicao_idempotente(key,'CONCLUIDO',200,result)
    return result
