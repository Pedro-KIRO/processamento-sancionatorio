"""Rotas da tela "Consulta Unificada" (somente leitura).

A tela junta relatórios de fiscalização e processos sancionatórios num só
lugar, apenas para consulta — nenhuma ação é disparada daqui.

Os dados são lidos da tabela ``consulta_unificada``, alimentada pela automação
``automacoes/sincronizar_consulta_unificada.py``. Nada é consultado no SEI ou no
SharePoint durante o request: as datas exigidas pela tela vêm dos andamentos do
SEI (uma chamada por linha, com ~20 mil linhas), então buscá-las ao vivo
tornaria a tela inutilizável.
"""
import re
from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.db.models import FASES_PROCESSO

router = APIRouter(prefix="/consulta-unificada", tags=["Consulta Unificada"])


def _so_digitos(texto: str | None) -> str:
    return re.sub(r"\D", "", str(texto or ""))


# Valores aceitos no filtro "Fonte dos dados" da tela.
FONTE_FISCALIZACAO = "fiscalizacao"
FONTE_PROCESSAMENTO = "processamento"


# Colunas pelas quais a tela permite ordenar. O nome da esquerda é o que vem na
# query string; a expressão é o que ordena de fato.
COLUNAS_ORDENAVEIS = {
    "criacao": lambda: m.ConsultaUnificada.data_criacao_sei,
    "ultima_acao": lambda: m.ConsultaUnificada.data_ultima_acao,
    "razao_social": lambda: func.lower(m.ConsultaUnificada.razao_social),
    # Ordena pelo número sem máscara: com pontuação, "140.001..." e "140.01..."
    # saem fora de ordem porque a comparação é caractere a caractere.
    "numero_sei": lambda: m.ConsultaUnificada.numero_limpo,
    "cnpj_cpf": lambda: func.replace(
        func.replace(func.replace(m.ConsultaUnificada.cnpj_cpf, ".", ""), "/", ""), "-", "",
    ),
    "agente": lambda: func.lower(m.ConsultaUnificada.agente_regulado),
    "situacao": lambda: func.lower(m.ConsultaUnificada.situacao),
    "fase": lambda: m.ConsultaUnificada.fase_atual,
}


def _ordenacao(ordenar_por: str, ordem: str) -> list:
    """Cláusulas de ordenação, sempre com os vazios no fim.

    Um valor nulo não deve ser tratado como "o menor": linha sem data de criação
    apareceria como a mais antiga, e linha sem fase, antes de todas as fases.
    """
    coluna_fn = COLUNAS_ORDENAVEIS.get(ordenar_por) or COLUNAS_ORDENAVEIS["criacao"]
    coluna = coluna_fn()
    crescente = ordem.lower() == "asc"

    return [
        coluna.is_(None).asc(),
        coluna.asc() if crescente else coluna.desc(),
        # Desempate estável, para a paginação não repetir nem pular linha
        m.ConsultaUnificada.id.asc(),
    ]


def _filtros_recorte(tipo: str | None, fonte: str | None) -> list:
    """Condições de ``tipo`` e ``fonte``, compartilhadas pela lista e pelos filtros.

    A fonte diz de onde o registro veio, e não é a mesma coisa que o tipo:

    - ``fiscalizacao``: só existe no app de fiscalização (listaDesignacao) e
      nunca foi tramitado para o processamento.
    - ``processamento``: já chegou à nossa caixa de entrada. Isso inclui o que
      ainda aguarda triagem e o que foi arquivado — é mais amplo do que "tem
      processo instaurado".

    O vínculo é o ``caixa_entrada_id``, preenchido pela automação de
    sincronização para toda linha que tem item correspondente na caixa.
    """
    filtros = []
    if tipo:
        filtros.append(m.ConsultaUnificada.tipo == tipo)
    if fonte == FONTE_FISCALIZACAO:
        filtros.append(m.ConsultaUnificada.caixa_entrada_id.is_(None))
    elif fonte == FONTE_PROCESSAMENTO:
        filtros.append(m.ConsultaUnificada.caixa_entrada_id.is_not(None))
    return filtros


class LinhaConsultaOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    tipo: str
    # "fiscalizacao" ou "processamento" — ver ConsultaUnificada.fonte
    fonte: str
    numero_sei: str | None
    id_procedimento: str | None
    razao_social: str | None
    cnpj_cpf: str | None
    agente_regulado: str | None
    municipio: str | None
    ano: str | None
    situacao: str | None
    fase_atual: str | None
    data_criacao_sei: date | None
    data_ultima_acao: date | None
    caixa_entrada_id: int | None


class ConsultaUnificadaOut(BaseModel):
    """Página de resultados.

    ``total`` é a contagem com os filtros aplicados (não só a página), para a
    tela poder mostrar quantos itens existem.
    """
    total: int
    limit: int
    offset: int
    linhas: list[LinhaConsultaOut]


@router.get("/agentes", response_model=list[str])
def listar_agentes(
    tipo: str | None = Query(None, description="'relatorio' ou 'processo'"),
    fonte: str | None = Query(None, description="'fiscalizacao' ou 'processamento'"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Agentes regulados distintos presentes na consulta (para o filtro)."""
    stmt = (
        select(m.ConsultaUnificada.agente_regulado)
        .where(m.ConsultaUnificada.agente_regulado.is_not(None))
        .distinct()
        .order_by(m.ConsultaUnificada.agente_regulado)
    )
    for filtro in _filtros_recorte(tipo=tipo, fonte=fonte):
        stmt = stmt.where(filtro)
    return [a for a in db.scalars(stmt).all() if a]


@router.get("/situacoes", response_model=list[str])
def listar_situacoes(
    tipo: str | None = Query(None, description="'relatorio' ou 'processo'"),
    fonte: str | None = Query(None, description="'fiscalizacao' ou 'processamento'"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Situações distintas presentes na consulta (para o filtro).

    Respeita ``tipo`` e ``fonte`` para não oferecer opção impossível: filtrando
    somente relatórios, por exemplo, "Processo instaurado" não aparece, porque
    essa situação só existe em linha de processo.
    """
    stmt = (
        select(m.ConsultaUnificada.situacao)
        .where(m.ConsultaUnificada.situacao.is_not(None))
        .distinct()
        .order_by(m.ConsultaUnificada.situacao)
    )
    for filtro in _filtros_recorte(tipo=tipo, fonte=fonte):
        stmt = stmt.where(filtro)
    return [s for s in db.scalars(stmt).all() if s]


@router.get("/fases", response_model=list[str])
def listar_fases(
    tipo: str | None = Query(None, description="'relatorio' ou 'processo'"),
    fonte: str | None = Query(None, description="'fiscalizacao' ou 'processamento'"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Fases presentes na consulta, na ordem oficial do processo.

    Só linhas de processo têm fase; a ordem vem de ``FASES_PROCESSO`` para o
    filtro seguir a sequência do processo, e não a ordem alfabética.
    """
    stmt = (
        select(m.ConsultaUnificada.fase_atual)
        .where(m.ConsultaUnificada.fase_atual.is_not(None))
        .distinct()
    )
    for filtro in _filtros_recorte(tipo=tipo, fonte=fonte):
        stmt = stmt.where(filtro)

    presentes = {f for f in db.scalars(stmt).all() if f}
    ordenadas = [f for f in FASES_PROCESSO if f in presentes]
    # Fase gravada fora da lista oficial (não deveria acontecer) vai para o fim,
    # em vez de desaparecer do filtro.
    return ordenadas + sorted(presentes - set(FASES_PROCESSO))


@router.get("", response_model=ConsultaUnificadaOut)
def listar(
    busca: str | None = Query(None, description="Nº SEI, CNPJ/CPF ou razão social"),
    tipo: str | None = Query(None, description="'relatorio' ou 'processo'"),
    fonte: str | None = Query(
        None,
        description="Fonte dos dados: 'fiscalizacao' (só no app de fiscalização) "
                    "ou 'processamento' (já tramitado para a caixa de entrada)",
    ),
    agente: str | None = Query(None, description="Filtra por agente regulado"),
    situacao: str | None = Query(None, description="Filtra pela situação"),
    fase: str | None = Query(None, description="Filtra pela fase do processo"),
    ano: str | None = Query(None, description="Filtra pelo ano"),
    criacao_de: date | None = Query(None, description="Criação no SEI a partir desta data"),
    criacao_ate: date | None = Query(None, description="Criação no SEI até esta data"),
    acao_de: date | None = Query(None, description="Última ação a partir desta data"),
    acao_ate: date | None = Query(None, description="Última ação até esta data"),
    ordenar_por: str = Query(
        "criacao",
        description="Coluna de ordenação: criacao, ultima_acao, razao_social, "
                    "numero_sei, cnpj_cpf, agente, situacao, fase",
    ),
    ordem: str = Query("desc", description="'asc' ou 'desc'"),
    limit: int = Query(100, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista relatórios e processos consolidados, com filtros e paginação.

    Por padrão ordena pela criação no SEI, mais recente primeiro. Linhas sem
    data sincronizada ficam sempre no fim, independente da ordem escolhida — do
    contrário elas apareceriam como "as mais antigas".
    """
    filtros = _filtros_recorte(tipo=tipo, fonte=fonte)

    if busca:
        termo = busca.strip()
        digitos = _so_digitos(termo)
        alvo_texto = f"%{termo.lower()}%"
        condicoes = [func.lower(m.ConsultaUnificada.razao_social).like(alvo_texto)]
        if digitos:
            condicoes.append(m.ConsultaUnificada.numero_limpo.like(f"%{digitos}%"))
            condicoes.append(
                func.replace(
                    func.replace(
                        func.replace(m.ConsultaUnificada.cnpj_cpf, ".", ""), "/", ""
                    ), "-", ""
                ).like(f"%{digitos}%")
            )
        filtros.append(or_(*condicoes))

    if agente:
        filtros.append(m.ConsultaUnificada.agente_regulado == agente)
    if situacao:
        filtros.append(m.ConsultaUnificada.situacao == situacao)
    if fase:
        filtros.append(m.ConsultaUnificada.fase_atual == fase)
    if ano:
        filtros.append(m.ConsultaUnificada.ano == ano)
    if criacao_de:
        filtros.append(m.ConsultaUnificada.data_criacao_sei >= criacao_de)
    if criacao_ate:
        filtros.append(m.ConsultaUnificada.data_criacao_sei <= criacao_ate)
    if acao_de:
        filtros.append(m.ConsultaUnificada.data_ultima_acao >= acao_de)
    if acao_ate:
        filtros.append(m.ConsultaUnificada.data_ultima_acao <= acao_ate)

    stmt_total = select(func.count()).select_from(m.ConsultaUnificada)
    stmt = select(m.ConsultaUnificada)
    for f in filtros:
        stmt_total = stmt_total.where(f)
        stmt = stmt.where(f)

    total = db.scalar(stmt_total) or 0
    stmt = stmt.order_by(*_ordenacao(ordenar_por, ordem)).limit(limit).offset(offset)

    linhas = db.scalars(stmt).all()

    return ConsultaUnificadaOut(
        total=total,
        limit=limit,
        offset=offset,
        linhas=[LinhaConsultaOut.model_validate(l) for l in linhas],
    )
