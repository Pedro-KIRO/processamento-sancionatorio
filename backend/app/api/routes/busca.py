"""Busca unificada para a barra de pesquisa do cabeçalho.

Antes a pesquisa mandava todo mundo para "Processos em Andamento", o que
levava à tela errada quando o número pesquisado era de um relatório ainda na
Caixa de Entrada. Aqui devolvemos os candidatos já classificados, para o
frontend sugerir e navegar para a tela correta.

Um mesmo item da caixa de entrada pode responder por dois números SEI: o do
relatório de fiscalização (``numero_sei``) e, quando houve instauração, o do
processo sancionatório (``numero_processo_sei``). A classificação leva isso em
conta — pesquisar o número do relatório sugere o relatório, e pesquisar o do
processo sugere o processo.
"""
import re

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m

router = APIRouter(tags=["Busca"])

_MASK_CHARS = re.compile(r"[.\-/\s]")


def _so_digitos(texto: str | None) -> str:
    return re.sub(r"\D", "", str(texto or ""))


def _normalizar(texto: str | None) -> str:
    """Remove pontuação de máscara (., /, -, espaço)."""
    return _MASK_CHARS.sub("", texto or "")


def _coluna_sem_mascara(coluna):
    """Versão da coluna sem ., /, - e espaços (funciona em SQLite e SQL Server)."""
    for ch in (".", "/", "-", " "):
        coluna = func.replace(coluna, ch, "")
    return coluna


class ResultadoBuscaOut(BaseModel):
    """Um candidato da pesquisa, já identificado como relatório ou processo."""
    caixa_entrada_id: int
    # "relatorio" (processo de fiscalização) ou "processo" (sancionatório)
    tipo: str
    numero_sei: str | None
    id_procedimento: str | None
    razao_social: str | None
    cnpj_cpf: str | None
    agente_regulado: str | None
    # Define em qual tela o item vive — o frontend usa para montar a rota
    status_triagem: str | None


class BuscaOut(BaseModel):
    termo: str
    total: int
    resultados: list[ResultadoBuscaOut]


@router.get("/busca", response_model=BuscaOut)
def buscar(
    termo: str = Query("", description="Nº SEI (com ou sem máscara), CNPJ/CPF ou razão social"),
    limit: int = Query(10, le=50),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Procura relatórios e processos por número SEI, CNPJ/CPF ou razão social.

    A busca por números ignora a máscara; a busca por razão social é parcial e
    não diferencia maiúsculas de minúsculas.
    """
    termo = (termo or "").strip()
    if len(termo) < 2:
        return BuscaOut(termo=termo, total=0, resultados=[])

    digitos = _so_digitos(termo)
    sem_mascara = _normalizar(termo)
    texto = f"%{termo.lower()}%"

    condicoes = [func.lower(m.CaixaEntrada.razao_social).like(texto)]
    if sem_mascara:
        alvo = f"%{sem_mascara}%"
        condicoes.append(_coluna_sem_mascara(m.CaixaEntrada.numero_sei).like(alvo))
        condicoes.append(_coluna_sem_mascara(m.CaixaEntrada.numero_processo_sei).like(alvo))
    if digitos:
        condicoes.append(_coluna_sem_mascara(m.CaixaEntrada.cnpj_cpf).like(f"%{digitos}%"))

    stmt = (
        select(m.CaixaEntrada)
        .where(or_(*condicoes))
        .order_by(m.CaixaEntrada.data_recebimento.desc())
        .limit(limit)
    )
    itens = db.scalars(stmt).all()

    resultados: list[ResultadoBuscaOut] = []
    for item in itens:
        # O termo bate especificamente com o número do processo sancionatório?
        casou_processo = bool(
            sem_mascara
            and item.numero_processo_sei
            and sem_mascara in _normalizar(item.numero_processo_sei)
        )

        if casou_processo:
            tipo = "processo"
            numero = item.numero_processo_sei
            id_proc = item.id_procedimento_processo
        else:
            tipo = "relatorio"
            numero = item.numero_sei
            id_proc = item.id_procedimento

        resultados.append(ResultadoBuscaOut(
            caixa_entrada_id=item.id,
            tipo=tipo,
            numero_sei=numero,
            id_procedimento=id_proc,
            razao_social=item.razao_social,
            cnpj_cpf=item.cnpj_cpf,
            agente_regulado=item.agente_regulado,
            status_triagem=item.status_triagem,
        ))

    return BuscaOut(termo=termo, total=len(resultados), resultados=resultados)
