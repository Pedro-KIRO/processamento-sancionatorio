"""Cliente da API SEI (autenticacao e consultas de processo/andamentos)."""
import time

import requests


class SeiClient:
    def __init__(self, token_url, client_id, client_secret, api_base, sigla_sistema, identificacao_servico, trace_id):
        self.token_url = token_url
        self.client_id = client_id
        self.client_secret = client_secret
        self.api_base = api_base.rstrip("/")
        self.sigla_sistema = sigla_sistema
        self.identificacao_servico = identificacao_servico
        self.trace_id = trace_id
        self._token = None
        self._token_exp = 0

    def autenticar(self):
        dados = {
            "grant_type": "client_credentials",
            "client_id": self.client_id,
            "client_secret": self.client_secret,
        }
        cabecalho = {"Content-Type": "application/x-www-form-urlencoded"}
        resp = requests.post(self.token_url, data=dados, headers=cabecalho, timeout=60)
        resp.raise_for_status()
        corpo = resp.json()
        self._token = corpo["access_token"]
        self._token_exp = time.time() + int(corpo.get("expires_in", 3600))
        return self._token

    def _token_valido(self):
        if not self._token or time.time() >= self._token_exp - 60:
            self.autenticar()
        return self._token

    def _headers(self, id_unidade, extras=None):
        cabecalho = {
            "X-SiglaSistema": self.sigla_sistema,
            "X-IdentificacaoServico": self.identificacao_servico,
            "X-IdUnidade": str(id_unidade),
            "X-TraceId-SP": self.trace_id,
            "Authorization": f"Bearer {self._token_valido()}",
        }
        if extras:
            cabecalho.update(extras)
        return cabecalho

    def consultar_procedimento(self, numero_sei_limpo, id_unidade):
        url = f"{self.api_base}/processos/{numero_sei_limpo}"
        resp = requests.get(url, headers=self._headers(id_unidade), timeout=60)
        resp.raise_for_status()
        return resp.json()

    def listar_andamentos(self, id_procedimento, id_unidade):
        url = f"{self.api_base}/andamentos/completo"
        extras = {
            "protocoloProcedimento": str(id_procedimento),
            "retornaAtributos": "S",
            "tarefas": "5",
            "tipoHistorico": "Z",
            "start": "0",
            "limit": "90",
        }
        resp = requests.get(url, headers=self._headers(id_unidade, extras), timeout=60)
        resp.raise_for_status()
        return resp.json()