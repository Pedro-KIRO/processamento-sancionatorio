"""Configuração do SQLAlchemy: Base declarativa, engine e fábrica de sessão."""
import os

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    """Base declarativa para todos os modelos."""


def get_engine(url: str | None = None) -> Engine:
    """Cria o engine. Usa DATABASE_URL do ambiente ou SQLite local por padrão."""
    url = url or os.getenv("DATABASE_URL", "sqlite:///./processamento.db")
    return create_engine(url, future=True)


def get_sessionmaker(engine: Engine | None = None):
    return sessionmaker(bind=engine or get_engine(), autoflush=False, future=True)
