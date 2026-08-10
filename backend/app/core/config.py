"""Configurações do backend, lidas de variáveis de ambiente (.env)."""
import os

from dotenv import load_dotenv

from app.integrations.sei import SeiSettings
from app.integrations.graph import GraphSettings

load_dotenv()  # carrega backend/.env se existir


def _get(nome: str, default: str | None = None, obrigatorio: bool = False) -> str | None:
    valor = os.getenv(nome, default)
    if obrigatorio and not valor:
        raise RuntimeError(f"Variável de ambiente obrigatória ausente: {nome}")
    return valor


def sei_settings() -> SeiSettings:
    return SeiSettings(
        token_url=_get("SEI_TOKEN_URL", obrigatorio=True),
        client_id=_get("SEI_CLIENT_ID", obrigatorio=True),
        client_secret=_get("SEI_CLIENT_SECRET", obrigatorio=True),
        api_base=_get("SEI_API_BASE", obrigatorio=True),
        sigla_sistema=_get("SEI_SIGLA_SISTEMA", "CSDR_PROCESSAMENTO"),
        identificacao_servico=_get("SEI_IDENTIFICACAO_SERVICO", obrigatorio=True),
        trace_id=_get("SEI_TRACE_ID", "CSDR_PROCESSAMENTO_SEI"),
    )


def graph_settings() -> GraphSettings:
    return GraphSettings(
        tenant_id=_get("GRAPH_TENANT_ID", obrigatorio=True),
        client_id=_get("GRAPH_CLIENT_ID", obrigatorio=True),
        client_secret=_get("GRAPH_CLIENT_SECRET", obrigatorio=True),
        hostname=_get("SHAREPOINT_HOSTNAME", "governosp.sharepoint.com"),
        site_path=_get("SHAREPOINT_SITE_PATH", "/teams/DETRAN-CPSAR"),
    )
