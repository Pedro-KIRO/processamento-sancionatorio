"""Diagnóstico temporário: nome de cada idTipoProcedimento, com dados reais.

A listagem de processos traz o nome do tipo (``tipoProcesso``) mas não o id; a
consulta de um processo traz o id. Então: agrupa por nome na listagem e consulta
um processo de cada nome para descobrir o id.
"""
from __future__ import annotations

import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from app.core.sei_shared import get_sei_client

UNIDADES = {
    "110051045": "Perito (médicos e psicólogos)",
    "110051042": "Autoescola",
    "110053117": "ECV / Estampadora",
    "110051044": "Desmonte",
    "110053119": "Despachante",
}

NO_APP = {
    "100001998": "ECV",
    "100002001": "Médicos",
    "100002002": "Clínicas",
    "100002003": "Desmonte",
    "100002004": "Estampadora",
    "100002005": "Despachante",
    "100002006": "Psicólogos",
    "100003458": "Autoescola",
    "100003126": "Instituição de ensino",
}

sei = get_sei_client(timeout=60)

# nome do tipo -> (quantidade, um número de processo, unidade)
amostras: dict[str, tuple[int, str, str]] = {}
por_unidade: dict[str, Counter[str]] = defaultdict(Counter)

for unidade, rotulo in UNIDADES.items():
    try:
        resposta = sei.listar_processos(unidade, limit=500, start=0, tipo="T")
    except Exception as exc:  # noqa: BLE001
        print(f"{unidade} ({rotulo}): erro {type(exc).__name__}")
        continue

    processos = resposta.get("listaProcessos") or []
    print(f"{unidade} ({rotulo}): {len(processos)} processos de {resposta.get('total')}")

    for processo in processos:
        nome = str(processo.get("tipoProcesso") or "").strip()
        numero = str(processo.get("protocoloProcedimento") or "")
        if not nome:
            continue
        por_unidade[unidade][nome] += 1
        if nome in amostras:
            n, num, uni = amostras[nome]
            amostras[nome] = (n + 1, num, uni)
        else:
            amostras[nome] = (1, numero, unidade)

print()
print("=" * 90)
print("Tipos de processo por unidade")
print("=" * 90)
for unidade, contagem in por_unidade.items():
    print(f"\n  {unidade} ({UNIDADES[unidade]})")
    for nome, n in contagem.most_common():
        print(f"      {n:4}x  {nome}")

print()
print("=" * 90)
print("idTipoProcedimento de cada tipo (consultando um processo de cada)")
print("=" * 90)
resultado: list[tuple[str, str, int]] = []
for nome, (n, numero, unidade) in sorted(amostras.items()):
    idt = "?"
    try:
        dados = sei.consultar_processo(numero, unidade)
        idt = str((dados.get("tipoProcedimento") or {}).get("idTipoProcedimento") or "?")
    except Exception as exc:  # noqa: BLE001
        idt = f"erro: {type(exc).__name__}"
    resultado.append((idt, nome, n))

for idt, nome, n in sorted(resultado, key=lambda r: r[1]):
    marca = f"   <== app usa para '{NO_APP[idt]}'" if idt in NO_APP else ""
    print(f"  {idt:12} ({n:4}x) {nome}{marca}")

print()
print("Ids que o app usa e não apareceram na amostra:")
vistos = {r[0] for r in resultado}
faltantes = [(i, a) for i, a in NO_APP.items() if i not in vistos]
for idt, agente in sorted(faltantes, key=lambda kv: kv[1]):
    print(f"  {idt:12} {agente}")
if not faltantes:
    print("  nenhum")
