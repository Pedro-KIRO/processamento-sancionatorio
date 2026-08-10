"""Schemas dos despachos SEI (Arquivar, TAC, Instaurar)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TemplateDespachoOut(BaseModel):
    """Template HTML carregado para edição no frontend."""

    html: str
    # Variantes do documento, quando existem — o termo de instauração tem a
    # versão com medida cautelar e, nos desmontes, a da lei estadual e a da
    # federal. Cada item traz "chave" e "nome".
    modelos: list[dict[str, str | bool]] = []
    # Lacunas do modelo entre colchetes, para a tela pedir os valores antes de
    # abrir o editor (mala direta) — ver app/services/mala_direta.py. Cada item
    # traz token, rotulo, tipo, opcoes, valor_sugerido, campo e preenchivel.
    marcadores: list[dict] = []


class ExecutarDespachoIn(BaseModel):
    """HTML final (editado pelo usuário) para enviar ao SEI."""

    html: str


class ExecutarInstauracaoIn(ExecutarDespachoIn):
    cautelar: bool = False
    #: Prazo da medida cautelar em dias (30, 45, 60 ou 90). Só é usado quando
    #: `cautelar` é verdadeiro. O padrão é o menor prazo: quem instaura indica a
    #: medida, e prorrogar depende de renovação pelo Coordenador Geral.
    cautelar_prazo_dias: int = 30


class ResultadoDespachoOut(BaseModel):
    numero_sei: str
    id_procedimento: str
    id_documento: str | None = None
    documento_formatado: str | None = None
    avisos: list[str] = []


class HistoricoDespachoOut(BaseModel):
    """Registro de uma tentativa de despacho (para o usuário conferir o que já foi feito)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    tipo: str
    status: str
    mensagem: str | None = None
    numero_sei_resultado: str | None = None
    id_procedimento_resultado: str | None = None
    documento_formatado: str | None = None
    avisos: str | None = None
    autor: str | None = None
    criado_em: datetime
