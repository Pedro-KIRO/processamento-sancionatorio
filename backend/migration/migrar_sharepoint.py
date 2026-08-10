"""CLI de migração: lê uma lista do SharePoint (via Graph) e grava no banco.

Uso (a partir da pasta backend/, com backend/.env preenchido):
    python migration/migrar_sharepoint.py --lista caixa --dry-run
    python migration/migrar_sharepoint.py --lista caixa --limite 50
"""
import argparse
import os
import sys

# Permite importar "app" ao rodar o script diretamente.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import graph_settings          # noqa: E402
from app.integrations.graph import GraphClient        # noqa: E402
from app.db.base import Base, get_engine, get_sessionmaker  # noqa: E402
from app.migration.mappers import MAPEAMENTOS         # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Migração SharePoint -> banco")
    ap.add_argument("--lista", required=True, choices=list(MAPEAMENTOS))
    ap.add_argument("--dry-run", action="store_true", help="apenas simula, nao grava")
    ap.add_argument("--limite", type=int, default=0, help="0 = todos os itens")
    args = ap.parse_args()

    display_name, _modelo, mapper = MAPEAMENTOS[args.lista]

    graph = GraphClient(graph_settings())
    site_id = graph.get_site_id()
    list_id = graph.obter_id_lista(site_id, display_name)

    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    total = 0
    with Session() as sessao:
        for fields in graph.iter_itens(site_id, list_id):
            obj = mapper(fields)
            if args.dry_run:
                print(f"[dry-run] {obj.numero_sei} | {obj.razao_social}")
            else:
                sessao.add(obj)
            total += 1
            if args.limite and total >= args.limite:
                break
        if not args.dry_run:
            sessao.commit()

    acao = "Simulados" if args.dry_run else "Inseridos"
    print(f"{acao}: {total} item(ns) da lista '{display_name}'.")


if __name__ == "__main__":
    main()
