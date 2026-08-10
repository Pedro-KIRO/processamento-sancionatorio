"""
Atualiza a Data de Instauração dos processos instaurados (status_triagem='instaurado').

Portado do fluxo de referência `atualizar_assinatura` (`flows_referencia/`).

"Data de Instauração" = data em que o documento de instauração foi ASSINADO
(não a data de criação). O SEI registra isso como um andamento de tarefa=5
("documento assinado"). Ver docstring de `app/services/andamentos_sei.py`
para os detalhes da lógica.

Por que agendado (e não gatilho): a assinatura do documento acontece de forma
assíncrona no SEI (o responsável assina quando puder, depois de o documento
ser incluído no bloco de assinatura) — não há um webhook do SEI disponível
para avisar quando isso ocorre. A alternativa de gatilho síncrono (checar na
hora em que o usuário abre a tela de Processos em Andamento) é usada como
complemento no próprio endpoint da tela; este script cobre o caso em que o
usuário nunca abre a tela, mantendo o dado atualizado de qualquer forma.

Uso:
    cd backend/
    python -m automacoes.atualizar_data_instauracao [--dry-run] [--limit N]

Agendar no servidor (ex.: a cada 30 min, junto com varredura_sei.py).
"""
import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from app.db.base import Base, get_engine, get_sessionmaker  # noqa: E402
from app.db import models as m  # noqa: E402
from app.integrations.graph.client import GraphClient, GraphSettings  # noqa: E402
from app.integrations.sei.client import SeiClient, SeiSettings  # noqa: E402
from app.services.andamentos_sei import buscar_data_instauracao  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)

# Unidade usada para consultar o SEI (mesma unidade padrão usada nos despachos).
ID_UNIDADE_PADRAO = os.getenv("SEI_UNIDADE_PROCESSAMENTO_PADRAO", "110051045")


def atualizar(dry_run: bool = False, limite: int = 0):
    sei_cfg = SeiSettings(
        token_url=os.environ.get("SEI_TOKEN_URL", ""),
        client_id=os.environ.get("SEI_CLIENT_ID", ""),
        client_secret=os.environ.get("SEI_CLIENT_SECRET", ""),
        api_base=os.environ.get("SEI_API_BASE", ""),
        sigla_sistema=os.environ.get("SEI_SIGLA_SISTEMA", "CSDR_PROCESSAMENTO"),
        identificacao_servico=os.environ.get("SEI_IDENTIFICACAO_SERVICO", ""),
        trace_id=os.environ.get("SEI_TRACE_ID", "CSDR_PROCESSAMENTO_SEI"),
    )
    if not sei_cfg.token_url or not sei_cfg.client_id:
        logger.error("Variáveis SEI não configuradas no .env. Abortando.")
        return

    graph_cfg = GraphSettings(
        tenant_id=os.environ.get("GRAPH_TENANT_ID", ""),
        client_id=os.environ.get("GRAPH_CLIENT_ID", ""),
        client_secret=os.environ.get("GRAPH_CLIENT_SECRET", ""),
        hostname="governosp.sharepoint.com",
        site_path="/teams/DETRAN-CPSAR",
    )
    if not graph_cfg.tenant_id or not graph_cfg.client_id:
        logger.error("Variáveis Graph não configuradas no .env. Abortando.")
        return

    sei = SeiClient(sei_cfg, timeout=30)
    graph = GraphClient(graph_cfg, timeout=30)
    try:
        site_id = graph.get_site_id()
    except Exception:  # noqa: BLE001
        logger.exception("Não foi possível conectar ao SharePoint (DETRAN-CPSAR).")
        return

    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    with Session() as s:
        pendentes = (
            s.query(m.CaixaEntrada)
            .filter(m.CaixaEntrada.status_triagem == "instaurado")
            .filter(m.CaixaEntrada.id_procedimento_processo.is_not(None))
            .filter(m.CaixaEntrada.data_instauracao.is_(None))
            .all()
        )

    if limite:
        pendentes = pendentes[:limite]

    if not pendentes:
        logger.info("Nenhum processo instaurado pendente de data de instauração.")
        return

    logger.info("Verificando data de instauração de %d processo(s)...", len(pendentes))
    atualizados = 0

    for item in pendentes:
        try:
            data = buscar_data_instauracao(
                sei, graph, site_id, item.id_procedimento_processo, ID_UNIDADE_PADRAO,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Erro ao buscar data de instauração do item %s", item.id)
            continue

        if not data:
            logger.info("  Item %s (%s): ainda sem documento assinado.", item.id, item.numero_processo_sei)
            continue

        logger.info("  Item %s (%s): data de instauração = %s", item.id, item.numero_processo_sei, data)
        if not dry_run:
            with Session() as s:
                db_item = s.get(m.CaixaEntrada, item.id)
                db_item.data_instauracao = data
                s.commit()
        atualizados += 1

    logger.info("=== Concluído. Processos atualizados: %d ===", atualizados)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Atualiza a data de instauração dos processos.")
    parser.add_argument("--dry-run", action="store_true", help="Não grava no banco, só loga.")
    parser.add_argument("--limit", type=int, default=0, help="Limite de itens a processar (0 = sem limite).")
    args = parser.parse_args()
    atualizar(dry_run=args.dry_run, limite=args.limit)
