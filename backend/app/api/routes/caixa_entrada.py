"""Rotas da Caixa de Entrada."""
import os
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.schemas.caixa_entrada import CaixaEntradaOut
from app.services.relatorio_fiscalizacao import RelatorioFiscalizacaoError, gerar_relatorio_html

router = APIRouter(prefix="/caixa-entrada", tags=["Caixa de Entrada"])

_MASK_CHARS = re.compile(r"[.\-/\s]")

# Colunas que a listagem sabe ordenar. A ordenação é feita no banco (e não na
# tela) porque a rota devolve no máximo `limit` itens: ordenando só o que já
# chegou, "mais antigo primeiro" mostraria o mais antigo da página, não do
# conjunto todo.
_ORDENAVEIS = {
    "data_recebimento": lambda: m.CaixaEntrada.data_recebimento,
    # `lower` para a ordem alfabética não jogar minúsculas depois de todas as
    # maiúsculas, como faz a comparação binária padrão.
    "razao_social": lambda: func.lower(m.CaixaEntrada.razao_social),
}


def _normalizar(texto: str | None) -> str:
    """Remove pontuação de máscara (., /, -, espaço) de um texto."""
    return _MASK_CHARS.sub("", texto or "")


def _coluna_sem_mascara(coluna):
    """Versão da coluna sem ., /, - e espaços (funciona em SQLite e SQL Server)."""
    for ch in (".", "/", "-", " "):
        coluna = func.replace(coluna, ch, "")
    return coluna


@router.get("/agentes", response_model=list[str])
def listar_agentes(
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista os agentes regulados distintos (para o filtro)."""
    stmt = (
        select(m.CaixaEntrada.agente_regulado)
        .where(m.CaixaEntrada.agente_regulado.is_not(None))
        .distinct()
        .order_by(m.CaixaEntrada.agente_regulado)
    )
    return [a for a in db.scalars(stmt).all() if a]


@router.get("", response_model=list[CaixaEntradaOut])
def listar(
    busca: str | None = Query(None, description="Nº SEI ou CNPJ/CPF, com ou sem máscara"),
    agente: str | None = Query(None, description="Filtra por agente regulado"),
    data_inicio: date | None = Query(None, description="Data de recebimento inicial"),
    data_fim: date | None = Query(None, description="Data de recebimento final"),
    ordenar_por: str = Query(
        "data_recebimento",
        description="Coluna de ordenação: data_recebimento ou razao_social",
    ),
    ordem: str = Query("desc", description="Sentido da ordenação: asc ou desc"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista itens da caixa de entrada com filtros opcionais.

    Itens que já saíram para Arquivamento, TAC ou Instauração (status_triagem
    em ``tac``/``instaurado``/``arquivado``) não aparecem mais aqui — eles
    passam a viver na tela de "Processos em Andamento" (rota
    ``/processos-andamento``).

    A ordenação padrão continua sendo por data de recebimento decrescente (o
    mais novo primeiro), que é a ordem esperada de uma caixa de entrada.
    """
    stmt = select(m.CaixaEntrada).where(
        or_(
            m.CaixaEntrada.status_triagem.is_(None),
            m.CaixaEntrada.status_triagem.notin_(["tac", "instaurado", "arquivado"]),
        )
    )

    # Filtro por unidade do usuário (quando auth está ativo e o usuário é analista)
    if usuario.email and usuario.email != "dev@local":
        usuario_db = db.query(m.Usuario).filter_by(email=usuario.email).first()
        if usuario_db and usuario_db.perfil != "coordenador" and usuario_db.id_unidade:
            stmt = stmt.where(m.CaixaEntrada.id_unidade_sei == usuario_db.id_unidade)

    if busca:
        termo = _normalizar(busca)
        if termo:
            alvo = f"%{termo}%"
            stmt = stmt.where(
                or_(
                    _coluna_sem_mascara(m.CaixaEntrada.numero_sei).like(alvo),
                    _coluna_sem_mascara(m.CaixaEntrada.cnpj_cpf).like(alvo),
                    func.lower(m.CaixaEntrada.razao_social).like(f"%{busca.lower()}%"),
                )
            )
    if agente:
        stmt = stmt.where(m.CaixaEntrada.agente_regulado == agente)
    if data_inicio:
        stmt = stmt.where(m.CaixaEntrada.data_recebimento >= data_inicio)
    if data_fim:
        stmt = stmt.where(m.CaixaEntrada.data_recebimento <= data_fim)

    coluna = _ORDENAVEIS.get(ordenar_por, _ORDENAVEIS["data_recebimento"])()
    alvo = coluna.asc() if ordem == "asc" else coluna.desc()
    # Desempate pelo id: sem ele, itens recebidos no mesmo dia trocam de lugar
    # entre requisições e a lista "pisca" a cada atualização automática.
    stmt = (
        stmt.order_by(alvo, m.CaixaEntrada.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return db.scalars(stmt).all()


@router.get("/{item_id}", response_model=CaixaEntradaOut)
def obter_item(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Retorna os detalhes de um item da caixa de entrada pelo ID."""
    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    return item


@router.get("/{item_id}/relatorio")
def obter_relatorio_html(
    item_id: int,
    forcar: bool = Query(False, description="Ignora o cache e busca dados atualizados"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Retorna o HTML do relatório de fiscalização.

    Gera sob demanda (individual) buscando direto do SharePoint via Graph:
    lista_resposta + lista_perguntas + listaAnexosFiscalizacao (site CQCFAR)
    e listaFiscais (site DCAN). O resultado é cacheado no banco após a
    primeira geração; use ?forcar=true para regenerar.
    """
    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")

    if item.conteudo_html and not forcar:
        return {"html": item.conteudo_html}

    if not item.id_relatorio:
        raise HTTPException(status_code=404, detail="Relatório ainda não disponível (sem ID_Relatorio)")

    tenant = os.getenv("GRAPH_TENANT_ID", "")
    client_id = os.getenv("GRAPH_CLIENT_ID", "")
    client_secret = os.getenv("GRAPH_CLIENT_SECRET", "")

    if not tenant or not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="Graph não configurado")

    try:
        html = gerar_relatorio_html(item, tenant, client_id, client_secret)
    except RelatorioFiscalizacaoError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if not html:
        raise HTTPException(
            status_code=404,
            detail="Fiscalização ainda não preencheu o checklist deste relatório",
        )

    item.conteudo_html = html
    db.commit()

    return {"html": html}


# ==============================================================================
# Apontamentos do checklist e histórico do agente
# ==============================================================================

from pydantic import BaseModel


class ApontamentoOut(BaseModel):
    pergunta: str
    resposta_esperada: str
    resposta_dada: str
    enquadramento: str = ""


class ApontamentosOut(BaseModel):
    """Resumo de conformidade do relatório de fiscalização."""
    total_apontamentos: int
    itens_avaliados: int
    # Itens marcados como "não se aplica" (na pergunta ou na resposta) — ficam
    # fora da apuração, mas informamos para o total ser auditável.
    nao_aplicaveis: int
    em_conformidade: bool
    apontamentos: list[ApontamentoOut]


@router.get("/{item_id}/apontamentos", response_model=ApontamentosOut)
def obter_apontamentos(
    item_id: int,
    forcar: bool = Query(False, description="Recalcula ignorando os valores já gravados"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Apontamentos (não conformidades) do checklist de fiscalização.

    Um apontamento é uma pergunta cuja resposta divergiu da esperada — a coluna
    ``Conformidade`` da lista_perguntas guarda qual resposta caracteriza
    conformidade para cada pergunta.

    Os totais ficam gravados no item para a tela abrir sem depender do
    SharePoint; a lista detalhada é sempre apurada ao vivo.
    """
    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")

    from app.services.conformidade_relatorio import apurar

    resultado = apurar(item.id_relatorio)

    # Só grava quando a apuração de fato aconteceu — sem isso, uma falha
    # momentânea do SharePoint sobrescreveria um total válido com zero.
    if resultado.avaliadas > 0:
        if (
            item.total_apontamentos != resultado.total_apontamentos
            or item.total_itens_avaliados != resultado.avaliadas
        ):
            item.total_apontamentos = resultado.total_apontamentos
            item.total_itens_avaliados = resultado.avaliadas
            db.commit()

    return ApontamentosOut(
        total_apontamentos=resultado.total_apontamentos,
        itens_avaliados=resultado.avaliadas,
        nao_aplicaveis=resultado.nao_aplicaveis,
        em_conformidade=resultado.em_conformidade,
        apontamentos=[
            ApontamentoOut(
                pergunta=a.pergunta,
                resposta_esperada=a.resposta_esperada,
                resposta_dada=a.resposta_dada,
                enquadramento=a.enquadramento,
            )
            for a in resultado.apontamentos
        ],
    )


STATUS_JA_PROCESSO = ("instaurado", "tac", "arquivado")


class RegistroAgenteOut(BaseModel):
    """Um número SEI pertencente ao agente — relatório de fiscalização ou processo."""
    tipo: str  # "relatorio" ou "processo"
    numero_sei: str | None
    # ID interno do procedimento no SEI, usado para montar o link direto
    id_procedimento: str | None
    # Item da caixa de entrada de onde este número veio
    caixa_entrada_id: int
    status_triagem: str | None
    # True quando o registro pertence ao item que está sendo consultado
    atual: bool


class HistoricoAgenteOut(BaseModel):
    """Inventário de relatórios e processos de um agente regulado."""
    total: int
    total_relatorios: int
    total_processos: int
    registros: list[RegistroAgenteOut]


@router.get("/{item_id}/historico-agente", response_model=HistoricoAgenteOut)
def obter_historico_agente(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Todos os relatórios e processos do agente, agrupados por CPF/CNPJ.

    Cada linha da caixa de entrada rende **um relatório** (o ``numero_sei``, que
    é o processo de fiscalização) e, quando a triagem gerou um processo
    sancionatório novo, **também um processo** (``numero_processo_sei``). Assim
    um agente com duas fiscalizações instauradas soma 4 registros: 2 relatórios
    e 2 processos.

    Em TAC e Arquivamento não nasce processo novo — o documento entra no próprio
    processo de fiscalização —, então essas linhas contam apenas o relatório.

    O item consultado entra no inventário (marcado com ``atual``), porque a
    pergunta que o card responde é "quantos registros este agente tem", não
    "quantos além deste".

    A comparação do documento ignora a máscara, já que a grafia varia conforme
    a origem do cadastro.
    """
    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")

    documento = _normalizar(item.cnpj_cpf)
    if not documento:
        return HistoricoAgenteOut(total=0, total_relatorios=0, total_processos=0, registros=[])

    stmt = (
        select(m.CaixaEntrada)
        .where(_coluna_sem_mascara(m.CaixaEntrada.cnpj_cpf) == documento)
        .order_by(m.CaixaEntrada.data_recebimento.desc())
    )
    itens = db.scalars(stmt).all()

    registros: list[RegistroAgenteOut] = []
    for linha in itens:
        eh_atual = linha.id == item_id

        if linha.numero_sei:
            registros.append(RegistroAgenteOut(
                tipo="relatorio",
                numero_sei=linha.numero_sei,
                id_procedimento=linha.id_procedimento,
                caixa_entrada_id=linha.id,
                status_triagem=linha.status_triagem,
                atual=eh_atual,
            ))

        # Processo sancionatório só existe quando a instauração criou um novo
        if linha.status_triagem in STATUS_JA_PROCESSO and linha.numero_processo_sei:
            registros.append(RegistroAgenteOut(
                tipo="processo",
                numero_sei=linha.numero_processo_sei,
                id_procedimento=linha.id_procedimento_processo,
                caixa_entrada_id=linha.id,
                status_triagem=linha.status_triagem,
                atual=eh_atual,
            ))

    total_relatorios = sum(1 for r in registros if r.tipo == "relatorio")
    total_processos = sum(1 for r in registros if r.tipo == "processo")

    return HistoricoAgenteOut(
        total=len(registros),
        total_relatorios=total_relatorios,
        total_processos=total_processos,
        registros=registros,
    )


# ==============================================================================
# Histórico de andamentos
# ==============================================================================

from app.api.routes.historico import listar_historico_andamentos, AndamentoOut


@router.get("/{item_id}/historico", response_model=list[AndamentoOut])
def obter_historico(
    item_id: int,
    modo: str = Query("resumido", description="'resumido' ou 'completo'"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Histórico de andamentos do processo de fiscalização no SEI."""
    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    if not item.id_procedimento:
        return []
    id_unidade = item.id_unidade_sei or "110053117"
    return listar_historico_andamentos(item.id_procedimento, id_unidade, modo=modo, db=db)
