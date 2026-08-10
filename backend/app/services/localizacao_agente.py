"""Resolve município e superintendência de um agente regulado.

Origem dos dados: lista **listaMunicipios** do SharePoint (site DETRAN-DGR),
que relaciona município → superintendência regional. É a mesma ligação que o
app de Fiscalização (Power Apps) faz:

    listaDesignacao.cidade
      → LookUp(listaMunicipios, Cidade = cidade).Superintendencia

Detalhe importante da lista: os nomes de exibição no Power Apps
(``Cidade``/``Superintendencia``) **não** são os nomes internos que o Graph
devolve. Internamente são ``field_N``:

===================  ============  ==========================================
Exibição             Interno       Conteúdo
===================  ============  ==========================================
``Cidade``           ``field_1``   município sem acento (chave de busca)
``Superintendencia`` ``field_2``   superintendência sem acento
``Municipio``        ``field_3``   município com acento (para exibir)
``Super``            ``field_4``   superintendência com acento (para exibir)
===================  ============  ==========================================

Casamos pelo campo sem acento e devolvemos os acentuados, prontos para a tela.
A lista tem poucos milhares de linhas e praticamente não muda, então é
carregada uma vez por processo e mantida em memória.
"""
from __future__ import annotations

import logging
import re
import threading
import unicodedata
from typing import Optional

logger = logging.getLogger(__name__)

# listaMunicipios — site DETRAN-DGR
SITE_DGR_PATH = "/teams/DETRAN-DGR"
LISTA_MUNICIPIOS_ID = "1d0e99a3-5bc7-4937-8dc0-a05c527818ef"

CAMPO_CIDADE_CHAVE = "field_1"       # município sem acento
CAMPO_SUPER_CHAVE = "field_2"        # superintendência sem acento
CAMPO_MUNICIPIO_EXIBICAO = "field_3"  # município com acento
CAMPO_SUPER_EXIBICAO = "field_4"      # superintendência com acento

# chave normalizada → (municipio_exibicao, superintendencia_exibicao)
_mapa: Optional[dict[str, tuple[str, str]]] = None
_lock = threading.Lock()


def normalizar(texto: str | None) -> str:
    """Normaliza um nome de município para comparação.

    Remove acentos, pontuação e espaços extras, e passa para minúsculas — a
    grafia varia entre as listas (``Aracatuba`` vs ``Araçatuba``, ``SAO PAULO``
    vs ``São Paulo``), então comparar direto falharia.
    """
    if not texto:
        return ""
    sem_acento = unicodedata.normalize("NFKD", str(texto))
    sem_acento = "".join(c for c in sem_acento if not unicodedata.combining(c))
    sem_acento = re.sub(r"[^\w\s]", " ", sem_acento)
    return re.sub(r"\s+", " ", sem_acento).strip().lower()


def carregar_mapa(graph=None, site_id: str | None = None, forcar: bool = False) -> dict[str, tuple[str, str]]:
    """Carrega (e cacheia) o mapa município → superintendência.

    Retorna um dicionário vazio se o Graph não estiver configurado ou a lista
    não puder ser lida — quem chama trata a ausência como "não resolvido", sem
    quebrar o fluxo principal.
    """
    global _mapa
    if _mapa is not None and not forcar:
        return _mapa

    with _lock:
        if _mapa is not None and not forcar:
            return _mapa

        mapa: dict[str, tuple[str, str]] = {}
        try:
            if graph is None or site_id is None:
                from app.core.sei_shared import get_graph_client
                graph, site_id = get_graph_client(SITE_DGR_PATH)

            for campos in graph.iter_itens(site_id, LISTA_MUNICIPIOS_ID, page_size=200):
                chave = normalizar(campos.get(CAMPO_CIDADE_CHAVE))
                if not chave:
                    continue
                municipio = (
                    campos.get(CAMPO_MUNICIPIO_EXIBICAO)
                    or campos.get(CAMPO_CIDADE_CHAVE)
                    or ""
                )
                superintendencia = (
                    campos.get(CAMPO_SUPER_EXIBICAO)
                    or campos.get(CAMPO_SUPER_CHAVE)
                    or ""
                )
                mapa[chave] = (str(municipio).strip(), str(superintendencia).strip())

            logger.info("listaMunicipios carregada: %d município(s)", len(mapa))
        except Exception as e:  # noqa: BLE001
            logger.warning("Não foi possível carregar listaMunicipios: %s", e)
            # Não cacheia o fracasso: a próxima chamada tenta de novo.
            return {}

        _mapa = mapa
        return _mapa


def resolver(cidade: str | None, graph=None, site_id: str | None = None) -> tuple[str | None, str | None]:
    """Devolve ``(municipio, superintendencia)`` para uma cidade.

    Retorna ``(None, None)`` se a cidade não constar em listaMunicipios — caso
    real quando o cadastro do agente tem a cidade escrita de forma divergente.
    """
    chave = normalizar(cidade)
    if not chave:
        return None, None

    mapa = carregar_mapa(graph=graph, site_id=site_id)
    achado = mapa.get(chave)
    if not achado:
        logger.info("Município não encontrado em listaMunicipios: %r", cidade)
        return None, None

    municipio, superintendencia = achado
    return (municipio or None), (superintendencia or None)


def resetar_cache() -> None:
    """Descarta o mapa em memória (usado em testes)."""
    global _mapa
    with _lock:
        _mapa = None
