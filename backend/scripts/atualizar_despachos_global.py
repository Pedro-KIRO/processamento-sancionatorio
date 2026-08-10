"""Muda o agente_regulado dos textos-padrão 159 e 161 para 'Qualquer' (global).

Uso:
    cd backend/
    python scripts/atualizar_despachos_global.py
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app.db.base import get_engine, get_sessionmaker
from app.db import models as m


IDS_PARA_GLOBAL = [159, 161]


def main() -> None:
    db = get_sessionmaker(get_engine())()
    try:
        alterados = 0
        for texto_id in IDS_PARA_GLOBAL:
            registro = db.get(m.ConfigTemplateDespacho, texto_id)
            if not registro:
                print(f"  [!] ID {texto_id} não encontrado na tabela.")
                continue

            antigo = registro.agente_regulado
            if antigo == "Qualquer":
                print(f"  [=] ID {texto_id} já é global (Qualquer). Nenhuma mudança.")
                continue

            registro.agente_regulado = "Qualquer"
            alterados += 1
            print(f"  [✓] ID {texto_id}: '{antigo}' → 'Qualquer'")

        if alterados:
            db.commit()
            print(f"\n{alterados} registro(s) atualizado(s) com sucesso.")
        else:
            print("\nNenhuma alteração necessária.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
