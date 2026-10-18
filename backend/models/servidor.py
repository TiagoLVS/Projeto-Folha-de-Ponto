import re
from pydantic import BaseModel, ConfigDict, Field, field_validator


def normalizar_cpf(value):
    if value is None or value == '':
        return None
    value = re.sub(r'[.\-\s]', '', str(value))
    if not re.fullmatch(r'[0-9]{11}', value):
        raise ValueError('CPF deve conter exatamente 11 dígitos.')
    return value


class ServidorPayload(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    name: str = Field(min_length=1, max_length=200)
    registration: str = Field(pattern=r'^[0-9]{4,16}$')
    cpf: str | None = None
    email: str = Field(max_length=255, pattern=r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
    department: str = Field(default='', max_length=200)
    workload: int | None = Field(default=None, strict=True)
    acumula_cargo: bool = Field(default=False, strict=True)

    @field_validator('workload')
    @classmethod
    def carga_permitida(cls, value):
        if value is not None and value not in (20, 40):
            raise ValueError('Carga horária deve ser 20 ou 40 horas.')
        return value
    validar_cpf = field_validator('cpf', mode='before')(normalizar_cpf)

    @field_validator('email')
    @classmethod
    def email_normalizado(cls, value):
        return value.lower()
