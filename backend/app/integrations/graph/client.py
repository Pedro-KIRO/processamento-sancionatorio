"""Cliente do Microsoft Graph para leitura de listas do SharePoint.

Usado principalmente na MIGRAÇÃO dos dados das listas para o banco do novo
sistema. Autenticação via OAuth2 client_credentials (mesmo padrão do
SeiClient), sem dependência do msal.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Iterator, Optional

import requests

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


@dataclass
class GraphSettings:
    tenant_id: str
    client_id: str
    client_secret: str
    hostname: str
    site_path: str


class GraphAuthError(RuntimeError):
    """Falha ao obter o token de acesso do Microsoft Graph."""


class GraphClient:
    """Cliente do Microsoft Graph (somente leitura, para a migração)."""

    def __init__(self, settings: GraphSettings, session: Optional[Any] = None,
                 get_token: Optional[Any] = None, timeout: int = 60):
        self.settings = settings
        self.session = session or requests.Session()
        self.timeout = timeout
        self._get_token = get_token  # provedor de token injetável (testes)
        self._token: Optional[str] = None
        self._token_exp: float = 0.0

    def _autenticar(self) -> str:
        if self._get_token is not None:
            self._token = self._get_token()
            self._token_exp = time.time() + 3000
            return self._token  # type: ignore[return-value]
        url = f"https://login.microsoftonline.com/{self.settings.tenant_id}/oauth2/v2.0/token"
        resp = self.session.post(
            url,
            data={
                "grant_type": "client_credentials",
                "client_id": self.settings.client_id,
                "client_secret": self.settings.client_secret,
                "scope": "https://graph.microsoft.com/.default",
            },
            timeout=self.timeout,
        )
        resp.raise_for_status()
        corpo = resp.json()
        token = corpo.get("access_token")
        if not token:
            raise GraphAuthError("Resposta de token sem 'access_token'.")
        self._token = token
        self._token_exp = time.time() + int(corpo.get("expires_in", 3600))
        return token

    def _token_valido(self) -> str:
        if not self._token or time.time() >= self._token_exp - 60:
            self._autenticar()
        return self._token  # type: ignore[return-value]

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._token_valido()}",
            "Accept": "application/json",
        }

    def _get(self, url: str, params: Optional[dict] = None) -> dict:
        resp = self.session.get(url, headers=self._headers(), params=params, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Sites / listas / itens
    # ------------------------------------------------------------------
    def get_site_id(self) -> str:
        path = self.settings.site_path.strip("/")
        url = f"{GRAPH_BASE}/sites/{self.settings.hostname}:/{path}"
        return self._get(url)["id"]

    def listar_listas(self, site_id: str) -> list:
        url = f"{GRAPH_BASE}/sites/{site_id}/lists"
        return self._get(url, params={"$top": 200}).get("value", [])

    def obter_id_lista(self, site_id: str, display_name: str) -> str:
        for lst in self.listar_listas(site_id):
            if display_name in (lst.get("displayName"), lst.get("name")):
                return lst["id"]
        raise KeyError(f"Lista nao encontrada: {display_name}")

    def iter_itens(self, site_id: str, list_id: str, page_size: int = 200) -> Iterator[dict]:
        """Itera os campos (fields) de cada item da lista, seguindo a paginação."""
        url = f"{GRAPH_BASE}/sites/{site_id}/lists/{list_id}/items"
        params: Optional[dict] = {"expand": "fields", "$top": page_size}
        while url:
            dados = self._get(url, params=params)
            for item in dados.get("value", []):
                yield item.get("fields", {})
            url = dados.get("@odata.nextLink")
            params = None  # o nextLink já carrega os parâmetros

    def get_list_items_filtered(self, site_id: str, list_id: str, filter_expr: str, top: int = 5) -> list:
        """Busca itens de uma lista com filtro OData. Retorna lista de items (com 'fields')."""
        url = f"{GRAPH_BASE}/sites/{site_id}/lists/{list_id}/items"
        params = {
            "$expand": "fields",
            "$filter": filter_expr,
            "$top": str(top),
        }
        headers = self._headers()
        headers["Prefer"] = "HonorNonIndexedQueriesWarningMayFailRandomly"
        resp = self.session.get(url, headers=headers, params=params, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json().get("value", [])
