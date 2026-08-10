"""Apura os apontamentos (não conformidades) de um relatório de fiscalização.

Origem dos dados (site **DETRAN-CQCFAR** do SharePoint):

- ``lista_perguntas``: banco de perguntas do checklist. A coluna
  ``Conformidade`` guarda **a resposta que caracteriza conformidade** para
  aquela pergunta — não é uma marcação de irregularidade.
- ``lista_resposta``: o que o fiscal respondeu, ligado ao relatório por
  ``IDRelatorio`` e à pergunta por ``IDPergunta``.

Regra: há apontamento quando ``Resposta != Conformidade``.

Por que não é "Conformidade = Sim significa irregular": as perguntas são
escritas nos dois sentidos, e a coluna acompanha o enunciado. Exemplos reais:

- "O local está aberto?" → ``Conformidade = Sim`` (estar aberto é o esperado)
- "Foi constatado manuseio do sistema por terceiro?" → ``Conformidade = Não``

Comparar contra a resposta esperada funciona nos dois casos. Os valores vêm do
SharePoint com espaços sobrando, caixa e acentuação variáveis (``'Sim '``,
``'SIM'``, ``'NÃO'``), então a comparação é normalizada.

Ficam **fora** da apuração:

- perguntas de texto livre (Conformidade vazia), incluindo a "Conclusão";
- itens marcados como "não se aplica" — seja na coluna ``Conformidade`` da
  pergunta (não há critério a cobrar), seja na resposta do fiscal (ele declarou
  que o item não cabia naquela fiscalização). Ver ``VALORES_NAO_APLICAVEIS``.
"""
from __future__ import annotations

import logging
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

SITE_CQCFAR_PATH = "/teams/DETRAN-CQCFAR"
LISTA_PERGUNTAS_ID = "eed11ddf-98a4-4e05-8790-cadbe65324bc"
LISTA_RESPOSTA_ID = "d11035b0-9223-4371-95d1-25f1ea105e05"

# Valores que significam "esta pergunta não se aplica a este caso" — aparecem
# tanto na coluna Conformidade da pergunta (quando não há resposta esperada a
# cobrar) quanto na resposta do fiscal. Em nenhum dos dois casos há como julgar
# conformidade, então o item fica fora da contagem.
#
# Levantados dos dados reais de lista_perguntas: 'Não se aplica' (35 perguntas),
# 'N/A' (25) e 'Notificação para regularização' (1 — encaminhamento, não um
# critério de conformidade).
VALORES_NAO_APLICAVEIS = {
    "nao se aplica",
    "n/a",
    "na",
    "nao aplicavel",
    "notificacao para regularizacao",
}

# O banco de perguntas é praticamente estático (950 itens) — cache de 1h.
_perguntas: Optional[dict[str, dict]] = None
_perguntas_em: float = 0.0
_PERGUNTAS_TTL = 3600.0
_lock = threading.Lock()


@dataclass
class Apontamento:
    """Uma pergunta cuja resposta divergiu da esperada."""
    pergunta: str
    resposta_esperada: str
    resposta_dada: str
    enquadramento: str = ""


@dataclass
class ResultadoConformidade:
    """Resumo da apuração de um relatório.

    ``avaliadas`` conta só as perguntas com resposta registrada E com uma
    resposta esperada julgável — é o denominador honesto de
    ``total_apontamentos``. Itens marcados como "não se aplica" (na pergunta ou
    na resposta) entram em ``nao_aplicaveis`` e ficam fora da conta.
    """
    total_apontamentos: int = 0
    avaliadas: int = 0
    sem_regra: int = 0
    nao_aplicaveis: int = 0
    conclusao: str = ""
    apontamentos: list[Apontamento] = field(default_factory=list)

    @property
    def em_conformidade(self) -> bool:
        return self.total_apontamentos == 0


def _normalizar(valor: Any) -> str:
    """Compara respostas ignorando acento, caixa e espaços sobrando."""
    if valor is None:
        return ""
    texto = unicodedata.normalize("NFKD", str(valor))
    texto = "".join(c for c in texto if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", texto).strip().lower()


def _id_numerico(valor: Any) -> str | None:
    """Normaliza IDs que o SharePoint devolve como float ('819.0' → '819')."""
    if valor is None or valor == "":
        return None
    try:
        return str(int(float(valor)))
    except (TypeError, ValueError):
        return str(valor).strip()


def carregar_perguntas(graph=None, site_id: str | None = None, forcar: bool = False) -> dict[str, dict]:
    """Carrega (com cache de 1h) o banco de perguntas indexado por id."""
    global _perguntas, _perguntas_em

    agora = time.time()
    if _perguntas is not None and not forcar and (agora - _perguntas_em) < _PERGUNTAS_TTL:
        return _perguntas

    with _lock:
        agora = time.time()
        if _perguntas is not None and not forcar and (agora - _perguntas_em) < _PERGUNTAS_TTL:
            return _perguntas

        mapa: dict[str, dict] = {}
        try:
            if graph is None or site_id is None:
                from app.core.sei_shared import get_graph_client
                graph, site_id = get_graph_client(SITE_CQCFAR_PATH)

            for campos in graph.iter_itens(site_id, LISTA_PERGUNTAS_ID, page_size=200):
                pid = _id_numerico(campos.get("id"))
                if not pid:
                    continue
                mapa[pid] = {
                    "texto": (campos.get("TextoPergunta") or "").strip(),
                    "conformidade": (campos.get("Conformidade") or "").strip(),
                    # Atenção: o nome interno da coluna tem um typo no SharePoint.
                    "tema": (campos.get("TemaPergunda") or "").strip(),
                    "enquadramento": (campos.get("Enquadramento") or "").strip(),
                }
            logger.info("lista_perguntas carregada: %d pergunta(s)", len(mapa))
        except Exception as e:  # noqa: BLE001
            logger.warning("Não foi possível carregar lista_perguntas: %s", e)
            return {}  # não cacheia a falha

        _perguntas = mapa
        _perguntas_em = time.time()
        return _perguntas


def apurar(id_relatorio: str | None, graph=None, site_id: str | None = None) -> ResultadoConformidade:
    """Apura os apontamentos de um relatório.

    Devolve um resultado vazio (``avaliadas == 0``) quando não há id_relatorio,
    quando o checklist ainda não foi preenchido, ou quando o SharePoint não
    responde — nunca levanta exceção, para não derrubar a tela que consome.
    """
    resultado = ResultadoConformidade()
    if not id_relatorio:
        return resultado

    try:
        if graph is None or site_id is None:
            from app.core.sei_shared import get_graph_client
            graph, site_id = get_graph_client(SITE_CQCFAR_PATH)

        respostas = graph.get_list_items_filtered(
            site_id, LISTA_RESPOSTA_ID, f"fields/IDRelatorio eq '{id_relatorio}'", top=300,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("Erro ao buscar respostas do relatório %s: %s", id_relatorio, e)
        return resultado

    if not respostas:
        return resultado  # fiscalização ainda não preencheu o checklist

    perguntas = carregar_perguntas(graph=graph, site_id=site_id)
    if not perguntas:
        return resultado

    for item in respostas:
        campos = item.get("fields", item)
        pid = _id_numerico(campos.get("IDPergunta"))
        pergunta = perguntas.get(pid or "")
        if not pergunta:
            continue

        resposta = (campos.get("Resposta") or "").strip()
        texto = pergunta["texto"]

        # A "Conclusão" é texto livre do fiscal, não um item de conformidade.
        if _normalizar(texto) == "conclusao":
            resultado.conclusao = resposta
            continue

        esperado = pergunta["conformidade"]
        esperado_norm = _normalizar(esperado)
        if not esperado_norm:
            # Pergunta sem resposta esperada (ex.: campos de texto livre).
            resultado.sem_regra += 1
            continue

        # "Não se aplica" na pergunta: não há critério a cobrar naquele caso.
        if esperado_norm in VALORES_NAO_APLICAVEIS:
            resultado.nao_aplicaveis += 1
            continue

        # "Não se aplica" na resposta: o fiscal declarou que o item não cabia
        # nesta fiscalização, então não é conformidade nem irregularidade.
        if _normalizar(resposta) in VALORES_NAO_APLICAVEIS:
            resultado.nao_aplicaveis += 1
            continue

        resultado.avaliadas += 1
        if _normalizar(resposta) != esperado_norm:
            resultado.total_apontamentos += 1
            resultado.apontamentos.append(Apontamento(
                pergunta=texto,
                resposta_esperada=esperado,
                resposta_dada=resposta,
                enquadramento=pergunta["enquadramento"],
            ))

    return resultado


def resetar_cache() -> None:
    """Descarta o banco de perguntas em memória (usado em testes)."""
    global _perguntas, _perguntas_em
    with _lock:
        _perguntas = None
        _perguntas_em = 0.0
