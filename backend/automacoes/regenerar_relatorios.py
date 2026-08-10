"""
Regenera os relatórios HTML de todos os itens da caixa de entrada, usando
Graph direto (sem Power Automate). Substitui os HTMLs antigos (gerados via
flow, com bug de imagens quebradas) pelos novos.

Uso:
    cd backend/
    python -m automacoes.regenerar_relatorios [--limit N]
"""
import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from app.db.base import Base, get_engine, get_sessionmaker  # noqa: E402
from app.db import models as m  # noqa: E402
from app.services.relatorio_fiscalizacao import RelatorioFiscalizacaoError, gerar_relatorio_html  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S")
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--force", action="store_true", help="Regenera mesmo os que já têm HTML")
    args = parser.parse_args()

    tenant = os.environ.get("GRAPH_TENANT_ID", "")
    client_id = os.environ.get("GRAPH_CLIENT_ID", "")
    client_secret = os.environ.get("GRAPH_CLIENT_SECRET", "")

    if not tenant or not client_id or not client_secret:
        logger.error("Credenciais Graph não configuradas no .env.")
        return

    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    with Session() as s:
        query = s.query(m.CaixaEntrada).filter(m.CaixaEntrada.id_relatorio.is_not(None)).filter(m.CaixaEntrada.id_relatorio != "")
        if not args.force:
            query = query.filter((m.CaixaEntrada.conteudo_html.is_(None)) | (m.CaixaEntrada.conteudo_html == ""))
        if args.limit:
            query = query.limit(args.limit)
        itens = query.all()

    logger.info("Itens a processar: %d", len(itens))
    ok, sem_dados, erros = 0, 0, 0

    for item in itens:
        logger.info("Processando ID %d (%s)...", item.id, item.numero_sei)
        try:
            html = gerar_relatorio_html(item, tenant, client_id, client_secret)
        except RelatorioFiscalizacaoError as e:
            logger.warning("  Erro: %s", e)
            erros += 1
            continue

        if not html:
            logger.info("  Sem respostas ainda. Pulando.")
            sem_dados += 1
            continue

        with Session() as s:
            db_item = s.get(m.CaixaEntrada, item.id)
            db_item.conteudo_html = html
            s.commit()

        logger.info("  OK (%d chars)", len(html))
        ok += 1
        time.sleep(0.5)

    logger.info("=== Concluído. OK: %d | Sem dados: %d | Erros: %d ===", ok, sem_dados, erros)


if __name__ == "__main__":
    main()
