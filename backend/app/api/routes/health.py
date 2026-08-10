"""Endpoint de verificação de saúde da API."""
from fastapi import APIRouter

router = APIRouter(tags=["infra"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}
