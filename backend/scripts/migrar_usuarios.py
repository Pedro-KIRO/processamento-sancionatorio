"""Migra usuários da listaUsuarios do SharePoint para a tabela 'usuario' do banco.

A listaUsuarios contém os analistas/coordenadores que usam o sistema, com
campos como email, nome, unidade e perfil.

Uso:
    cd backend/
    python scripts/migrar_usuarios.py [--dry-run]

Pode ser rodado várias vezes (faz UPSERT por email).
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

LISTA_USUARIOS_NOME = "listaUsuarios"


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


def migrar(dry_run: bool = False):
    graph, site_id = _graph_client()
    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    logger.info("=== Migrando listaUsuarios → tabela usuario ===")

    lista_id = graph.obter_id_lista(site_id, LISTA_USUARIOS_NOME)
    if not lista_id:
        logger.error("Lista '%s' não encontrada!", LISTA_USUARIOS_NOME)
        return

    # Primeiro: listar todos os campos disponíveis no primeiro item (para debug)
    primeiro = True
    count = 0
    atualizados = 0

    with Session() as session:
        for campos in graph.iter_itens(site_id, lista_id):
            if primeiro:
                logger.info("  Campos disponíveis: %s", list(campos.keys()))
                primeiro = False

            # Tentar extrair campos relevantes (nomes podem variar)
            email = (
                campos.get("email") or campos.get("Email") or
                campos.get("emailUsuario") or campos.get("Title") or ""
            ).strip().lower()

            nome = (
                campos.get("nomeUsuario") or campos.get("nome") or
                campos.get("Nome") or campos.get("nomeCompleto") or ""
            ).strip()

            id_unidade = (
                campos.get("idUnidade") or campos.get("IdUnidade") or ""
            ).strip()

            perfil = (
                campos.get("perfil") or campos.get("Perfil") or
                campos.get("cargo") or campos.get("Cargo") or "analista"
            ).strip().lower()

            agente_regulado = (
                campos.get("agenteRegulado") or campos.get("AgenteRegulado") or ""
            ).strip()

            # Se agente é "Todos", é coordenador (vê tudo)
            if agente_regulado.lower() == "todos":
                perfil = "coordenador"

            if not email:
                # Sem email não tem como identificar o usuário
                continue

            logger.info("  [%s] %s | unidade=%s | perfil=%s | agente=%s",
                        "+" if not dry_run else "?", email, id_unidade, perfil, agente_regulado)

            if not dry_run:
                existente = session.query(m.Usuario).filter_by(email=email).first()
                if existente:
                    existente.nome = nome or existente.nome
                    existente.id_unidade = id_unidade or existente.id_unidade
                    existente.perfil = perfil or existente.perfil
                    atualizados += 1
                else:
                    session.add(m.Usuario(
                        email=email,
                        nome=nome,
                        id_unidade=id_unidade,
                        perfil=perfil,
                        ativo=True,
                    ))
                    session.flush()
            count += 1

        if not dry_run:
            session.commit()

    logger.info("=== Concluído: %d usuários processados (%d atualizados) ===", count, atualizados)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Só exibe, não grava no banco")
    args = parser.parse_args()
    migrar(dry_run=args.dry_run)
