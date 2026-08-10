"""Dependências da API (sessão de banco, etc.)."""
from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.db import models  # noqa: F401  (garante o registro das tabelas)
from app.db.base import Base, get_engine, get_sessionmaker

_session_factory = None


def _factory():
    global _session_factory
    if _session_factory is None:
        engine = get_engine()
        Base.metadata.create_all(engine)  # cria as tabelas se ainda não existirem (dev)
        _session_factory = get_sessionmaker(engine)
    return _session_factory


def get_db() -> Iterator[Session]:
    db = _factory()()
    try:
        yield db
    finally:
        db.close()
