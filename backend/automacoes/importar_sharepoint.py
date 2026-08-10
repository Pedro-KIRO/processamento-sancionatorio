"""
Importa os itens já existentes na listaCaixaDeEntrada (SharePoint CPSAR)
para o banco próprio do sistema.

Isso evita re-varrer todos os processos — traz diretamente o que a automação
já havia filtrado e gravado no SharePoint.

Uso:
    cd backend/
    python -m automacoes.importar_sharepoint [--dry-run] [--limit N]
"""
import argparse
import logging
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from app.db.base import Base, get_engine, get_sessionmaker  # noqa: E402
from app.db import models as m  # noqa: E402
from app.integrations.graph.client import GraphClient, GraphSettings  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# SharePoint
SITE_CPSAR_PATH = "/teams/DETRAN-CPSAR"
LISTA_CAIXA_ENTRADA_ID = "62d23c4f-0ccb-44c9-bc0a-be052bea3668"


def limpar_numero(numero: str) -> str:
    return re.sub(r"\D", "", str(numero or ""))


def parse_data(valor):
    """Converte data ISO do SharePoint (2026-01-10T00:00:00Z) para date."""
    if not valor:
        return None
    from datetime import date
    try:
        return date.fromisoformat(str(valor)[:10])
    except Exception:
        return None


def importar(dry_run: bool = False, limite: int = 0):
    # Graph
    tenant = os.getenv("GRAPH_TENANT_ID", "")
    client_id = os.getenv("GRAPH_CLIENT_ID", "")
    client_secret = os.getenv("GRAPH_CLIENT_SECRET", "")

    if not tenant or not client_id or not client_secret:
        logger.error("Credenciais Graph não configuradas. Abortando.")
        return

    settings = GraphSettings(
        tenant_id=tenant,
        client_id=client_id,
        client_secret=client_secret,
        hostname="governosp.sharepoint.com",
        site_path=SITE_CPSAR_PATH,
    )
    graph = GraphClient(settings)
    site_id = graph.get_site_id()
    logger.info("Site CPSAR: %s", site_id)

    # Banco
    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    # Carregar protocolos já no banco
    with Session() as s:
        existentes = set(
            p[0] for p in s.query(m.CaixaEntrada.protocolo_limpo)
            .filter(m.CaixaEntrada.protocolo_limpo.is_not(None)).all()
        )
    logger.info("Já no banco: %d itens", len(existentes))

    # Ler todos os itens da listaCaixaDeEntrada via Graph
    logger.info("Lendo listaCaixaDeEntrada do SharePoint...")
    total = 0
    novos = 0

    for campos in graph.iter_itens(site_id, LISTA_CAIXA_ENTRADA_ID, page_size=200):
        total += 1
        if limite and novos >= limite:
            break

        numero_sei = campos.get("numeroSEI", "")
        p_limpo = limpar_numero(numero_sei)

        if not p_limpo or p_limpo in existentes:
            continue

        id_relatorio = campos.get("ID_Relatorio")
        razao_social = campos.get("razaoSocial", "")
        agente_regulado = campos.get("agenteRegulado", "")
        cnpj_cpf = campos.get("CNPJ_x002f_CPF", "")
        data_recebimento = parse_data(campos.get("dataRecebimento"))
        data_remetido = parse_data(campos.get("dataRemetido"))
        copia_id = campos.get("copiaID")

        # Determinar segmento
        segmento = ""
        if agente_regulado in ("Autoescola",):
            segmento = "Educacao"
        elif agente_regulado in ("ECV", "EPIV", "Desmontes"):
            segmento = "Veiculos"
        elif agente_regulado in ("Peritos", "Despachantes"):
            segmento = "Condutores"

        tipo_doc = campos.get("tipoDocumento", "")

        logger.info("[+] %s | %s | %s", numero_sei, agente_regulado, razao_social[:40])

        if not dry_run:
            with Session() as s:
                novo = m.CaixaEntrada(
                    protocolo_limpo=p_limpo,
                    numero_sei=numero_sei,
                    id_relatorio=str(id_relatorio) if id_relatorio else None,
                    razao_social=razao_social,
                    agente_regulado=agente_regulado,
                    segmento=segmento,
                    tipo_documento=tipo_doc,
                    cnpj_cpf=cnpj_cpf,
                    data_recebimento=data_recebimento,
                    data_remetido=data_remetido,
                    status_triagem="pendente",
                )
                s.add(novo)
                s.commit()

        existentes.add(p_limpo)
        novos += 1

    logger.info("=== Importação concluída. Lidos: %d | Novos importados: %d ===", total, novos)


def main():
    parser = argparse.ArgumentParser(description="Importa listaCaixaDeEntrada do SharePoint para o banco.")
    parser.add_argument("--dry-run", action="store_true", help="Não grava, só mostra.")
    parser.add_argument("--limit", type=int, default=0, help="Máximo de itens novos (0=todos).")
    args = parser.parse_args()

    importar(dry_run=args.dry_run, limite=args.limit)


if __name__ == "__main__":
    main()
