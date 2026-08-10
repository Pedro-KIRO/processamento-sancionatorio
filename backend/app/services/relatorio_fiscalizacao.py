"""
Geração de relatórios de fiscalização via Microsoft Graph — sem Power Automate.

Fluxo (100% Graph direto):
1. lista_resposta (site CQCFAR) — respostas do checklist, filtradas por IDRelatorio
2. lista_perguntas (site CQCFAR) — banco de perguntas (cache em memória, 1h)
3. listaAnexosFiscalizacao (site CQCFAR) — fotos da fiscalização, filtradas por ID_Relatorio
4. listaFiscais (site DCAN) — fiscais designados, filtrados por ID_Relatorio

Todos os itens são relacionados pelo mesmo `id_relatorio` (GUID + timestamp),
gerado originalmente pelo app de Gestão da Fiscalização.

Geração é feita sob demanda (individual, por processo) — não em lote — para
manter a varredura da caixa de entrada rápida. O resultado é cacheado no
banco (campo `conteudo_html`) após a primeira geração.
"""
from __future__ import annotations

import time
from typing import Any

from app.db import models as m
from app.integrations.graph.client import GraphClient, GraphSettings

SITE_CQCFAR = "/teams/DETRAN-CQCFAR"
SITE_DCAN = "/teams/DETRAN-DCAN"
HOSTNAME = "governosp.sharepoint.com"

LISTA_PERGUNTAS_ID = "eed11ddf-98a4-4e05-8790-cadbe65324bc"
LISTA_RESPOSTA_ID = "d11035b0-9223-4371-95d1-25f1ea105e05"
LISTA_ANEXOS_FISCALIZACAO_ID = "da3b4ae3-c62f-480f-a31e-ea63d9570195"
LISTA_FISCAIS_ID = "3267a887-9530-41fa-8aee-7b8c761ffc3e"

# Cache em memória do banco de perguntas (é praticamente estático)
_perguntas_cache: dict[str, tuple[str, float]] | None = None
_perguntas_cache_em: float = 0.0
_PERGUNTAS_CACHE_TTL = 3600.0  # 1 hora


class RelatorioFiscalizacaoError(Exception):
    """Erro ao gerar relatório de fiscalização."""


def _limpar_base64(valor: str | None) -> str:
    """Remove aspas externas e prefixo data:image de um valor base64 vindo do SharePoint."""
    if not valor:
        return ""
    v = str(valor).strip()
    if len(v) >= 2 and v[0] in ('"', "'") and v[-1] in ('"', "'"):
        v = v[1:-1]
    for prefix in ("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/jpg;base64,"):
        if v.startswith(prefix):
            v = v[len(prefix):]
            break
    return v.strip()


def _id_numerico(valor: Any) -> str | None:
    """Normaliza um ID que pode vir como int, float ou string ('95.0' -> '95')."""
    if valor is None or valor == "":
        return None
    try:
        return str(int(float(valor)))
    except (TypeError, ValueError):
        return str(valor).strip()


def _obter_perguntas(graph: GraphClient, site_id: str) -> dict[str, tuple[str, float]]:
    """Retorna {id_pergunta: (TextoPergunta, Ordem)}, com cache de 1h em memória."""
    global _perguntas_cache, _perguntas_cache_em

    agora = time.time()
    if _perguntas_cache is not None and (agora - _perguntas_cache_em) < _PERGUNTAS_CACHE_TTL:
        return _perguntas_cache

    perguntas: dict[str, tuple[str, float]] = {}
    for campos in graph.iter_itens(site_id, LISTA_PERGUNTAS_ID, page_size=200):
        pid = _id_numerico(campos.get("id"))
        if not pid:
            continue
        texto = campos.get("TextoPergunta", "") or ""
        try:
            ordem = float(campos.get("Ordem", 999))
        except (TypeError, ValueError):
            ordem = 999.0
        perguntas[pid] = (texto, ordem)

    _perguntas_cache = perguntas
    _perguntas_cache_em = agora
    return perguntas


def _montar_html(
    item: m.CaixaEntrada,
    respostas: list[dict],
    perguntas: dict[str, tuple[str, float]],
    fotos: list[dict],
    fiscais: list[dict],
) -> str:
    """Monta o HTML final do relatório de fiscalização."""
    # Constatações + conclusão (ordenadas pela Ordem da pergunta)
    linhas: list[tuple[float, str]] = []
    conclusao = ""
    for r in respostas:
        campos = r.get("fields", r)
        id_pergunta = _id_numerico(campos.get("IDPergunta"))
        texto, ordem = perguntas.get(id_pergunta or "", ("", 999.0))
        resposta = campos.get("Resposta", "") or ""
        if texto == "Conclusão":
            conclusao = resposta
        elif texto:
            linha = (
                f"<tr><td style='padding:6px; border-bottom:1px dashed #000;'>{texto}</td>"
                f"<td style='text-align:right;'>{resposta}</td></tr>"
            )
            linhas.append((ordem, linha))
    linhas.sort(key=lambda x: x[0])
    constatacoes = "".join(l for _, l in linhas)

    # Fiscais
    linhas_fiscais = ""
    for f in fiscais:
        campos = f.get("fields", f)
        linhas_fiscais += (
            f"<tr><td style='border:1px solid #000; padding:6pt; font-size:10pt;'>"
            f"{campos.get('nomeFiscal1', '')}</td>"
            f"<td style='border:1px solid #000; padding:6pt; font-size:10pt;'>"
            f"{campos.get('matriculaFiscal1', '')}</td></tr>"
        )

    # Fotos
    html_fotos = ""
    for foto in fotos:
        campos = foto.get("fields", foto)
        legenda = campos.get("legendaFoto", "") or ""
        b64 = _limpar_base64(campos.get("foto64", ""))
        if not b64:
            continue
        html_fotos += (
            f"<tr><td style='border:1px solid #000; padding:10px; text-align:center;'>"
            f"<p style='font-size:15px; margin-bottom:10px;'><b>{legenda}</b></p>"
            f"<img src='data:image/jpeg;base64,{b64}' width='550' "
            f"style='display:block; margin:0 auto;'/></td></tr>"
        )

    agente = (item.agente_regulado or "").upper()
    razao = item.razao_social or ""
    cnpj = item.cnpj_cpf or ""

    return f"""<!DOCTYPE html>
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
                <table style="width:100%; border-collapse:collapse;">{constatacoes}</table>
                <br><b>Conclusão:</b><br><div style="margin:15px 0;">{conclusao}</div>
            </td></tr>
        </table>
    </div>

    <table style="width:100%; border-collapse:collapse; border:1px solid #000; margin-top:20px;">
        <tr><th style="padding:10px; background-color:#f0f0f0; text-align:left; border:1px solid #000;">Fotos anexadas:</th></tr>
        <tr><td style="padding:10px; border:1px solid #000;"><table style="width:100%;">{html_fotos}</table></td></tr>
    </table>
</div>
</body></html>"""


def gerar_relatorio_html(
    item: m.CaixaEntrada,
    graph_tenant_id: str,
    graph_client_id: str,
    graph_client_secret: str,
) -> str | None:
    """
    Gera o HTML do relatório de fiscalização buscando dados direto do SharePoint via Graph.

    Retorna None se o item não tiver id_relatorio ou se não houver respostas
    registradas ainda (fiscalização em andamento).

    Levanta RelatorioFiscalizacaoError em caso de falha de conexão/autenticação.
    """
    if not item.id_relatorio:
        return None

    try:
        settings_cqcfar = GraphSettings(
            tenant_id=graph_tenant_id, client_id=graph_client_id, client_secret=graph_client_secret,
            hostname=HOSTNAME, site_path=SITE_CQCFAR,
        )
        graph_cqcfar = GraphClient(settings_cqcfar, timeout=30)
        site_cqcfar_id = graph_cqcfar.get_site_id()

        settings_dcan = GraphSettings(
            tenant_id=graph_tenant_id, client_id=graph_client_id, client_secret=graph_client_secret,
            hostname=HOSTNAME, site_path=SITE_DCAN,
        )
        graph_dcan = GraphClient(settings_dcan, timeout=30)
        site_dcan_id = graph_dcan.get_site_id()
    except Exception as e:
        raise RelatorioFiscalizacaoError(f"Erro ao conectar ao SharePoint: {e}") from e

    try:
        respostas = graph_cqcfar.get_list_items_filtered(
            site_cqcfar_id, LISTA_RESPOSTA_ID,
            f"fields/IDRelatorio eq '{item.id_relatorio}'", top=200,
        )
    except Exception as e:
        raise RelatorioFiscalizacaoError(f"Erro ao buscar respostas: {e}") from e

    if not respostas:
        return None  # Fiscalização ainda não preencheu o checklist

    perguntas = _obter_perguntas(graph_cqcfar, site_cqcfar_id)

    try:
        fotos = graph_cqcfar.get_list_items_filtered(
            site_cqcfar_id, LISTA_ANEXOS_FISCALIZACAO_ID,
            f"fields/ID_Relatorio eq '{item.id_relatorio}'", top=100,
        )
    except Exception:
        fotos = []

    try:
        fiscais = graph_dcan.get_list_items_filtered(
            site_dcan_id, LISTA_FISCAIS_ID,
            f"fields/ID_Relatorio eq '{item.id_relatorio}'", top=20,
        )
    except Exception:
        fiscais = []

    return _montar_html(item, respostas, perguntas, fotos, fiscais)
