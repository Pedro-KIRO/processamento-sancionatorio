"""Reduz o banco a um único relatório (e ao processo criado a partir dele).

Uso típico: preparar o ambiente para uma demonstração, deixando apenas um caso
completo e removendo o resto do histórico acumulado em testes.

O item preservado é identificado pelo número SEI do relatório de fiscalização
(``--numero``). Todos os dados vinculados a ele (anotações, fases, prazos,
eventos, notificações, histórico de despachos) são mantidos; os dos demais
itens são removidos.

Uso:
    cd backend/
    python -m scripts.limpar_banco_demo --numero "140.00366665/2026-35" --dry-run
    python -m scripts.limpar_banco_demo --numero "140.00366665/2026-35"
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from sqlalchemy import select

from app.db import models as m
from app.db.base import Base, get_engine, get_sessionmaker

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# Tabelas com FK para caixa_entrada — limpas por caixa_entrada_id.
TABELAS_VINCULADAS = [
    m.Anotacao,
    m.HistoricoDespacho,
    m.FaseProcessoAndamento,
    m.PrazoProcesso,
    m.EventoProcesso,
    m.Notificacao,
]


def _so_digitos(valor: str | None) -> str:
    return re.sub(r"\D", "", str(valor or ""))


def limpar(numero: str, dry_run: bool = False, limpar_cache: bool = True) -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    alvo_digitos = _so_digitos(numero)
    if not alvo_digitos:
        raise SystemExit("Informe um número SEI válido em --numero.")

    with Session() as s:
        todos = s.scalars(select(m.CaixaEntrada)).all()
        if not todos:
            logger.info("Banco já está vazio (nenhum item na caixa_entrada).")
            return

        # Localizar o item a preservar. Compara sem máscara e aceita qualquer
        # um dos números do caso: o do relatório de fiscalização, o protocolo
        # limpo, ou o do processo sancionatório criado na instauração — os três
        # vivem na mesma linha da caixa_entrada.
        preservar = None
        for item in todos:
            candidatos = {
                _so_digitos(item.numero_sei),
                _so_digitos(item.protocolo_limpo),
                _so_digitos(item.numero_processo_sei),
            }
            if alvo_digitos in candidatos:
                preservar = item
                break

        if preservar is None:
            logger.error("Nenhum item encontrado com o número %s.", numero)
            logger.info("Itens disponíveis no banco:")
            for item in todos:
                logger.info("  id=%s  %s  (status=%s)", item.id, item.numero_sei, item.status_triagem)
            raise SystemExit(1)

        logger.info("Preservando:")
        logger.info("  id=%s", preservar.id)
        logger.info("  Relatório de fiscalização: %s", preservar.numero_sei)
        logger.info("  Proc. sancionatório:       %s", preservar.numero_processo_sei or "(não instaurado)")
        logger.info("  Razão social:              %s", preservar.razao_social or "-")
        logger.info("  Status:                    %s", preservar.status_triagem)

        remover = [i for i in todos if i.id != preservar.id]
        logger.info("Itens a remover: %d", len(remover))

        if dry_run:
            for item in remover:
                logger.info("  [DRY-RUN] removeria id=%s %s", item.id, item.numero_sei)
            logger.info("[DRY-RUN] Nada foi alterado.")
            return

        ids_remover = [i.id for i in remover]

        # 1. Remover registros vinculados dos itens que vão sair. Feito antes
        #    dos próprios itens para não violar as FKs.
        for modelo in TABELAS_VINCULADAS:
            if not ids_remover:
                break
            vinculados = s.scalars(
                select(modelo).where(modelo.caixa_entrada_id.in_(ids_remover))
            ).all()
            for reg in vinculados:
                s.delete(reg)
            if vinculados:
                logger.info("  %s: %d registro(s) removido(s)", modelo.__tablename__, len(vinculados))

        # 2. Remover os itens
        for item in remover:
            s.delete(item)

        # 3. Cache do SEI: as entradas dos processos removidos ficariam órfãs
        if limpar_cache:
            from app.services import cache_sei
            total_cache = cache_sei.limpar_tudo(s)
            logger.info("  cache_sei: %d entrada(s) removida(s)", total_cache)

        s.commit()

        restantes = s.scalars(select(m.CaixaEntrada)).all()
        logger.info("=== Concluído. Itens restantes: %d ===", len(restantes))
        for item in restantes:
            logger.info("  id=%s  %s  (status=%s)", item.id, item.numero_sei, item.status_triagem)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Deixa no banco apenas um relatório (e o processo criado dele)."
    )
    parser.add_argument(
        "--numero", required=True,
        help='Número SEI do relatório a preservar, ex.: "140.00366665/2026-35"',
    )
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que faria, sem alterar nada.")
    parser.add_argument(
        "--manter-cache", action="store_true",
        help="Não limpa a tabela cache_sei (por padrão ela é limpa).",
    )
    args = parser.parse_args()
    limpar(args.numero, dry_run=args.dry_run, limpar_cache=not args.manter_cache)


if __name__ == "__main__":
    main()
