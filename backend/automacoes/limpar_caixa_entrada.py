"""Limpa da caixa de entrada os itens que não atendem mais o filtro de remessa.

O critério é o mesmo da varredura: o último andamento do processo deve ser
"Processo remetido pela unidade [SFR]". Se o último andamento mudou (processo
já foi trabalhado, devolvido, etc.), o item sai da caixa de entrada.

Verifica APENAS os itens pendentes já gravados no banco (os que aparecem no
site). Não varre o SEI inteiro.

Uso:
    cd backend/
    python -m automacoes.limpar_caixa_entrada [--dry-run]
"""
import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from app.db.base import Base, get_engine, get_sessionmaker
from app.db import models as m
from app.integrations.sei.client import SeiClient, SeiSettings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

UNIDADES_ALVO = ["110051045", "110051042", "110053117", "110051044", "110051043", "110053119"]

PREFIXO_REMETIDO = "Processo remetido pela unidade "

UNIDADES_PERMITIDAS_SFR = {
    "DETRAN/SI-ARR/SFR", "DETRAN/SI-BTC/SFR", "DETRAN/SI-CPN/SFR", "DETRAN/SI-FND/SFR",
    "DETRAN/SI-ITP/SFR", "DETRAN/SI-JND/SFR", "DETRAN/SI-PPR/SFR", "DETRAN/SI-RPT/SFR",
    "DETRAN/SI-SAN/SFR", "DETRAN/SI-SJC/SFR", "DETRAN/SI-SJR/SFR", "DETRAN/SI-SPL/SFR",
    "DETRAN/SI-BRU/SFR", "DETRAN/SI-RGT/SFR", "DETRAN/SI-ARC/SFR", "DETRAN/SI-GRU/SFR",
    "DETRAN/SI-SBC/SFR", "DETRAN/SI-OSC/SFR", "DETRAN/SI-FRC/SFR", "DETRAN/SI-SRC/SFR",
    "DETRAN/DGR/CQCFAR/DCAR", "DETRAN/DGR/CQCFAR/DFAR", "DETRAN/DGR/CQCFAR/DFAR/SFA-VPD",
    "DETRAN/DGR/CQCFAR/DFAR/SFAC", "DETRAN/DGR/CQCFAR/DFAR/SFAET", "DETRAN/DGR/CQCFAR/DFAR/SFAMA",
    "DETRAN/DGR/CQCFAR/DFAR/SFAV",
}


def _sei_client() -> SeiClient:
    settings = SeiSettings(
        token_url=os.environ.get("SEI_TOKEN_URL", ""),
        client_id=os.environ.get("SEI_CLIENT_ID", os.environ.get("CLIENT_ID", "")),
        client_secret=os.environ.get("SEI_CLIENT_SECRET", os.environ.get("CLIENT_SECRET", "")),
        api_base=os.environ.get("SEI_API_BASE", ""),
        sigla_sistema=os.environ.get("SEI_SIGLA_SISTEMA", "CSDR_PROCESSAMENTO"),
        identificacao_servico=os.environ.get("SEI_IDENTIFICACAO_SERVICO", ""),
        trace_id=os.environ.get("SEI_TRACE_ID", ""),
    )
    return SeiClient(settings, timeout=30, max_tentativas=1)


def processo_ainda_atende_filtro(sei: SeiClient, protocolo_limpo: str, id_unidade_sei: str | None) -> bool:
    """Verifica se o último andamento do processo ainda é uma remessa por SFR.

    Consulta o processo com sinRetornarUltimoAndamento=true e verifica se
    a descrição do último andamento começa com "Processo remetido pela unidade "
    seguido de uma das unidades permitidas.

    Retorna True se ainda atende o filtro (manter), False se não (remover).
    """
    unidades_a_testar = list(UNIDADES_ALVO)
    if id_unidade_sei and id_unidade_sei in unidades_a_testar:
        unidades_a_testar.remove(id_unidade_sei)
        unidades_a_testar.insert(0, id_unidade_sei)

    for unid in unidades_a_testar:
        try:
            det = sei.consultar_processo(protocolo_limpo, unid, ultimo_andamento=True)
            # Conseguiu consultar — verificar o último andamento
            status_desc = det.get("ultimoAndamento", {}).get("descricao", "")
            if status_desc.startswith(PREFIXO_REMETIDO):
                unidade_remetente = status_desc[len(PREFIXO_REMETIDO):]
                if unidade_remetente in UNIDADES_PERMITIDAS_SFR:
                    return True
            # O processo existe mas o último andamento não é mais "remetido por SFR"
            return False
        except Exception:
            continue

    # Não conseguiu consultar em nenhuma unidade — processo pode ter sido
    # excluído ou movido. Remove da caixa de entrada.
    return False


def limpar(dry_run: bool = False, max_itens: int = 0, sei: SeiClient | None = None):
    """Remove itens que não atendem mais o filtro da caixa de entrada.

    ``max_itens``: quando > 0, verifica no máximo essa quantidade por execução,
    priorizando os itens verificados há mais tempo (ou nunca verificados). Isso
    mantém cada ciclo com duração previsível quando a caixa tem muitos itens —
    a rotação garante que todos acabam sendo checados ao longo dos ciclos.

    ``sei``: permite reaproveitar um cliente já autenticado (usado quando a
    varredura chama a limpeza no fim do seu ciclo).
    """
    from datetime import datetime, timezone

    sei = sei or _sei_client()
    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    with Session() as s:
        consulta = (
            s.query(m.CaixaEntrada)
            .filter(m.CaixaEntrada.protocolo_limpo.is_not(None))
            .filter(
                (m.CaixaEntrada.status_triagem.is_(None))
                | (m.CaixaEntrada.status_triagem == "pendente")
            )
            # Nunca verificados primeiro, depois os mais antigos
            .order_by(m.CaixaEntrada.verificado_em.is_(None).desc(),
                      m.CaixaEntrada.verificado_em.asc())
        )
        if max_itens and max_itens > 0:
            consulta = consulta.limit(max_itens)
        pendentes = consulta.all()
        # Materializar os dados necessários antes de fechar a sessão
        alvos = [(p.id, p.numero_sei, p.razao_social, p.protocolo_limpo, p.id_unidade_sei)
                 for p in pendentes]

    logger.info("Itens a verificar neste ciclo: %d", len(alvos))

    if not alvos:
        logger.info("Nada a verificar.")
        return

    removidos = 0
    mantidos = 0

    with Session() as s:
        for item_id, numero_sei, razao_social, protocolo_limpo, id_unidade_sei in alvos:
            logger.info("  Verificando %s (%s)...", numero_sei, razao_social or "?")
            atende = processo_ainda_atende_filtro(sei, protocolo_limpo, id_unidade_sei)

            db_item = s.get(m.CaixaEntrada, item_id)

            if atende:
                mantidos += 1
                logger.info("    [OK] Mantido.")
                if db_item and not dry_run:
                    db_item.verificado_em = datetime.now(timezone.utc).replace(tzinfo=None)
            else:
                if dry_run:
                    logger.info("    [DRY-RUN] Removeria — último andamento não é remessa por SFR.")
                else:
                    if db_item:
                        s.delete(db_item)
                        logger.info("    [-] Removido.")
                removidos += 1

            time.sleep(0.3)

        if not dry_run:
            s.commit()

    logger.info("=== Concluído. Mantidos: %d | Removidos: %d ===", mantidos, removidos)


def main():
    parser = argparse.ArgumentParser(description="Limpa itens da caixa de entrada que não atendem mais o filtro de remessa SFR")
    parser.add_argument("--dry-run", action="store_true", help="Não exclui, só mostra o que faria.")
    parser.add_argument("--max-itens", type=int, default=0,
                        help="Verifica no máximo N itens (rotação pelos menos recentemente verificados). 0 = todos.")
    args = parser.parse_args()
    limpar(dry_run=args.dry_run, max_itens=args.max_itens)


if __name__ == "__main__":
    main()
