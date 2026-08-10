"""Consulta da trilha de auditoria e dos alertas internos (Doc. de Negócio v3.0).

A trilha é escrita pelo middleware em ``app/main.py``; aqui ela só é lida.
Acesso restrito à coordenação: é registro de quem fez o quê, e serve ao controle
interno, não ao trabalho do dia.

Os alertas internos são os oito gatilhos das regras transversais do documento.
São calculados na hora a partir do estado do banco, em vez de gravados: o que
importa é a pendência de agora, e um alerta gravado viraria mentira no instante
seguinte ao usuário resolver o caso.
"""
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, exigir_coordenador, get_current_user
from app.db import models as m
from app.services import calculo_prazos as cp

router = APIRouter(tags=["Auditoria e alertas"])

#: Dias sem movimentação que caracterizam morosidade (regra de gestão).
DIAS_SEM_MOVIMENTACAO = cp.dias_do_tipo("sem_movimentacao", 15)
#: Dias que o termo de encerramento pode ficar assinado sem conclusão.
DIAS_ENCERRAMENTO = cp.dias_do_tipo("encerramento_sem_conclusao", 2)


# ==============================================================================
# Trilha de auditoria
# ==============================================================================


class LinhaAuditoria(BaseModel):
    id: int
    usuario: str | None = None
    momento: datetime
    operacao: str
    metodo: str | None = None
    caminho: str | None = None
    entidade: str | None = None
    registro_id: int | None = None
    documento: str | None = None
    status_http: int | None = None

    model_config = {"from_attributes": True}


class RespostaAuditoria(BaseModel):
    total: int
    registros: list[LinhaAuditoria]


@router.get("/auditoria", response_model=RespostaAuditoria)
def consultar_auditoria(
    usuario: str | None = Query(None, description="Filtra por e-mail do usuário"),
    entidade: str | None = Query(None, description="Área: cautelares, prazos, processos-andamento..."),
    registro_id: int | None = Query(None, description="Id do registro afetado"),
    de: date | None = Query(None, description="A partir desta data"),
    ate: date | None = Query(None, description="Até esta data"),
    limit: int = Query(200, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _coordenador: UsuarioAutenticado = Depends(exigir_coordenador),
):
    """Trilha de auditoria, do mais recente para o mais antigo."""
    filtros = []
    if usuario:
        filtros.append(m.Auditoria.usuario.ilike(f"%{usuario.strip()}%"))
    if entidade:
        filtros.append(m.Auditoria.entidade == entidade)
    if registro_id:
        filtros.append(m.Auditoria.registro_id == registro_id)
    if de:
        filtros.append(m.Auditoria.momento >= datetime.combine(de, datetime.min.time()))
    if ate:
        filtros.append(m.Auditoria.momento <= datetime.combine(ate, datetime.max.time()))

    total = db.scalar(select(func.count()).select_from(m.Auditoria).where(*filtros)) or 0
    registros = db.scalars(
        select(m.Auditoria)
        .where(*filtros)
        .order_by(m.Auditoria.momento.desc(), m.Auditoria.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return RespostaAuditoria(total=total, registros=list(registros))


# ==============================================================================
# Alertas internos automáticos
# ==============================================================================


class Alerta(BaseModel):
    chave: str
    rotulo: str
    total: int
    #: baixa | media | alta — orienta o destaque na tela.
    severidade: str
    descricao: str
    #: Ids de itens da caixa de entrada envolvidos (amostra, no máximo 50).
    itens: list[int] = []


@router.get("/alertas", response_model=list[Alerta])
def listar_alertas(
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Os oito alertas internos das regras transversais do documento.

    São de acompanhamento gerencial: apontam pendência, não disparam ação
    automática. Cada alerta traz uma amostra dos ids para a tela poder navegar.
    """
    hoje = date.today()
    limite_amostra = 50
    alertas: list[Alerta] = []

    def _adicionar(chave: str, rotulo: str, severidade: str, descricao: str, ids: list[int]) -> None:
        alertas.append(Alerta(
            chave=chave, rotulo=rotulo, total=len(ids), severidade=severidade,
            descricao=descricao, itens=ids[:limite_amostra],
        ))

    ativos = (m.PrazoProcesso.status == "em_andamento")

    # O join com `caixa_entrada` não é decorativo: a automação de limpeza remove
    # itens que saíram do filtro da caixa e deixa prazos órfãos para trás. Sem o
    # join, o alerta apontaria vencidos de processos que já não existem no app —
    # falso alarme que ninguém consegue resolver.
    def _prazos_com_processo(*condicoes):
        return db.scalars(
            select(m.PrazoProcesso.caixa_entrada_id)
            .join(m.CaixaEntrada, m.CaixaEntrada.id == m.PrazoProcesso.caixa_entrada_id)
            .where(*condicoes)
        ).all()

    # 1 e 2 — prazos vencidos e próximos do vencimento
    vencidos = _prazos_com_processo(ativos, m.PrazoProcesso.data_vencimento < hoje)
    _adicionar(
        "prazos_vencidos", "Prazos vencidos", "alta",
        "Prazos em andamento cujo vencimento já passou.", list(dict.fromkeys(vencidos)),
    )

    proximos = _prazos_com_processo(
        ativos,
        m.PrazoProcesso.data_vencimento >= hoje,
        m.PrazoProcesso.data_vencimento <= hoje + timedelta(days=cp.DIAS_VERDE - 1),
    )
    _adicionar(
        "prazos_a_vencer", f"Prazos vencendo em até {cp.DIAS_VERDE - 1} dias", "media",
        "Prazos no dia do vencimento ou a até 3 dias dele.", list(dict.fromkeys(proximos)),
    )

    # 3 — processos sem movimentação (morosidade)
    corte = datetime.now() - timedelta(days=DIAS_SEM_MOVIMENTACAO)
    com_evento_recente = select(m.EventoProcesso.caixa_entrada_id).where(
        m.EventoProcesso.criado_em >= corte
    ).scalar_subquery()
    parados = db.scalars(
        select(m.CaixaEntrada.id).where(
            m.CaixaEntrada.status_triagem == "instaurado",
            m.CaixaEntrada.id.notin_(com_evento_recente),
        )
    ).all()
    _adicionar(
        "sem_movimentacao", f"Processos sem movimentação há mais de {DIAS_SEM_MOVIMENTACAO} dias",
        "alta", "Alerta de morosidade para o controle interno.", list(parados),
    )

    # 4 e 5 — cautelares vencendo e vencidas
    cautelares = db.scalars(
        select(m.Cautelar)
        .join(m.CaixaEntrada, m.CaixaEntrada.id == m.Cautelar.caixa_entrada_id)
        .where(
            or_(m.Cautelar.situacao.is_(None), m.Cautelar.situacao.notin_(("renovada", "revogada")))
        )
    ).all()
    venc_cautelar = [
        c.caixa_entrada_id for c in cautelares
        if c.caixa_entrada_id and c.data_fim and hoje <= c.data_fim <= hoje + timedelta(days=cp.DIAS_VERDE - 1)
    ]
    _adicionar(
        "cautelares_vencendo", "Cautelares vencendo", "media",
        "Medidas cautelares a vencer em até 3 dias, que exigem renovação ou revogação.",
        list(dict.fromkeys(venc_cautelar)),
    )
    vencidas_cautelar = [
        c.caixa_entrada_id for c in cautelares
        if c.caixa_entrada_id and c.data_fim and c.data_fim < hoje
    ]
    _adicionar(
        "cautelares_vencidas", "Cautelares vencidas sem renovação", "alta",
        "O agente segue bloqueado sem medida vigente que sustente o bloqueio.",
        list(dict.fromkeys(vencidas_cautelar)),
    )

    # 6 — recursos pendentes de parecer ou de Decisão II
    recursos = db.scalars(
        select(m.RecursoProcesso)
        .join(m.CaixaEntrada, m.CaixaEntrada.id == m.RecursoProcesso.caixa_entrada_id)
        .where(
            m.RecursoProcesso.interposto.is_(True),
            m.RecursoProcesso.decisao_resultado.is_(None),
        )
    ).all()
    _adicionar(
        "recursos_pendentes", "Recursos pendentes de decisão", "media",
        "Recursos interpostos aguardando parecer jurídico ou Decisão II.",
        list(dict.fromkeys(r.caixa_entrada_id for r in recursos)),
    )

    # 7 — aguardando assinatura (cautelares com certidão pendente)
    aguardando = db.scalars(
        select(m.Cautelar.caixa_entrada_id)
        .join(m.CaixaEntrada, m.CaixaEntrada.id == m.Cautelar.caixa_entrada_id)
        .where(m.Cautelar.pendente_assinatura.is_(True))
    ).all()
    _adicionar(
        "aguardando_assinatura", "Documentos aguardando assinatura", "media",
        "Certidões de bloqueio ou desbloqueio criadas e ainda não assinadas no SEI.",
        list(dict.fromkeys(i for i in aguardando if i)),
    )

    # 8 — termo de encerramento assinado sem conclusão do processo
    corte_encerramento = datetime.now() - timedelta(days=DIAS_ENCERRAMENTO)
    encerrando = db.scalars(
        select(m.FaseProcessoAndamento.caixa_entrada_id)
        .join(m.CaixaEntrada, m.CaixaEntrada.id == m.FaseProcessoAndamento.caixa_entrada_id)
        .where(
            m.FaseProcessoAndamento.fase == "encerramento",
            m.FaseProcessoAndamento.data_saida.is_(None),
            m.FaseProcessoAndamento.data_entrada <= corte_encerramento,
        )
    ).all()
    _adicionar(
        "encerramento_sem_conclusao",
        f"Encerramento assinado há mais de {DIAS_ENCERRAMENTO} dias sem conclusão",
        "media",
        "O termo de encerramento foi assinado, mas o processo não foi concluído no SEI.",
        list(dict.fromkeys(encerrando)),
    )

    return alertas
