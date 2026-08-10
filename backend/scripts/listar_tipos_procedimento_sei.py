"""Lista os tipos de procedimento do SEI, unidade por unidade.

O ``GET /processos/tipos`` devolve os tipos disponíveis para a unidade do
cabeçalho, então conhecer tudo exige uma chamada por unidade. O
``idTipoProcedimento`` daqui é o que ``criar_processo`` usa na instauração — é
assim que se confere o conteúdo de ``config_tipo_procedimento``.

Uso::

    cd backend/
    python scripts/listar_tipos_procedimento_sei.py
    python scripts/listar_tipos_procedimento_sei.py --filtro sancionatorio
    python scripts/listar_tipos_procedimento_sei.py --conferir
"""
from __future__ import annotations

import argparse
import os
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

BASE_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_BACKEND, ".env"))

from sqlalchemy import select

from app.db import models as m
from app.db.base import get_engine, get_sessionmaker

UNIDADES = {
    "110051045": "Peritos (médicos e psicólogos)",
    "110051042": "Autoescola",
    "110053117": "ECV / Estampadora",
    "110051044": "Desmonte",
    "110051043": "Instituições de ensino",
    "110053119": "Despachante / Pátios",
}


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    ).lower()


def _extrair(resposta) -> list[dict]:
    """Achata a resposta em uma lista de tipos.

    O formato devolvido é ``{"listaTiposProcedimento": [{"tipoProcedimento":
    {...}}, ...]}`` — cada item embrulha o tipo em outra chave.
    """
    bruto: list = []
    if isinstance(resposta, list):
        bruto = resposta
    elif isinstance(resposta, dict):
        for chave in ("listaTiposProcedimento", "tiposProcedimento", "tipos", "items", "content", "data"):
            valor = resposta.get(chave)
            if isinstance(valor, list):
                bruto = valor
                break

    tipos: list[dict] = []
    for item in bruto:
        if isinstance(item, dict):
            tipos.append(item.get("tipoProcedimento") or item)
    return tipos


def main() -> None:
    parser = argparse.ArgumentParser(description="Lista os tipos de procedimento do SEI.")
    parser.add_argument("--filtro", help="Mostra só tipos cujo nome contenha este texto.")
    parser.add_argument(
        "--conferir", action="store_true",
        help="Compara com config_tipo_procedimento e aponta divergências.",
    )
    args = parser.parse_args()

    from app.core.sei_shared import get_sei_client

    sei = get_sei_client(timeout=60)

    # idTipoProcedimento → (nome, unidades onde aparece)
    catalogo: dict[str, tuple[str, list[str]]] = {}

    for unidade, rotulo in UNIDADES.items():
        try:
            resposta = sei.listar_tipos_procedimento(unidade)
        except Exception as exc:  # noqa: BLE001
            print(f"{unidade} ({rotulo}): erro -> {type(exc).__name__}: {str(exc)[:120]}")
            continue

        tipos = _extrair(resposta)
        print(f"{unidade} ({rotulo}): {len(tipos)} tipos")

        for tipo in tipos:
            id_tipo = str(tipo.get("idTipoProcedimento") or tipo.get("id") or "")
            nome = str(tipo.get("nome") or tipo.get("descricao") or "")
            if not id_tipo:
                continue
            if id_tipo in catalogo:
                catalogo[id_tipo][1].append(unidade)
            else:
                catalogo[id_tipo] = (nome, [unidade])

    print()
    print("=" * 96)
    titulo = f"Tipos distintos: {len(catalogo)}"
    if args.filtro:
        titulo += f" (filtrando por '{args.filtro}')"
    print(titulo)
    print("=" * 96)

    alvo = _sem_acento(args.filtro) if args.filtro else None
    for id_tipo, (nome, unidades) in sorted(catalogo.items(), key=lambda kv: kv[1][0]):
        if alvo and alvo not in _sem_acento(nome):
            continue
        print(f"  {id_tipo:>10}  {nome:<66} {len(unidades)}/{len(UNIDADES)} un.")

    if args.conferir:
        print()
        print("=" * 96)
        print("Conferência com config_tipo_procedimento")
        print("=" * 96)
        Session = get_sessionmaker(get_engine())
        with Session() as s:
            registros = s.scalars(select(m.ConfigTipoProcedimento)).all()
            for r in sorted(registros, key=lambda x: x.agente_regulado):
                achado = catalogo.get(str(r.id_tipo_procedimento))
                if achado:
                    print(f"  {r.agente_regulado:24} {r.id_tipo_procedimento:>10}  {achado[0]}")
                else:
                    print(
                        f"  {r.agente_regulado:24} {r.id_tipo_procedimento:>10}  "
                        "*** não encontrado nas unidades consultadas ***"
                    )


if __name__ == "__main__":
    main()
