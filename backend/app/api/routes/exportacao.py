"""Endpoints de exportação de dados para BI (Power BI / análise externa).

Retorna dados em JSON (padrão) ou CSV (param formato=csv).
Sem paginação — retorna todos os registros para carga no BI.
"""
import csv
import io
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m

router = APIRouter(prefix="/exportacao", tags=["Exportação BI"])


@router.get("/processos")
def exportar_processos(
    formato: str = Query("json", description="'json' ou 'csv'"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Exporta todos os processos em andamento com dados relevantes para BI.

    Campos: id, numero_sei, numero_processo_sei, razao_social, cnpj_cpf,
    agente_regulado, segmento, tipo_documento, status_triagem, data_recebimento,
    data_instauracao, id_unidade_sei.
    """
    stmt = select(m.CaixaEntrada).where(
        m.CaixaEntrada.status_triagem.in_(("instaurado", "arquivado", "tac"))
    )
    itens = db.scalars(stmt).all()

    campos = [
        "id", "numero_sei", "numero_processo_sei", "razao_social", "cnpj_cpf",
        "agente_regulado", "segmento", "tipo_documento", "status_triagem",
        "data_recebimento", "data_instauracao", "id_unidade_sei",
    ]

    dados = []
    for it in itens:
        dados.append({c: _serializar(getattr(it, c, None)) for c in campos})

    if formato == "csv":
        return _resposta_csv(dados, campos, "processos.csv")
    return dados


@router.get("/eventos")
def exportar_eventos(
    formato: str = Query("json", description="'json' ou 'csv'"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Exporta todos os eventos de processo para BI (rastreabilidade completa).

    Campos: id, caixa_entrada_id, tipo, descricao, autor, criado_em.
    """
    stmt = select(m.EventoProcesso).order_by(m.EventoProcesso.criado_em.desc())
    eventos = db.scalars(stmt).all()

    campos = ["id", "caixa_entrada_id", "tipo", "descricao", "autor", "criado_em"]

    dados = []
    for ev in eventos:
        dados.append({c: _serializar(getattr(ev, c, None)) for c in campos})

    if formato == "csv":
        return _resposta_csv(dados, campos, "eventos.csv")
    return dados


@router.get("/fases")
def exportar_fases(
    formato: str = Query("json", description="'json' ou 'csv'"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Exporta histórico de fases de todos os processos para BI.

    Campos: id, caixa_entrada_id, fase, data_entrada, data_saida, autor, observacao.
    """
    stmt = select(m.FaseProcessoAndamento).order_by(m.FaseProcessoAndamento.data_entrada.desc())
    fases = db.scalars(stmt).all()

    campos = ["id", "caixa_entrada_id", "fase", "data_entrada", "data_saida", "autor", "observacao"]

    dados = []
    for f in fases:
        dados.append({c: _serializar(getattr(f, c, None)) for c in campos})

    if formato == "csv":
        return _resposta_csv(dados, campos, "fases.csv")
    return dados


@router.get("/prazos")
def exportar_prazos(
    formato: str = Query("json", description="'json' ou 'csv'"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Exporta todos os prazos para BI.

    Campos: id, caixa_entrada_id, fase, dias, data_inicio, data_vencimento,
    reiniciado, status, data_resposta, registrado_sei.
    """
    stmt = select(m.PrazoProcesso).order_by(m.PrazoProcesso.criado_em.desc())
    prazos = db.scalars(stmt).all()

    campos = [
        "id", "caixa_entrada_id", "fase", "dias", "data_inicio", "data_vencimento",
        "reiniciado", "status", "data_resposta", "registrado_sei",
    ]

    dados = []
    for p in prazos:
        dados.append({c: _serializar(getattr(p, c, None)) for c in campos})

    if formato == "csv":
        return _resposta_csv(dados, campos, "prazos.csv")
    return dados


# ==============================================================================
# Helpers
# ==============================================================================

def _serializar(valor) -> str | None:
    """Converte valores para string serializável."""
    if valor is None:
        return None
    if isinstance(valor, (date,)):
        return valor.isoformat()
    if hasattr(valor, 'isoformat'):
        return valor.isoformat()
    if isinstance(valor, bool):
        return valor
    return str(valor)


def _resposta_csv(dados: list[dict], campos: list[str], nome_arquivo: str) -> StreamingResponse:
    """Gera resposta HTTP com arquivo CSV."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=campos, extrasaction='ignore')
    writer.writeheader()
    writer.writerows(dados)
    buffer.seek(0)

    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nome_arquivo}"'},
    )
