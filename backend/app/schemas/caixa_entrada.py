"""Schemas da Caixa de Entrada."""
from datetime import date

from pydantic import BaseModel, ConfigDict


class CaixaEntradaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    id_relatorio: str | None = None
    numero_sei: str | None = None
    id_procedimento: str | None = None
    razao_social: str | None = None
    agente_regulado: str | None = None
    segmento: str | None = None
    tipo_documento: str | None = None
    cnpj_cpf: str | None = None
    municipio: str | None = None
    superintendencia: str | None = None
    total_apontamentos: int | None = None
    total_itens_avaliados: int | None = None
    data_recebimento: date | None = None
    data_remetido: date | None = None
    status_triagem: str | None = None
    numero_processo_sei: str | None = None
    id_procedimento_processo: str | None = None
    data_instauracao: date | None = None
    #: Priorização (★) da Coordenação — destaque e ordenação em todas as telas.
    prioritario: bool = False
    prioridade_justificativa: str | None = None
