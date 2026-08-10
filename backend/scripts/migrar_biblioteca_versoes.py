"""Adiciona versionamento à Biblioteca.

Cria a coluna ``versao_atual`` em ``biblioteca_texto`` e a tabela
``biblioteca_versao`` (histórico de edições).

Uso::

    cd backend/
    python scripts/migrar_biblioteca_versoes.py --dry-run
    python scripts/migrar_biblioteca_versoes.py
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

BASE_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_BACKEND, ".env"))

from sqlalchemy import inspect, text

from app.db.base import Base, get_engine, get_sessionmaker


def main() -> None:
    parser = argparse.ArgumentParser(description="Adiciona versionamento à Biblioteca.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    engine = get_engine()
    insp = inspect(engine)

    # 1. Coluna versao_atual em biblioteca_texto
    colunas = {c["name"] for c in insp.get_columns("biblioteca_texto")}
    if "versao_atual" not in colunas:
        print("  + biblioteca_texto.versao_atual: adicionando")
        if not args.dry_run:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE biblioteca_texto ADD COLUMN versao_atual INTEGER DEFAULT 1"
                ))
            # Preencher registros existentes
            with engine.begin() as conn:
                conn.execute(text("UPDATE biblioteca_texto SET versao_atual = 1 WHERE versao_atual IS NULL"))
    else:
        print("  = biblioteca_texto.versao_atual já existe")

    # 2. Tabela biblioteca_versao
    if "biblioteca_versao" not in insp.get_table_names():
        print("  + tabela biblioteca_versao: criando")
        if not args.dry_run:
            from app.db import models  # noqa: F401 — registra os modelos na Base
            Base.metadata.tables["biblioteca_versao"].create(engine)
    else:
        print("  = tabela biblioteca_versao já existe")

    if args.dry_run:
        print("\n[DRY-RUN] Nada foi gravado.")
    else:
        print("\nMigração concluída.")


if __name__ == "__main__":
    main()
