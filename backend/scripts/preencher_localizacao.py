"""Preenche município e superintendência dos itens que ainda não têm.

A varredura já grava esses campos nos itens novos. Este script cobre os itens
que entraram antes da existência das colunas.

Fluxo por item: busca ``cidade`` na listaDesignacao (pelo número SEI do
relatório) e resolve município/superintendência via listaMunicipios.

Uso:
    cd backend/
    python -m scripts.preencher_localizacao --dry-run
    python -m scripts.preencher_localizacao
"""
from __future__ import annotations

import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from sqlalchemy import or_, select

from app.db import models as m
from app.db.base import Base, get_engine, get_sessionmaker

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

SITE_DCAN_PATH = "/teams/DETRAN-DCAN"
LISTA_DESIGNACAO_ID = "2855ddc6-c7e4-4b1a-a972-5bb939f378d3"


def _buscar_cidade(graph, site_id: str, numero_sei: str) -> str | None:
    """Busca a cidade do agente na listaDesignacao pelo número SEI formatado."""
    try:
        itens = graph.get_list_items_filtered(
            site_id, LISTA_DESIGNACAO_ID, f"fields/numeroSei eq '{numero_sei}'", top=1,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("  Erro ao consultar listaDesignacao para %s: %s", numero_sei, e)
        return None
    if not itens:
        return None
    return itens[0].get("fields", {}).get("cidade")


def preencher(dry_run: bool = False) -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    from app.core.sei_shared import get_graph_client
    from app.services.localizacao_agente import resolver

    try:
        graph, site_dcan = get_graph_client(SITE_DCAN_PATH)
    except Exception as e:  # noqa: BLE001
        logger.error("Graph não disponível (%s). Abortando.", e)
        return

    with Session() as s:
        pendentes = s.scalars(
            select(m.CaixaEntrada).where(
                or_(
                    m.CaixaEntrada.municipio.is_(None),
                    m.CaixaEntrada.municipio == "",
                )
            )
        ).all()
        alvos = [(i.id, i.numero_sei) for i in pendentes]

    logger.info("Itens sem município: %d", len(alvos))
    if not alvos:
        logger.info("Nada a preencher.")
        return

    preenchidos = 0
    sem_cidade = 0
    nao_encontrados = 0

    with Session() as s:
        for item_id, numero_sei in alvos:
            if not numero_sei:
                sem_cidade += 1
                continue

            cidade = _buscar_cidade(graph, site_dcan, numero_sei)
            if not cidade:
                logger.info("  %s: sem cidade na listaDesignacao.", numero_sei)
                sem_cidade += 1
                continue

            municipio, superintendencia = resolver(cidade)
            if not municipio:
                logger.info("  %s: cidade %r não encontrada em listaMunicipios.", numero_sei, cidade)
                nao_encontrados += 1
                continue

            logger.info("  %s: %s / %s", numero_sei, municipio, superintendencia)
            if not dry_run:
                item = s.get(m.CaixaEntrada, item_id)
                if item:
                    item.municipio = municipio
                    item.superintendencia = superintendencia
            preenchidos += 1

        if not dry_run:
            s.commit()

    logger.info(
        "=== Concluído. Preenchidos: %d | Sem cidade: %d | Não encontrados: %d ===",
        preenchidos, sem_cidade, nao_encontrados,
    )
    if dry_run:
        logger.info("[DRY-RUN] Nada foi gravado.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Preenche município/superintendência dos itens da caixa de entrada."
    )
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que faria, sem gravar.")
    args = parser.parse_args()
    preencher(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
