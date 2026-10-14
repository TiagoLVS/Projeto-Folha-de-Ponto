import calendar
import re
import unicodedata
from datetime import date, datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class TipoData(str, Enum):
    FERIADO = 'FERIADO'
    RECESSO = 'RECESSO'
    PONTO_FACULTATIVO = 'PONTO_FACULTATIVO'
    OUTRO = 'OUTRO'


class DataEspecialPayload(BaseModel):
    model_config = ConfigDict(extra='forbid')
    data: date
    especificacao: str = Field(min_length=1, max_length=300)
    tipo: TipoData = TipoData.OUTRO

    @field_validator('data', mode='before')
    @classmethod
    def validar_data(cls, value):
        if isinstance(value, datetime) or isinstance(value, (float, int, bool)):
            raise ValueError('Informe uma data no formato AAAA-MM-DD.')
        if isinstance(value, str) and not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
            raise ValueError('Informe uma data no formato AAAA-MM-DD.')
        return value

    @field_validator('especificacao', mode='before')
    @classmethod
    def limpar_texto(cls, value):
        if not isinstance(value, str):
            raise ValueError('Especificação deve ser um texto.')
        return unicodedata.normalize('NFC', ' '.join(value.split()))


class FiltrosCalendario(BaseModel):
    ano: int | None = Field(default=None, ge=1, le=9999)
    mes: int | None = Field(default=None, ge=1, le=12)
    tipo: TipoData | None = None
    inicio: date | None = None
    fim: date | None = None

    @model_validator(mode='after')
    def validar_periodo(self):
        if self.mes and not self.ano:
            raise ValueError('Informe o ano ao filtrar por mês.')
        if self.inicio and self.fim and self.inicio > self.fim:
            raise ValueError('A data inicial deve ser anterior à final.')
        return self

    def limites(self):
        inicio, fim = self.inicio, self.fim
        if self.ano:
            first = date(self.ano, self.mes or 1, 1)
            month = self.mes or 12
            last = date(self.ano, month, calendar.monthrange(self.ano, month)[1])
            inicio = max(inicio, first) if inicio else first
            fim = min(fim, last) if fim else last
        return inicio, fim


class GeracaoPayload(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id_servidor: int = Field(gt=0, strict=True, le=9223372036854775807)
    competencia: str = Field(pattern=r'^20\d{2}-(0[1-9]|1[0-2])$')
    nova_versao: bool = False


class GeracaoLotePayload(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ids_servidores: list[int] = Field(min_length=1, max_length=100)
    competencia: str = Field(pattern=r'^20\d{2}-(0[1-9]|1[0-2])$')
    nova_versao: bool = False

    @field_validator('ids_servidores', mode='before')
    @classmethod
    def validar_ids(cls, value):
        if not isinstance(value, list) or any(type(i) is not int or not 0 < i <= 9223372036854775807 for i in value):
            raise ValueError('Informe IDs inteiros positivos.')
        if len(set(value)) != len(value):
            raise ValueError('IDs repetidos no lote.')
        return value


class DownloadLotePayload(BaseModel):
    model_config = ConfigDict(extra='forbid')
    ids_documentos: list[int] = Field(min_length=1, max_length=100)
    validar_ids = field_validator('ids_documentos', mode='before')(GeracaoLotePayload.validar_ids.__func__)
