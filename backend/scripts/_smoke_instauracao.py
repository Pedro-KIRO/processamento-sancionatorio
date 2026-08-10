"""Verificação temporária: o termo de instauração vem preenchido?"""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import models as m
from app.db.base import get_engine, get_sessionmaker
from app.main import app

c = TestClient(app)

with get_sessionmaker(get_engine())() as s:
    itens = s.scalars(select(m.CaixaEntrada).limit(5)).all()
    amostras = [(i.id, i.agente_regulado, i.razao_social) for i in itens]

for item_id, agente, razao in amostras:
    print("=" * 78)
    print(f"item {item_id} | agente {agente} | {razao}")
    print("=" * 78)
    for rotulo, params in [
        ("padrão", {}),
        ("cautelar", {"cautelar": "true"}),
    ]:
        r = c.get(f"/caixa-entrada/{item_id}/despachos/instaurar", params=params)
        if r.status_code != 200:
            print(f"  {rotulo:10} HTTP {r.status_code}: {r.text[:160]}")
            continue
        dados = r.json()
        html = dados["html"]
        texto = re.sub(r"<[^>]+>", " ", html)
        texto = re.sub(r"\s+", " ", texto).strip()
        print(f"  {rotulo:10} {len(html):>6} chars de HTML | modelos: "
              f"{[m['chave'] for m in dados.get('modelos', [])]}")
        print(f"             início: {texto[:150]}")
        # O que precisa ter sido substituído
        if razao and razao.upper() in html.upper():
            print("             razão social preenchida: sim")
        if "XXXX" in html:
            print("             ATENÇÃO: ainda há marcador XXXX")
        if "Timbre" in html or "Governo do Estado" in html:
            print("             ATENÇÃO: cabeçalho institucional não foi removido")

    print()

print("=" * 78)
print("Arquivar (Decisão 743)")
print("=" * 78)
if amostras:
    r = c.get("/despachos/arquivar", params={"item_id": amostras[0][0]})
    print(f"  HTTP {r.status_code} | {len(r.json()['html']) if r.status_code == 200 else r.text[:160]}")
