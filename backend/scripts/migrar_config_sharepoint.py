"""Migra dados de referência das listas do SharePoint para o banco próprio.

Lê via Microsoft Graph as seguintes listas do site CPSAR:
- listaUsuarios → config_unidade (agenteRegulado → idUnidade)
- listaCódigosAPI → config_tipo_procedimento (agenteRegulado → idTipoProcedimento)
- listaBlocosAssinatura → config_bloco_assinatura (agenteRegulado, cargo → idBloco)
- listaSEIDespachos → config_template_despacho (agenteRegulado, descricaoDOC → template)

Uso:
    cd backend/
    python scripts/migrar_config_sharepoint.py [--dry-run]

Pode ser rodado várias vezes (faz UPSERT: se já existe com a mesma chave, atualiza).
"""
import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from app.db.base import Base, get_engine, get_sessionmaker
from app.db import models as m
from app.integrations.graph.client import GraphClient, GraphSettings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# IDs das listas no site CPSAR (mesmos usados em despachos_sei.py e config.py)
LISTA_USUARIOS_NOME = "listaUsuarios"
LISTA_CODIGOS_API_ID = "67bfcb94-ec83-42e6-872a-cf94ff69eca1"
LISTA_BLOCOS_ASSINATURA_ID = "f55f9a83-5cca-48db-bebb-20d542dc23e1"
LISTA_SEI_DESPACHOS_ID = "2bc584ff-9266-471c-a7d3-f646aa261379"


def _graph_client() -> tuple[GraphClient, str]:
    settings = GraphSettings(
        tenant_id=os.environ["GRAPH_TENANT_ID"],
        client_id=os.environ["GRAPH_CLIENT_ID"],
        client_secret=os.environ["GRAPH_CLIENT_SECRET"],
        hostname="governosp.sharepoint.com",
        site_path="/teams/DETRAN-CPSAR",
    )
    graph = GraphClient(settings)
    site_id = graph.get_site_id()
    return graph, site_id


def migrar_unidades(graph: GraphClient, site_id: str, session, dry_run: bool):
    """listaUsuarios → config_unidade."""
    logger.info("=== Migrando listaUsuarios → config_unidade ===")
    lista_id = graph.obter_id_lista(site_id, LISTA_USUARIOS_NOME)
    if not lista_id:
        logger.warning("Lista '%s' não encontrada. Pulando.", LISTA_USUARIOS_NOME)
        return

    count = 0
    for item in graph.iter_itens(site_id, lista_id):
        campos = item.get("fields", item)
        agente = campos.get("agenteRegulado", "").strip()
        id_unidade = campos.get("idUnidade", "").strip()
        if not agente or not id_unidade:
            continue

        descricao = campos.get("descricaoUnidade", "") or campos.get("Title", "")

        if not dry_run:
            existente = session.query(m.ConfigUnidade).filter_by(
                agente_regulado=agente, id_unidade=id_unidade
            ).first()
            if existente:
                existente.descricao_unidade = descricao
            else:
                session.add(m.ConfigUnidade(
                    agente_regulado=agente,
                    id_unidade=id_unidade,
                    descricao_unidade=descricao,
                ))
        count += 1
        logger.info("  [+] %s → %s", agente, id_unidade)

    if not dry_run:
        session.commit()
    logger.info("  Total: %d registros.", count)


def migrar_codigos_api(graph: GraphClient, site_id: str, session, dry_run: bool):
    """listaCódigosAPI → config_tipo_procedimento."""
    logger.info("=== Migrando listaCódigosAPI → config_tipo_procedimento ===")

    count = 0
    for item in graph.iter_itens(site_id, LISTA_CODIGOS_API_ID):
        campos = item.get("fields", item)
        agente = campos.get("agenteRegulado", "").strip()
        id_tipo = campos.get("idTipoProcedimento", "").strip()
        if not agente or not id_tipo:
            continue

        if not dry_run:
            existente = session.query(m.ConfigTipoProcedimento).filter_by(agente_regulado=agente).first()
            if existente:
                existente.id_tipo_procedimento = id_tipo
            else:
                session.add(m.ConfigTipoProcedimento(
                    agente_regulado=agente,
                    id_tipo_procedimento=id_tipo,
                ))
        count += 1
        logger.info("  [+] %s → %s", agente, id_tipo)

    if not dry_run:
        session.commit()
    logger.info("  Total: %d registros.", count)


def migrar_blocos_assinatura(graph: GraphClient, site_id: str, session, dry_run: bool):
    """listaBlocosAssinatura → config_bloco_assinatura."""
    logger.info("=== Migrando listaBlocosAssinatura → config_bloco_assinatura ===")

    count = 0
    for item in graph.iter_itens(site_id, LISTA_BLOCOS_ASSINATURA_ID):
        campos = item.get("fields", item)
        agente = campos.get("agenteRegulado", "").strip()
        cargo = campos.get("cargo", "").strip()
        id_bloco = campos.get("idBloco", "").strip()
        if not agente or not id_bloco:
            continue

        if not dry_run:
            existente = session.query(m.ConfigBlocoAssinatura).filter_by(
                agente_regulado=agente, cargo=cargo
            ).first()
            if existente:
                existente.id_bloco = id_bloco
            else:
                session.add(m.ConfigBlocoAssinatura(
                    agente_regulado=agente,
                    cargo=cargo,
                    id_bloco=id_bloco,
                ))
        count += 1
        logger.info("  [+] %s / %s → %s", agente, cargo, id_bloco)

    if not dry_run:
        session.commit()
    logger.info("  Total: %d registros.", count)


def migrar_templates_despacho(graph: GraphClient, site_id: str, session, dry_run: bool):
    """listaSEIDespachos → config_template_despacho."""
    logger.info("=== Migrando listaSEIDespachos → config_template_despacho ===")

    count = 0
    for item in graph.iter_itens(site_id, LISTA_SEI_DESPACHOS_ID):
        campos = item.get("fields", item)
        agente = campos.get("agenteRegulado", "").strip()
        descricao = campos.get("descricaoDOC", "").strip()
        template = campos.get("templateHTML", "") or campos.get("template", "")
        nome_arvore = campos.get("nomeArvore", "")
        if not agente or not descricao:
            continue

        if not dry_run:
            existente = session.query(m.ConfigTemplateDespacho).filter_by(
                agente_regulado=agente, descricao_doc=descricao
            ).first()
            if existente:
                existente.template_html = template
                existente.nome_arvore = nome_arvore
            else:
                session.add(m.ConfigTemplateDespacho(
                    agente_regulado=agente,
                    descricao_doc=descricao,
                    template_html=template,
                    nome_arvore=nome_arvore,
                ))
        count += 1
        logger.info("  [+] %s / %s (%d chars)", agente, descricao[:40], len(template))

    if not dry_run:
        session.commit()
    logger.info("  Total: %d registros.", count)


def main():
    parser = argparse.ArgumentParser(description="Migra configs do SharePoint → banco próprio")
    parser.add_argument("--dry-run", action="store_true", help="Não grava, só mostra o que faria.")
    args = parser.parse_args()

    graph, site_id = _graph_client()
    logger.info("Conectado ao Graph. Site CPSAR: %s", site_id)

    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    with Session() as session:
        migrar_unidades(graph, site_id, session, args.dry_run)
        migrar_codigos_api(graph, site_id, session, args.dry_run)
        migrar_blocos_assinatura(graph, site_id, session, args.dry_run)
        migrar_templates_despacho(graph, site_id, session, args.dry_run)

    logger.info("=== Migração concluída! ===")


if __name__ == "__main__":
    main()
