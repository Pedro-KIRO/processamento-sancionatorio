"""Clientes SEI e Graph compartilhados entre requests.

Motivação (performance): antes, cada request HTTP criava um ``SeiClient`` novo,
o que forçava uma autenticação OAuth completa contra o IdP do SEI a cada
chamada. Numa tela que faz 3-4 requests (detalhes, documentos, histórico,
fase atual), isso significava 3-4 idas ao IdP só para obter tokens — o
principal motivo de as telas parecerem "carregando infinitamente".

Aqui mantemos uma única instância por processo. O ``SeiClient`` cacheia o
token em memória e o renova sozinho com folga de 60s, e a renovação é
protegida por lock (ver ``SeiClient._token_valido``), então compartilhar a
instância entre threads é seguro.

O mesmo vale para o ``GraphClient``: ``get_site_id()`` fazia uma chamada de
rede ao SharePoint em cada abertura do modal de despacho. Aqui o site_id é
resolvido uma vez e reaproveitado.
"""
from __future__ import annotations

import threading
from typing import Optional

from app.core.config import sei_settings
from app.integrations.graph.client import GraphClient, GraphSettings
from app.integrations.sei.client import SeiClient

_sei_lock = threading.Lock()
_sei_client: Optional[SeiClient] = None

_graph_lock = threading.Lock()
_graph_cache: dict[str, tuple[GraphClient, str]] = {}


def get_sei_client(timeout: int = 30) -> SeiClient:
    """Retorna o ``SeiClient`` compartilhado do processo (cria na primeira vez).

    O ``timeout`` só é aplicado na criação da instância — chamadas seguintes
    reaproveitam o cliente já existente. Isso é intencional: queremos uma
    única instância para aproveitar o cache de token.
    """
    global _sei_client
    if _sei_client is None:
        with _sei_lock:
            if _sei_client is None:
                _sei_client = SeiClient(sei_settings(), timeout=timeout)
    return _sei_client


def get_graph_client(site_path: str = "/teams/DETRAN-CPSAR", timeout: int = 30) -> tuple[GraphClient, str]:
    """Retorna (GraphClient, site_id) compartilhados para um site do SharePoint.

    O site_id é resolvido uma única vez por ``site_path`` e reaproveitado —
    evita uma chamada de rede por request. Levanta ``RuntimeError`` se as
    credenciais do Graph não estiverem configuradas, e propaga o erro original
    se a resolução do site falhar (para quem chama decidir se é fatal).
    """
    import os

    cacheado = _graph_cache.get(site_path)
    if cacheado is not None:
        return cacheado

    tenant = os.getenv("GRAPH_TENANT_ID", "")
    client_id = os.getenv("GRAPH_CLIENT_ID", "")
    client_secret = os.getenv("GRAPH_CLIENT_SECRET", "")
    if not tenant or not client_id or not client_secret:
        raise RuntimeError("Graph não configurado")

    with _graph_lock:
        cacheado = _graph_cache.get(site_path)
        if cacheado is not None:
            return cacheado
        settings = GraphSettings(
            tenant_id=tenant,
            client_id=client_id,
            client_secret=client_secret,
            hostname=os.getenv("SHAREPOINT_HOSTNAME", "governosp.sharepoint.com"),
            site_path=site_path,
        )
        graph = GraphClient(settings, timeout=timeout)
        site_id = graph.get_site_id()
        _graph_cache[site_path] = (graph, site_id)
        return graph, site_id


def resetar_clientes() -> None:
    """Descarta os clientes cacheados (usado em testes)."""
    global _sei_client
    with _sei_lock:
        _sei_client = None
    with _graph_lock:
        _graph_cache.clear()
