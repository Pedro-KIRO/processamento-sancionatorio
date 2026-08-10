"""Adiciona ``caixa_entrada.agente_origem`` e preenche os itens existentes.

Por que a coluna é necessária: a varredura consolida o agente em seis classes,
e "Perito" reúne clínicas, médicos e psicólogos. Só que o SEI **não tem** um
tipo de procedimento único para perito — a instauração exige escolher entre
Clínica (100002002), Médico (100002001) e Psicólogo (100002006), confirmado em
``GET /processos/tipos``. Sem guardar o nome original, o app perde a informação
que define o tipo e a instauração de perito não tem como acertar.

O `create_all` do SQLAlchemy só cria tabelas novas, então a coluna é adicionada
aqui por ``ALTER TABLE``. É uma operação aditiva: nenhum dado existente é
alterado ou removido.

O preenchimento dos itens atuais vem da listaDesignacao, casada por
``id_relatorio``.

Uso::

    cd backend/
    python scripts/migrar_agente_origem.py --dry-run
    python scripts/migrar_agente_origem.py
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

BASE_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_BACKEND, ".env"))

from sqlalchemy import inspect, select, text

from app.db import models as m
from app.db.base import get_engine, get_sessionmaker
from app.services.agentes_regulados import normalizar, subclasse

SITE_DCAN_PATH = "/teams/DETRAN-DCAN"
LISTA_DESIGNACAO_ID = "2855ddc6-c7e4-4b1a-a972-5bb939f378d3"


def coluna_existe(engine, tabela: str, coluna: str) -> bool:
    return coluna in {c["name"] for c in inspect(engine).get_columns(tabela)}


def adicionar_coluna(engine, dry_run: bool) -> bool:
    """Cria a coluna se ela ainda não existir. Devolve True se criou."""
    if coluna_existe(engine, "caixa_entrada", "agente_origem"):
        print("Coluna agente_origem já existe.")
        return False

    print("Coluna agente_origem ausente: adicionando (ALTER TABLE).")
    if not dry_run:
        with engine.begin() as conexao:
            conexao.execute(
                text("ALTER TABLE caixa_entrada ADD COLUMN agente_origem VARCHAR(120)")
            )
        print("Coluna criada.")
    return True


def preencher(Session, dry_run: bool) -> None:
    """Preenche agente_origem dos itens que ainda não têm, pela listaDesignacao."""
    with Session() as s:
        pendentes = s.scalars(
            select(m.CaixaEntrada).where(m.CaixaEntrada.agente_origem.is_(None))
        ).all()
        alvos = {i.id_relatorio: i.id for i in pendentes if i.id_relatorio}

    if not pendentes:
        print("Nenhum item sem agente_origem.")
        return

    print(f"Itens sem agente_origem: {len(pendentes)} (com id_relatorio: {len(alvos)})")
    if not alvos:
        print("Nenhum deles tem id_relatorio — não há como casar com a listaDesignacao.")
        return

    from app.core.sei_shared import get_graph_client

    try:
        graph, site_id = get_graph_client(SITE_DCAN_PATH)
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Graph indisponível: {exc}")

    encontrados: dict[int, str] = {}
    lidos = 0
    for campos in graph.iter_itens(site_id, LISTA_DESIGNACAO_ID, page_size=200):
        lidos += 1
        id_relatorio = (campos.get("ID_Relatorio") or "").strip()
        item_id = alvos.get(id_relatorio)
        if item_id is None:
            continue
        origem = (campos.get("agenteRegulado") or "").strip()
        if origem:
            encontrados[item_id] = origem
        if len(encontrados) == len(alvos):
            break

    print(f"Itens lidos da listaDesignacao: {lidos} | casados: {len(encontrados)}")

    with Session() as s:
        for item_id, origem in encontrados.items():
            item = s.get(m.CaixaEntrada, item_id)
            if not item:
                continue
            classe = normalizar(origem)
            sub = subclasse(origem)
            print(
                f"  item {item_id}: {origem!r} -> classe {classe}"
                + (f", subclasse {sub}" if sub else "")
            )
            if not dry_run:
                item.agente_origem = origem
        if not dry_run:
            s.commit()

    faltando = set(alvos.values()) - set(encontrados)
    if faltando:
        print(f"\nSem correspondência na listaDesignacao: itens {sorted(faltando)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Adiciona e preenche caixa_entrada.agente_origem.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que faria, sem gravar.")
    args = parser.parse_args()

    engine = get_engine()
    adicionar_coluna(engine, args.dry_run)

    if args.dry_run and not coluna_existe(engine, "caixa_entrada", "agente_origem"):
        print("\n[DRY-RUN] A coluna não existe, então o preenchimento não pode ser simulado.")
        return

    preencher(get_sessionmaker(engine), args.dry_run)

    if args.dry_run:
        print("\n[DRY-RUN] Nada foi gravado.")


if __name__ == "__main__":
    main()
