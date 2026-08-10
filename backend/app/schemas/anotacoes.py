"""Schemas de Anotações Internas."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AnotacaoIn(BaseModel):
    texto: str


class AnotacaoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    caixa_entrada_id: int
    autor: str | None = None
    texto: str
    criado_em: datetime
