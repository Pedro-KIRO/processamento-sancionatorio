"""Schemas da tela de textos-padrão (edição pelo coordenador)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator


class TextoPadraoResumo(BaseModel):
    """Uma linha da lista. Sem o HTML, que é grande e só serve na edição."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    agente_regulado: str
    funcao: str
    funcao_titulo: str
    rotulo: str
    nome_arvore: str | None = None
    padrao: bool = False
    editado: bool = False
    editado_em: datetime | None = None
    editado_por: str | None = None
    #: O texto oficial mudou no SEI depois da edição feita aqui.
    divergente_do_original: bool = False


class TextoPadraoDetalhe(TextoPadraoResumo):
    """A linha com os dois textos, para editar e comparar com o original."""

    template_html: str
    html_original: str | None = None


class FuncaoResumo(BaseModel):
    """Função do documento, para o filtro da tela."""

    funcao: str
    titulo: str
    quantidade: int


class TextoPadraoUpdate(BaseModel):
    template_html: str

    @field_validator("template_html")
    @classmethod
    def _nao_vazio(cls, valor: str) -> str:
        # Um modelo vazio geraria documento em branco no SEI, e o erro só
        # apareceria no processo do agente.
        if not valor or not valor.strip():
            raise ValueError("O texto do modelo não pode ficar vazio.")
        return valor
