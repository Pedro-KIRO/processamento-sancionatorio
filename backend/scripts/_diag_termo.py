"""Diagnóstico temporário: por que o termo de instauração abre em branco."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from sqlalchemy import select

from app.db import models as m
from app.db.base import get_engine, get_sessionmaker

Session = get_sessionmaker(get_engine())

with Session() as s:
    print("=" * 78)
    print("Templates em config_template_despacho (agente | chave | tamanho do HTML)")
    print("=" * 78)
    for t in s.scalars(
        select(m.ConfigTemplateDespacho).order_by(
            m.ConfigTemplateDespacho.descricao_doc, m.ConfigTemplateDespacho.agente_regulado
        )
    ).all():
        tamanho = len(t.template_html or "")
        marca = "  <== VAZIO" if tamanho < 50 else ""
        print(f"  {t.agente_regulado:<16} {t.descricao_doc:<44} {tamanho:>7}{marca}")

    print()
    print("=" * 78)
    print("Agentes gravados na caixa de entrada")
    print("=" * 78)
    for a in s.scalars(select(m.CaixaEntrada.agente_regulado).distinct()).all():
        print(f"  {a!r}")

    print()
    print("=" * 78)
    print("Busca como o app faz, para cada agente da caixa")
    print("=" * 78)
    from app.services.catalogo_fases import buscar_template

    agentes = [a for a in s.scalars(select(m.CaixaEntrada.agente_regulado).distinct()).all() if a]
    for agente in agentes:
        for chave in ("termo_instauracao", "termo_instauracao_cautelar", "despacho_saneador"):
            achado = buscar_template(s, chave, agente)
            print(
                f"  {agente:<16} {chave:<30} -> "
                + (f"{achado.agente_regulado} ({len(achado.template_html)} chars)" if achado else "NADA")
            )

    print()
    print("=" * 78)
    print("Chave antiga usada pelo fluxo de instauração")
    print("=" * 78)
    from app.services.despachos_sei import (
        DESCRICAO_TEMPLATE_ARQUIVAR,
        DESCRICAO_TEMPLATE_INSTAURAR,
        DESCRICAO_TEMPLATE_TAC,
    )

    for descricao in (
        DESCRICAO_TEMPLATE_INSTAURAR, DESCRICAO_TEMPLATE_ARQUIVAR, DESCRICAO_TEMPLATE_TAC,
    ):
        achados = s.scalars(
            select(m.ConfigTemplateDespacho).where(
                m.ConfigTemplateDespacho.descricao_doc == descricao
            )
        ).all()
        print(f"  {descricao!r}: {len(achados)} registro(s)")
        for a in achados:
            print(f"      {a.agente_regulado} ({len(a.template_html or '')} chars)")
