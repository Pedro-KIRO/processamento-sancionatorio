"""Integração com a API do SEI."""
from .client import (
    SeiApiError,
    SeiAuthError,
    SeiClient,
    SeiErroDefinitivoError,
    SeiIndisponivelError,
    SeiSettings,
)

__all__ = [
    "SeiClient",
    "SeiSettings",
    "SeiAuthError",
    "SeiApiError",
    "SeiIndisponivelError",
    "SeiErroDefinitivoError",
]
