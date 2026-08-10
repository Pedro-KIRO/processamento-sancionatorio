"""
Gera HTMLs de relatórios de fiscalização e grava no banco próprio.

Usa os flows do Power Automate como ponte para buscar detalhes (perguntas,
respostas, fiscais, fotos) da listaDesignação.

Uso:
    cd backend/
    python -m automacoes.gerar_relatorios [--dry-run] [--limit N]

Fluxo:
1. Busca itens da caixa_entrada que têm id_relatorio mas sem conteudo_html
2. Para cada um, chama o flow de detalhes (perguntas/respostas/fotos)
3. Gera o HTML do relatório
4. Grava no campo conteudo_html do banco
"""
import argparse
import logging
import os
import sys
import time
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

import requests
from app.db.base import Base, get_engine, get_sessionmaker  # noqa: E402
from app.db import models as m  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# URL do flow de detalhes (Power Automate)
FLOW_DETALHES_URL = os.getenv("FLOW_DETALHES_URL", "")

# Logo base64 do DETRAN (mesma do gerar_relatorios.py original)
LOGO_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAHgAAABGCAYAAAAHFFAPAAAAAXNSR0IB2cksfwAAAAlwSFlzAAAewgAAHsIBbtB1PgAACdpJREFUeJztXQuQFMUZ"

MESES_PT = {
    "January": "Janeiro", "February": "Fevereiro", "March": "Março",
    "April": "Abril", "May": "Maio", "June": "Junho",
    "July": "Julho", "August": "Agosto", "September": "Setembro",
    "October": "Outubro", "November": "Novembro", "December": "Dezembro",
}


def buscar_detalhes(id_relatorio: str) -> dict | None:
    """Busca detalhes do relatório via flow do Power Automate."""
    if not FLOW_DETALHES_URL:
        return None
    try:
        resp = requests.post(
            FLOW_DETALHES_URL,
            json={"idRelatorio": id_relatorio},
            timeout=120,
        )
        if resp.status_code == 200:
            return resp.json()
        logger.warning("Flow retornou %d para ID %s", resp.status_code, id_relatorio)
        return None
    except Exception as e:
        logger.warning("Erro ao buscar detalhes de %s: %s", id_relatorio, e)
        return None


def gerar_html_relatorio(dados_item: m.CaixaEntrada, detalhes: dict) -> str:
    """Gera o HTML do relatório de fiscalização a partir dos detalhes."""
    respostas = detalhes.get("respostas", [])
    fiscais = detalhes.get("fiscais", [])
    fotos = detalhes.get("fotos", [])

    # Constatações
    var_constatacoes = ""
    var_conclusao = ""
    for r in respostas:
        texto = r.get("Texto", "")
        resposta = r.get("Resposta", "")
        if texto == "Conclusão":
            var_conclusao = resposta
        elif texto:
            var_constatacoes += (
                f"<tr><td style='padding:6px; border-bottom:1px dashed #000;'>{texto}</td>"
                f"<td style='text-align:right;'>{resposta}</td></tr>"
            )

    # Fiscais
    linhas_fiscais = ""
    for f in fiscais:
        linhas_fiscais += (
            f"<tr><td style='border:1px solid #000; padding:6pt; font-size:10pt;'>"
            f"{f.get('nomeFiscal1', '')}</td>"
            f"<td style='border:1px solid #000; padding:6pt; font-size:10pt;'>"
            f"{f.get('matriculaFiscal1', '')}</td></tr>"
        )

    # Fotos
    var_fotos = ""
    for foto in fotos:
        legenda = foto.get("legendaFoto", "")
        b64 = foto.get("foto64", "")
        # Remover aspas extras, prefixos data:image e espaços
        b64 = b64.strip().strip('"').strip("'")
        for prefix in ("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/jpg;base64,"):
            b64 = b64.replace(prefix, "")
        b64 = b64.strip()
        if not b64:
            continue
        var_fotos += (
            f"<tr><td style='border:1px solid #000; padding:10px; text-align:center;'>"
            f"<p style='font-size:15px; margin-bottom:10px;'><b>{legenda}</b></p>"
            f"<img src='data:image/jpeg;base64,{b64}' width='550' style='display:block; margin:0 auto;'/>"
            f"</td></tr>"
        )

    agente = (dados_item.agente_regulado or "").upper()
    razao = dados_item.razao_social or ""
    cnpj = dados_item.cnpj_cpf or ""

    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:'Open Sans',Arial,sans-serif; color:#000; line-height:1.4; margin:0; padding:20px;">
<div style="max-width:1158px; margin:auto;">
    <p style="text-align:center; text-transform:uppercase; font-size:10pt; margin:0;">Governo do Estado de São Paulo</p>
    <p style="text-align:center; text-transform:uppercase; font-size:10pt; margin:0;">DEPARTAMENTO ESTADUAL DE TRÂNSITO DE SÃO PAULO</p>
    <p style="text-align:center; text-transform:uppercase; font-size:10pt; margin:0;">Superintendência Regional de Trânsito - Setor de Fiscalização de Regulados</p>
    <p style="text-align:center; text-transform:uppercase; font-size:13pt; font-weight:bold; margin:15pt 0;">RELATÓRIO DE FISCALIZAÇÃO DE AGENTE DELEGADO OU REGULADO</p>

    <table style="width:100%; border-collapse:collapse; border:1px solid #000;">
        <tr><th colspan="2" style="border:1px solid #000; padding:6pt; font-weight:bold; text-align:center;">DADOS DA FISCALIZAÇÃO - {agente}</th></tr>
        {linhas_fiscais}
    </table>

    <table style="width:100%; border-collapse:collapse; border:1px solid #000; margin-top:-1px;">
        <tr><th colspan="2" style="border:1px solid #000; padding:6pt; font-weight:bold; text-align:center;">IDENTIFICAÇÃO DO AGENTE FISCALIZADO</th></tr>
        <tr><td colspan="2" style="border:1px solid #000; padding:6pt; font-size:10pt;">NOME DA ENTIDADE: <strong>{razao}</strong></td></tr>
        <tr><td style="border:1px solid #000; padding:6pt; font-size:10pt;">CPF/CNPJ: <strong>{cnpj}</strong></td><td style="border:1px solid #000; padding:6pt;"></td></tr>
    </table>

    <div style="margin-top:9px;">
        <table style="width:100%; border-collapse:collapse;">
            <tr><td style="background-color:#EEE; height:15pt; border:1px solid #000;"></td></tr>
            <tr><td style="text-align:center; border:1px solid #000; padding:6pt;"><b>CONSTATAÇÕES</b></td></tr>
            <tr><td style="border:1px solid #000; padding:10px;">
                <table style="width:100%; border-collapse:collapse;">{var_constatacoes}</table>
                <br><b>Conclusão:</b><br><div style="margin:15px 0;">{var_conclusao}</div>
            </td></tr>
        </table>
    </div>

    <table style="width:100%; border-collapse:collapse; border:1px solid #000; margin-top:20px;">
        <tr><th style="padding:10px; background-color:#f0f0f0; text-align:left; border:1px solid #000;">Fotos anexadas:</th></tr>
        <tr><td style="padding:10px; border:1px solid #000;">{var_fotos}</td></tr>
    </table>
</div>
</body></html>"""
    return html


def main():
    parser = argparse.ArgumentParser(description="Gera relatórios HTML e grava no banco.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    if not FLOW_DETALHES_URL:
        logger.error("FLOW_DETALHES_URL não configurada no .env. Abortando.")
        logger.info("Configure a URL do flow de detalhes do Power Automate.")
        return

    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    # Buscar itens que têm id_relatorio mas sem HTML gerado
    with Session() as s:
        query = (
            s.query(m.CaixaEntrada)
            .filter(m.CaixaEntrada.id_relatorio.is_not(None))
            .filter(m.CaixaEntrada.id_relatorio != "")
            .filter(
                (m.CaixaEntrada.conteudo_html.is_(None)) | (m.CaixaEntrada.conteudo_html == "")
            )
        )
        if args.limit:
            query = query.limit(args.limit)
        itens = query.all()

    logger.info("Itens sem relatório HTML: %d", len(itens))

    gerados = 0
    for item in itens:
        logger.info("Processando ID %d (relatorio=%s)...", item.id, item.id_relatorio)

        detalhes = buscar_detalhes(item.id_relatorio)
        if not detalhes or not detalhes.get("respostas"):
            logger.warning("  Sem detalhes/respostas. Pulando.")
            continue

        html = gerar_html_relatorio(item, detalhes)

        if not args.dry_run:
            with Session() as s:
                db_item = s.get(m.CaixaEntrada, item.id)
                db_item.conteudo_html = html
                s.commit()

        logger.info("  HTML gerado (%d chars).", len(html))
        gerados += 1
        time.sleep(1)  # Evitar throttling do flow

    logger.info("=== Concluído. Relatórios gerados: %d ===", gerados)


if __name__ == "__main__":
    main()
