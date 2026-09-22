import asyncio
from io import BytesIO
from pathlib import Path
import unittest
from unittest.mock import patch
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from backend.api import salvar_planilha_temporaria, salvar_upload_temporario


class TestUploads(unittest.TestCase):
    def test_xlsx_e_salvo_e_xls_recusado(self):
        arquivo = UploadFile(filename='professores.xlsx', file=BytesIO(b'planilha'))
        path = asyncio.run(salvar_planilha_temporaria(arquivo))
        try:
            self.assertEqual(path.read_bytes(), b'planilha')
        finally:
            path.unlink()
        with self.assertRaises(HTTPException) as error:
            asyncio.run(salvar_planilha_temporaria(UploadFile(filename='professores.xls', file=BytesIO(b'antigo'))))
        self.assertEqual(error.exception.status_code, 400)

    def test_limite_upload_em_ambos_endpoints(self):
        for save, filename, mime in ((salvar_planilha_temporaria, 'professores.xlsx', 'application/octet-stream'), (salvar_upload_temporario, 'folha.pdf', 'application/pdf')):
            with self.subTest(filename=filename), patch('backend.api.LIMITE_UPLOAD', 4):
                file = UploadFile(filename=filename, file=BytesIO(b'12345'), headers=Headers({'content-type': mime}))
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(save(file))
                self.assertEqual(error.exception.status_code, 413)
                file = UploadFile(filename=filename, file=BytesIO(b'1234'), headers=Headers({'content-type': mime}))
                path = asyncio.run(save(file))
                self.assertEqual(Path(path).read_bytes(), b'1234')
                path.unlink()
