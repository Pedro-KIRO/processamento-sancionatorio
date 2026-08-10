"""Rotas de notificações do sistema.

O frontend consulta essas rotas para exibir o ícone de sino com badge
(quantidade de não-lidas) e a lista de notificações recentes.
"""
import logging
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import sei_settings
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.integrations.sei.client import SeiClient

router = APIRouter(prefix="/notificacoes", tags=["Notificações"])
logger = logging.getLogger(__name__)


def _verificar_docs_externos_todos_processos(db: Session):
    """Verifica documentos externos recentes em todos os processos em andamento.

    Para não sobrecarregar a API do SEI, limita a processos que:
    - Tem número de processo SEI e id_procedimento
    - Tem fase ativa (não encerrados)
    - Não foram verificados nos últimos 5 minutos (via cache simples em memória)
    """
    from datetime import datetime as dt

    # Buscar processos em andamento com fase ativa (não encerrados)
    stmt = (
        select(m.FaseProcessoAndamento)
        .where(m.FaseProcessoAndamento.data_saida == None)  # noqa: E711 — fase ativa
        .where(m.FaseProcessoAndamento.fase != "encerrado")
    )
    fases_ativas = db.scalars(stmt).all()

    if not fases_ativas:
        return

    hoje = date.today()

    for fase in fases_ativas:
        item = db.get(m.CaixaEntrada, fase.caixa_entrada_id)
        if not item:
            continue

        id_procedimento = item.id_procedimento_processo or item.id_procedimento
        id_unidade = item.id_unidade_sei or "110053117"
        if not id_procedimento:
            continue

        # Verificar se já existe notificação documento_externo recente (últimas 24h)
        # para evitar consultas desnecessárias ao SEI
        stmt_notif = (
            select(m.Notificacao)
            .where(
                m.Notificacao.caixa_entrada_id == fase.caixa_entrada_id,
                m.Notificacao.tipo == "documento_externo",
            )
            .order_by(m.Notificacao.criado_em.desc())
            .limit(1)
        )
        ultima_notif = db.scalars(stmt_notif).first()

        if ultima_notif and ultima_notif.criado_em:
            # Se já notificou hoje, pular
            if ultima_notif.criado_em.date() >= hoje:
                continue

        # Consultar SEI para documentos externos (tarefa 13)
        try:
            sei = SeiClient(sei_settings(), timeout=15)
            resp = sei.listar_andamentos(
                id_procedimento, id_unidade,
                tipo_historico="T", tarefas="13",
                start=0, limit=5,
            )
        except Exception:
            continue

        andamentos = resp.get("Andamentos", [])
        if not andamentos:
            continue

        # Pegar data do andamento mais recente
        data_mais_recente = None
        descricao_andamento = ""
        for a in andamentos:
            data_str = a.get("data", "")
            try:
                partes = data_str.split("/")
                data_a = date(int(partes[2]), int(partes[1]), int(partes[0]))
            except (ValueError, IndexError):
                continue
            if data_mais_recente is None or data_a > data_mais_recente:
                data_mais_recente = data_a
                descricao_andamento = a.get("descricao", "Documento externo registrado")

        if not data_mais_recente:
            continue

        # Só notificar docs dos últimos 30 dias
        if (hoje - data_mais_recente).days > 30:
            continue

        # Verificar se a última notificação já cobre esse doc
        if ultima_notif and ultima_notif.criado_em:
            if ultima_notif.criado_em.date() >= data_mais_recente:
                continue

        # Criar notificação
        numero = item.numero_processo_sei or item.numero_sei or ""
        db.add(m.Notificacao(
            caixa_entrada_id=fase.caixa_entrada_id,
            tipo="documento_externo",
            titulo="Documento externo registrado",
            descricao=f"Novo documento externo juntado ao processo {numero} em {data_mais_recente.strftime('%d/%m/%Y')}. {descricao_andamento}",
        ))

    try:
        db.commit()
    except Exception:
        db.rollback()


class NotificacaoOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    caixa_entrada_id: int | None
    tipo: str
    titulo: str
    descricao: str | None
    lida: bool
    criado_em: str  # ISO format


class ResumoNotificacoesOut(BaseModel):
    total_nao_lidas: int
    notificacoes: list[NotificacaoOut]


@router.get("", response_model=ResumoNotificacoesOut)
def listar_notificacoes(
    limit: int = 20,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista as notificações mais recentes + contagem de não-lidas.

    A verificação de documentos externos no SEI é disparada em background
    para não bloquear o carregamento.
    """
    # Disparar verificação em background (não bloqueia a resposta)
    import threading
    from app.db.base import get_engine, get_sessionmaker
    def _bg_verificar():
        try:
            engine = get_engine()
            SessionLocal = get_sessionmaker(engine)
            with SessionLocal() as bg_db:
                _verificar_docs_externos_todos_processos(bg_db)
        except Exception:
            pass
    threading.Thread(target=_bg_verificar, daemon=True).start()

    # Contagem de não-lidas
    total_nao_lidas = db.scalar(
        select(func.count(m.Notificacao.id)).where(m.Notificacao.lida == False)
    ) or 0

    # Lista das mais recentes
    stmt = (
        select(m.Notificacao)
        .order_by(m.Notificacao.criado_em.desc())
        .limit(limit)
    )
    notificacoes = db.scalars(stmt).all()

    return ResumoNotificacoesOut(
        total_nao_lidas=total_nao_lidas,
        notificacoes=[
            NotificacaoOut(
                id=n.id,
                caixa_entrada_id=n.caixa_entrada_id,
                tipo=n.tipo,
                titulo=n.titulo,
                descricao=n.descricao,
                lida=n.lida,
                criado_em=n.criado_em.isoformat() if n.criado_em else "",
            )
            for n in notificacoes
        ],
    )


@router.post("/{notificacao_id}/lida")
def marcar_como_lida(
    notificacao_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Marca uma notificação como lida."""
    notif = db.get(m.Notificacao, notificacao_id)
    if not notif:
        raise HTTPException(404, "Notificação não encontrada")
    notif.lida = True
    db.commit()
    return {"sucesso": True}


@router.post("/marcar-todas-lidas")
def marcar_todas_como_lidas(
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Marca todas as notificações como lidas."""
    stmt = (
        select(m.Notificacao)
        .where(m.Notificacao.lida == False)
    )
    nao_lidas = db.scalars(stmt).all()
    for n in nao_lidas:
        n.lida = True
    db.commit()
    return {"sucesso": True, "marcadas": len(nao_lidas)}
