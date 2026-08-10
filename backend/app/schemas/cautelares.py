"""Schemas Pydantic para medidas cautelares (Documentação de Negócio v3.0)."""
from datetime import date, datetime

from pydantic import BaseModel


class CautelarCreate(BaseModel):
    #: Um dos dois vínculos é obrigatório. `caixa_entrada_id` é o do fluxo real
    #: do app; `processo_id` fica para a base migrada do SharePoint.
    processo_id: int | None = None
    caixa_entrada_id: int | None = None
    agente_id: int | None = None
    tipo: str
    prazo_dias: int  # 30, 45, 60 ou 90
    data_inicio: date
    fundamentacao: str | None = None
    unidade_responsavel: str | None = None


class CautelarRenovar(BaseModel):
    prazo_dias: int  # novo prazo: 30, 45, 60 ou 90


class CautelarRecusar(BaseModel):
    """Recusa da cautelar pelo Coordenador Geral."""
    motivo: str


class CautelarRevogar(BaseModel):
    """Revogação da medida, normalmente após análise da defesa."""
    motivo: str


class CautelarOut(BaseModel):
    id: int
    processo_id: int | None
    caixa_entrada_id: int | None = None
    agente_id: int | None
    tipo: str | None
    data_inicio: date | None
    data_fim: date | None
    prazo_dias: int | None
    situacao: str | None
    fundamentacao: str | None
    unidade_responsavel: str | None
    numero_sei_certidao: str | None
    renovada_de_id: int | None
    criado_em: datetime | None

    # Concordância do Coordenador Geral
    aprovacao: str | None = None
    aprovada_por: str | None = None
    motivo_recusa: str | None = None
    pendente_assinatura: bool = False
    link_bloco_sei: str | None = None

    # Revogação
    data_revogacao: date | None = None
    revogada_por: str | None = None
    motivo_revogacao: str | None = None
    numero_sei_certidao_desbloqueio: str | None = None

    # Campos computados no endpoint
    dias_restantes: int | None = None
    #: verde | amarelo | vermelho — mesmo semáforo da tela de prazos.
    semaforo: str | None = None
    #: ativo | revisar | revogado — estado do bloqueio do agente.
    status_bloqueio: str | None = None
    #: ⚑ Agente bloqueado apresentou defesa: exige revisão imediata da medida.
    defesa_apresentada: bool = False
    numero_sei_processo: str | None = None
    razao_social: str | None = None
    cnpj_cpf: str | None = None
    agente_regulado: str | None = None
    prioritario: bool = False

    model_config = {"from_attributes": True}


class CautelarResumo(BaseModel):
    """Cartões do painel, conforme a Figura 2 do documento."""
    vigentes: int = 0
    #: Vencendo em até 3 dias (mesmo limiar do semáforo de prazos).
    vencendo: int = 0
    #: Vencidas e sem renovação.
    vencidas: int = 0
    #: ⚑ Defesa apresentada — revisar cautelar.
    defesa_apresentada: int = 0
    #: Aguardando concordância do Coordenador Geral.
    aguardando_aprovacao: int = 0
