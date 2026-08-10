"""Lista os tipos de documento (séries) do SEI, unidade por unidade.

O ``GET /series`` da API de parâmetros devolve as séries disponíveis para a
unidade do cabeçalho, então descobrir tudo exige uma chamada por unidade. O
``idSerie`` que sai daqui é o que ``incluir_documento`` espera — é assim que se
descobre a série correta de intimação, relatório opinativo, decisão etc.

Uso::

    cd backend/
    python scripts/listar_series_sei.py
    python scripts/listar_series_sei.py --filtro intima
    python scripts/listar_series_sei.py --json series.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

BASE_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_BACKEND, ".env"))

UNIDADES = {
    "110051045": "Médicos e psicólogos (Peritos)",
    "110051042": "Autoescola",
    "110053117": "ECV / EPIV",
    "110051044": "Desmontes",
    "110051043": "Instituições de ensino",
    "110053119": "Despachantes / Pátios",
}


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    ).lower()


def _extrair(resposta) -> list[dict]:
    """Normaliza a resposta: a API pode devolver lista ou objeto com a lista."""
    if isinstance(resposta, list):
        return resposta
    if isinstance(resposta, dict):
        for chave in ("Series", "series", "items", "content", "data"):
            valor = resposta.get(chave)
            if isinstance(valor, list):
                return valor
    return []


def main() -> None:
    parser = argparse.ArgumentParser(description="Lista as séries (tipos de documento) do SEI.")
    parser.add_argument("--filtro", help="Mostra só séries cujo nome contenha este texto.")
    parser.add_argument("--json", dest="arquivo_json", help="Grava o resultado completo neste arquivo.")
    args = parser.parse_args()

    from app.core.sei_shared import get_sei_client

    sei = get_sei_client(timeout=60)

    # idSerie → (nome, unidades em que aparece)
    catalogo: dict[str, tuple[str, list[str]]] = {}
    por_unidade: dict[str, list[dict]] = {}

    for unidade, rotulo in UNIDADES.items():
        try:
            resposta = sei.listar_series(unidade)
        except Exception as exc:  # noqa: BLE001
            print(f"{unidade} ({rotulo}): erro -> {type(exc).__name__}: {str(exc)[:120]}")
            continue

        series = _extrair(resposta)
        por_unidade[unidade] = series
        print(f"{unidade} ({rotulo}): {len(series)} séries")

        for serie in series:
            id_serie = str(serie.get("idSerie") or serie.get("id") or "")
            nome = str(serie.get("nome") or serie.get("descricao") or "")
            if not id_serie:
                continue
            if id_serie in catalogo:
                catalogo[id_serie][1].append(unidade)
            else:
                catalogo[id_serie] = (nome, [unidade])

    print()
    print("=" * 90)
    titulo = f"Séries distintas: {len(catalogo)}"
    if args.filtro:
        titulo += f" (filtrando por '{args.filtro}')"
    print(titulo)
    print("=" * 90)

    alvo = _sem_acento(args.filtro) if args.filtro else None
    for id_serie, (nome, unidades) in sorted(catalogo.items(), key=lambda kv: kv[1][0]):
        if alvo and alvo not in _sem_acento(nome):
            continue
        print(f"  {id_serie:>8}  {nome:<60} {len(unidades)}/{len(UNIDADES)} unidades")

    if args.arquivo_json:
        caminho = os.path.abspath(args.arquivo_json)
        with open(caminho, "w", encoding="utf-8") as fh:
            json.dump(
                {
                    "catalogo": {k: {"nome": v[0], "unidades": v[1]} for k, v in catalogo.items()},
                    "por_unidade": por_unidade,
                },
                fh, ensure_ascii=False, indent=2,
            )
        print(f"\nResultado completo em {caminho}")


if __name__ == "__main__":
    main()
