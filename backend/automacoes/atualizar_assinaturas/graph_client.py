"""Cliente do Microsoft Graph para ler e atualizar listas do SharePoint."""
import time
import requests
import msal

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
SCOPE = ["https://graph.microsoft.com/.default"]


class GraphClient:
    def __init__(self, tenant_id, client_id, client_secret):
        self._app = msal.ConfidentialClientApplication(
            client_id,
            authority=f"https://login.microsoftonline.com/{tenant_id}",
            client_credential=client_secret,
        )
        self._token = None
        self._token_exp = 0

    def _get_token(self):
        agora = time.time()
        if self._token and agora < self._token_exp - 60:
            return self._token
        resultado = self._app.acquire_token_for_client(scopes=SCOPE)
        if "access_token" not in resultado:
            erro = resultado.get("error_description") or resultado
            raise RuntimeError(f"Falha ao obter token Graph: {erro}")
        self._token = resultado["access_token"]
        self._token_exp = agora + int(resultado.get("expires_in", 3600))
        return self._token

    def _headers(self):
        return {"Authorization": f"Bearer {self._get_token()}", "Accept": "application/json"}

    def _request(self, metodo, url, **kwargs):
        for tentativa in range(5):
            resp = requests.request(metodo, url, headers=self._headers(), timeout=60, **kwargs)
            if resp.status_code == 429:
                espera = int(resp.headers.get("Retry-After", 5))
                time.sleep(espera)
                continue
            if resp.status_code >= 400:
                raise RuntimeError(f"Graph {metodo} {url} -> {resp.status_code}: {resp.text}")
            return resp
        raise RuntimeError(f"Graph {metodo} {url}: excedeu tentativas (429)")

    def get_site_id(self, hostname, site_path):
        url = f"{GRAPH_BASE}/sites/{hostname}:{site_path}"
        return self._request("GET", url).json()["id"]

    def get_lists(self, site_id):
        url = f"{GRAPH_BASE}/sites/{site_id}/lists?$select=id,name,displayName&$top=200"
        mapa = {}
        while url:
            dados = self._request("GET", url).json()
            for lst in dados.get("value", []):
                mapa[lst.get("displayName")] = lst["id"]
                mapa[lst.get("name")] = lst["id"]
            url = dados.get("@odata.nextLink")
        return mapa

    def get_list_id(self, site_id, nome):
        mapa = self.get_lists(site_id)
        if nome not in mapa:
            raise RuntimeError(f"Lista nao encontrada: {nome}. Disponiveis: {sorted(mapa)}")
        return mapa[nome]

    def get_all_items(self, site_id, list_id, expand_fields=True):
        sufixo = "?expand=fields&$top=200" if expand_fields else "?$top=200"
        url = f"{GRAPH_BASE}/sites/{site_id}/lists/{list_id}/items{sufixo}"
        itens = []
        while url:
            dados = self._request("GET", url).json()
            itens.extend(dados.get("value", []))
            url = dados.get("@odata.nextLink")
        return itens

    def update_item_fields(self, site_id, list_id, item_id, campos):
        url = f"{GRAPH_BASE}/sites/{site_id}/lists/{list_id}/items/{item_id}/fields"
        return self._request("PATCH", url, json=campos).json()