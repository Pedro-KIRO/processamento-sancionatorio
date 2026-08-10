"""Ajusta a formatação da Citação: campos 'Nº do Processo' e 'Interessado'
passam de justificado à esquerda (negrito) para centralizado, igual ao
estilo do Termo de Instauração.

Uso:
    cd backend/
    python scripts/ajustar_formato_citacao.py --dry-run
    python scripts/ajustar_formato_citacao.py
"""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app.db.base import get_engine, get_sessionmaker
from app.db import models as m


def ajustar_html(html: str) -> str:
    """Troca os parágrafos de 'Nº do Processo' e 'Interessado' na Citação
    de Texto_Justificado_Maiusculas para Texto_Centralizado.

    Antes:
      <p class="Texto_Justificado_Maiusculas" ...><strong>Nº do Processo:</strong> ...
    Depois:
      <p class="Texto_Centralizado" ...><strong>Nº do Processo:</strong> ...
    """
    # Substituir a classe nos parágrafos que contêm "Processo" ou "Interessado"
    # Padrão: <p class="Texto_Justificado_Maiusculas" ...>...(Processo|Interessado)...
    def substituir(match):
        tag = match.group(0)
        # Trocar a classe
        tag = tag.replace('Texto_Justificado_Maiusculas', 'Texto_Centralizado')
        # Remover text-align:justify se houver inline style e trocar por center
        tag = re.sub(r'text-align:\s*justify', 'text-align:center', tag)
        # Remover text-transform:uppercase do inline (a classe Texto_Centralizado não tem)
        return tag

    # Encontrar parágrafos com a classe problemática que contêm "Processo" ou "Interessado"
    padrao = re.compile(
        r'<p\s+class="Texto_Justificado_Maiusculas"[^>]*>.*?</p>',
        re.DOTALL | re.IGNORECASE,
    )

    def callback(match):
        texto = match.group(0)
        if 'Processo' in texto or 'Interessado' in texto or 'processo' in texto or 'interessado' in texto:
            return substituir(match)
        return texto

    return padrao.sub(callback, html)


def main() -> None:
    dry_run = '--dry-run' in sys.argv

    db = get_sessionmaker(get_engine())()
    try:
        # Buscar templates de citação
        registros = (
            db.query(m.ConfigTemplateDespacho)
            .filter(m.ConfigTemplateDespacho.descricao_doc.ilike('%citacao%'))
            .all()
        )

        if not registros:
            print("Nenhum template de citação encontrado no banco.")
            return

        alterados = 0
        for reg in registros:
            html_original = reg.template_html
            html_novo = ajustar_html(html_original)

            if html_novo != html_original:
                alterados += 1
                print(f"  [{'DRY' if dry_run else '✓'}] ID {reg.id}: {reg.descricao_doc} ({reg.agente_regulado})")
                if not dry_run:
                    reg.template_html = html_novo
            else:
                print(f"  [=] ID {reg.id}: {reg.descricao_doc} — sem alteração necessária")

        if alterados and not dry_run:
            db.commit()
            print(f"\n{alterados} template(s) atualizado(s).")
        elif alterados:
            print(f"\n{alterados} template(s) seriam atualizados. Rode sem --dry-run para aplicar.")
        else:
            print("\nNenhuma alteração necessária.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
