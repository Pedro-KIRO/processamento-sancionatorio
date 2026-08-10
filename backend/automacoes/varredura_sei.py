"""
Varredura da Caixa de Entrada do SEI → banco próprio.

Fluxo:
1. Autentica no SEI (OAuth2 client_credentials)
2. Varre processos das 6 unidades-alvo
3. Filtra: só processos remetidos por unidades SFR permitidas
4. Busca andamentos para extrair datas de remessa/recebimento
5. Consulta SharePoint (listaDesignação) para enriquecer com dados do relatório
6. Grava no banco (CaixaEntrada) — deduplicação por protocolo_limpo

Uso:
    cd backend/
    python -m automacoes.varredura_sei [--dry-run] [--limit N]

Agendar no servidor a cada 5 minutos para manter o site atualizado.
"""
import argparse
import logging
import os
import re
import sys
import time
import unicodedata
from datetime import datetime

# Resolve o path para importar app.*
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from app.db.base import Base, get_engine, get_sessionmaker  # noqa: E402
from app.db import models as m  # noqa: E402
from app.integrations.sei.client import SeiClient, SeiSettings  # noqa: E402
from app.integrations.graph.client import GraphClient  # noqa: E402

# ==============================================================================
# Logging
# ==============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)

# ==============================================================================
# Configuração
# ==============================================================================
UNIDADES_ALVO = ["110051045", "110051042", "110053117", "110051044", "110051043", "110053119"]

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

PREFIXO_REMETIDO = "Processo remetido pela unidade "
PREFIXO_UNIDADE_VALIDA = "Serviço de Processamento Sancionatório"

# Quantos itens a limpeza verifica por ciclo da varredura (roda a cada 5 min).
# A verificação custa ~1 request ao SEI + 0.3s de pausa por item; limitar
# mantém o ciclo curto. Os itens rodam em rotação (menos recentemente
# verificados primeiro), então todos são cobertos ao longo dos ciclos.
LIMPEZA_MAX_ITENS_POR_CICLO = 30

# A consolidação dos nomes vive em app/services/agentes_regulados.py, que é a
# fonte única do vocabulário do app (Autoescola, Perito, Desmonte, Despachante,
# ECV, Estampadora). Antes havia um mapa próprio aqui, no plural, e as tabelas
# de configuração usavam esse outro vocabulário.
from app.services.agentes_regulados import (  # noqa: E402
    AUTOESCOLA,
    DESMONTE,
    DESPACHANTE,
    ECV as CLASSE_ECV,
    ESTAMPADORA,
    PERITO,
)
from app.services.agentes_regulados import normalizar as _normalizar_classe  # noqa: E402

# SharePoint
GRAPH_TENANT_ID = os.getenv("GRAPH_TENANT_ID", "")
GRAPH_CLIENT_ID = os.getenv("GRAPH_CLIENT_ID", "")
GRAPH_CLIENT_SECRET = os.getenv("GRAPH_CLIENT_SECRET", "")
SITE_DCAN_PATH = "governosp.sharepoint.com:/teams/DETRAN-DCAN"
SITE_CPSAR_PATH = "governosp.sharepoint.com:/teams/DETRAN-CPSAR"
LISTA_DESIGNACAO_ID = "2855ddc6-c7e4-4b1a-a972-5bb939f378d3"


# ==============================================================================
# Helpers
# ==============================================================================
def limpar_numero(numero: str) -> str:
    return re.sub(r"\D", "", str(numero or ""))


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", str(texto or ""))
        if unicodedata.category(c) != "Mn"
    )


def normalizar_agente(agente_sharepoint: str) -> str:
    """Classe canônica do agente vindo da listaDesignacao.

    Devolve o valor original quando a classe não pertence ao app: aqui o item
    está entrando na caixa de entrada porque foi remetido por uma unidade SFR,
    então descartá-lo silenciosamente seria pior do que registrar com o nome
    original e deixar visível.
    """
    return _normalizar_classe(agente_sharepoint) or agente_sharepoint


def identificar_agente_fallback(tipo_processo: str) -> str:
    """Classe deduzida do tipo de procedimento, quando o SharePoint não informa.

    A comparação ignora acento: o nome do tipo no SEI aparece nas duas formas
    ("Clínica" e "Clinica"), e antes só a acentuada era reconhecida.
    """
    t = _sem_acento(tipo_processo).lower()
    if "autoescola" in t or "cfc" in t:
        return AUTOESCOLA
    if "medico" in t or "psicolog" in t or "clinica" in t or "perito" in t:
        return PERITO
    if "despachante" in t:
        return DESPACHANTE
    if "desmonte" in t or "desmanche" in t:
        return DESMONTE
    if "estampadora" in t or "piv" in t:
        return ESTAMPADORA
    if "ecv" in t or "vistoria" in t:
        return CLASSE_ECV
    return "Outros"


def mascarar_documento(valor: str) -> str:
    digitos = re.sub(r"\D", "", str(valor or ""))
    if len(digitos) == 11:
        return f"{digitos[:3]}.{digitos[3:6]}.{digitos[6:9]}-{digitos[9:]}"
    if len(digitos) == 14:
        return f"{digitos[:2]}.{digitos[2:5]}.{digitos[5:8]}/{digitos[8:12]}-{digitos[12:]}"
    return digitos


def formatar_data_sei(data_str: str | None):
    """Converte dd/mm/yyyy HH:mm:ss → date. Retorna None se inválido."""
    if not data_str:
        return None
    try:
        partes = str(data_str).strip().split(" ")
        dia, mes, ano = partes[0].split("/")
        from datetime import date as dt_date
        return dt_date(int(ano), int(mes), int(dia))
    except Exception:
        return None


# ==============================================================================
# SEI: buscar histórico de remessa/recebimento
# ==============================================================================
def buscar_historico_sfr(sei_client: SeiClient, id_procedimento: str, id_unidade: str):
    """Retorna (data_remessa, data_recebimento) das datas relevantes dos andamentos."""
    d_remessa = None
    d_rec = None
    start = 0
    limit = 50

    while True:
        try:
            resp = sei_client.listar_andamentos(
                id_procedimento, id_unidade, tipo_historico="R", start=start, limit=limit
            )
        except Exception as e:
            logger.warning("Erro ao buscar andamentos (ID %s): %s", id_procedimento, e)
            break

        andamentos = resp.get("Andamentos", [])
        if not andamentos:
            break

        for a in andamentos:
            desc = a.get("descricao", "").replace("\xa0", " ").strip()
            unid_destino = a.get("unidade", {})
            unid_origem = a.get("unidadeOrigem", {})

            if d_remessa is None and any(sfr in desc for sfr in UNIDADES_PERMITIDAS_SFR):
                if unid_destino.get("descricao", "").startswith(PREFIXO_UNIDADE_VALIDA):
                    d_remessa = a.get("dataHora")

            if d_rec is None and desc == "Processo recebido na unidade":
                if unid_origem.get("descricao", "").startswith(PREFIXO_UNIDADE_VALIDA):
                    d_rec = a.get("dataHora")

            if d_remessa and d_rec:
                return d_remessa, d_rec

        if len(andamentos) < limit:
            break
        start += 1
        time.sleep(0.3)

    return d_remessa, d_rec


# ==============================================================================
# SharePoint: consultar listaDesignação
# ==============================================================================
def consultar_designacao(graph: GraphClient, site_dcan_id: str, numero_sei: str) -> dict | None:
    """Busca dados na listaDesignação pelo número SEI formatado."""
    if not site_dcan_id:
        return None
    try:
        itens = graph.get_list_items_filtered(
            site_dcan_id, LISTA_DESIGNACAO_ID,
            f"fields/numeroSei eq '{numero_sei}'"
        )
        if not itens:
            return None
        campos = itens[0].get("fields", {})
        return {
            "ID_Relatorio": campos.get("ID_Relatorio"),
            "agenteRegulado": campos.get("agenteRegulado", ""),
            "cnpj": campos.get("cnpj", ""),
            "razaoSocial": campos.get("razaoSocial", ""),
            "dataInicioFiscalizacao": campos.get("dataInicioFiscalizacao", ""),
            "cidade": campos.get("cidade", ""),
        }
    except Exception as e:
        logger.warning("Erro ao consultar Designação para %s: %s", numero_sei, e)
        return None


# ==============================================================================
# Principal
# ==============================================================================
def varrer(dry_run: bool = False, limite: int = 0):
    # Inicializar SEI client
    settings = SeiSettings(
        token_url=os.environ.get("SEI_TOKEN_URL", ""),
        client_id=os.environ.get("SEI_CLIENT_ID", os.environ.get("CLIENT_ID", "")),
        client_secret=os.environ.get("SEI_CLIENT_SECRET", os.environ.get("CLIENT_SECRET", "")),
        api_base=os.environ.get("SEI_API_BASE", ""),
        sigla_sistema=os.environ.get("SEI_SIGLA_SISTEMA", "CSDR_PROCESSAMENTO"),
        identificacao_servico=os.environ.get("SEI_IDENTIFICACAO_SERVICO", ""),
        trace_id=os.environ.get("SEI_TRACE_ID", ""),
    )

    if not settings.token_url or not settings.client_id:
        logger.error("Variáveis SEI não configuradas no .env. Abortando.")
        return

    sei = SeiClient(settings, timeout=30)

    # Inicializar Graph (para listaDesignação)
    graph = None
    site_dcan_id = None
    if GRAPH_TENANT_ID and GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET:
        try:
            from app.integrations.graph.client import GraphSettings
            graph_settings = GraphSettings(
                tenant_id=GRAPH_TENANT_ID,
                client_id=GRAPH_CLIENT_ID,
                client_secret=GRAPH_CLIENT_SECRET,
                hostname="governosp.sharepoint.com",
                site_path="/teams/DETRAN-DCAN",
            )
            graph = GraphClient(graph_settings)
            site_dcan_id = graph.get_site_id()
            logger.info("Graph conectado. Site DCAN: %s", site_dcan_id)
        except Exception as e:
            logger.warning("Graph não disponível (%s). Prosseguindo sem enriquecimento.", e)
            graph = None
    else:
        logger.info("Credenciais Graph não configuradas. Sem enriquecimento via SharePoint.")

    # Banco de dados
    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    # Carregar protocolos já no banco (substitui o cache JSON)
    with Session() as s:
        protocolos_existentes = set(
            s.query(m.CaixaEntrada.protocolo_limpo)
            .filter(m.CaixaEntrada.protocolo_limpo.is_not(None))
            .all()
        )
        protocolos_existentes = {p[0] for p in protocolos_existentes}
    logger.info("Protocolos já no banco: %d", len(protocolos_existentes))

    # Carregar também o cache JSON da automação antiga (processos já descartados/processados)
    cache_antigo = os.path.join(
        os.path.expanduser("~"), "Desktop", "codigod",
        "automacao-caixa-de-entrada", "processos_ja_vistos.json"
    )
    if os.path.exists(cache_antigo):
        import json
        try:
            with open(cache_antigo, "r", encoding="utf-8") as f:
                dados_cache = json.load(f)
            vistos_antigos = set(dados_cache.get("protocolos_vistos", []))
            protocolos_existentes.update(vistos_antigos)
            logger.info("Cache antigo carregado: +%d protocolos (total exclusão: %d)",
                        len(vistos_antigos), len(protocolos_existentes))
        except Exception as e:
            logger.warning("Não foi possível ler cache antigo: %s", e)
    else:
        logger.info("Cache antigo não encontrado em %s (ignorando).", cache_antigo)

    # Varredura
    total_novos = 0
    inicio = time.time()

    for unid in UNIDADES_ALVO:
        if limite and total_novos >= limite:
            break

        logger.info("Varrendo unidade %s...", unid)
        pagina = 0

        while True:
            if limite and total_novos >= limite:
                break

            try:
                resp = sei.listar_processos(unid, limit=500, start=pagina)
            except Exception as e:
                logger.error("Erro ao listar unidade %s página %d: %s", unid, pagina, e)
                break

            lista = resp.get("listaProcessos", [])
            if not lista:
                break

            for item in lista:
                if limite and total_novos >= limite:
                    break

                p_limpo = limpar_numero(item.get("protocoloProcedimento"))
                if not p_limpo or p_limpo in protocolos_existentes:
                    continue

                # Consultar detalhes
                time.sleep(0.3)
                try:
                    det = sei.consultar_processo(p_limpo, unid, ultimo_andamento=True)
                except Exception as e:
                    logger.warning("Erro detalhes %s: %s", p_limpo, e)
                    protocolos_existentes.add(p_limpo)
                    continue

                # Filtrar: só remetidos por SFR
                status_desc = det.get("ultimoAndamento", {}).get("descricao", "")
                unidade_remetente = ""
                if status_desc.startswith(PREFIXO_REMETIDO):
                    unidade_remetente = status_desc[len(PREFIXO_REMETIDO):]

                if unidade_remetente not in UNIDADES_PERMITIDAS_SFR:
                    protocolos_existentes.add(p_limpo)
                    continue

                # Buscar andamentos para datas
                id_proc = det.get("idProcedimento")
                d_rem, d_rec = buscar_historico_sfr(sei, item.get("idProcedimento", id_proc), unid)

                if not d_rem:
                    protocolos_existentes.add(p_limpo)
                    continue

                # Enriquecer com SharePoint (listaDesignação)
                numero_formatado = det.get("procedimentoFormatado", "")
                tipo_processo = det.get("tipoProcesso", "")
                agente = identificar_agente_fallback(tipo_processo)
                agente_origem = None
                id_relatorio = None
                cnpj_cpf = ""
                razao_social = det.get("razaoSocial", "")

                if graph and site_dcan_id and numero_formatado:
                    dados_sp = consultar_designacao(graph, site_dcan_id, numero_formatado)
                    if dados_sp and dados_sp.get("ID_Relatorio"):
                        id_relatorio = str(dados_sp["ID_Relatorio"])
                        agente_bruto = dados_sp.get("agenteRegulado", "")
                        if agente_bruto:
                            agente = normalizar_agente(agente_bruto)
                            # O nome original fica guardado: a classe
                            # consolidada não distingue clínica, médico e
                            # psicólogo, e o SEI exige tipos de procedimento
                            # diferentes para os três na instauração.
                            agente_origem = agente_bruto.strip()
                        cnpj_cpf = mascarar_documento(dados_sp.get("cnpj", ""))
                        razao_social = dados_sp.get("razaoSocial") or razao_social

                # Data de início da fiscalização (do SharePoint)
                data_inicio_fisc = None
                if graph and site_dcan_id and numero_formatado:
                    if dados_sp and dados_sp.get("dataInicioFiscalizacao"):
                        data_inicio_fisc = formatar_data_sei(dados_sp["dataInicioFiscalizacao"])

                # Município e superintendência (listaDesignacao.cidade → listaMunicipios)
                municipio = None
                superintendencia = None
                if dados_sp and dados_sp.get("cidade"):
                    try:
                        from app.services.localizacao_agente import resolver as resolver_local
                        municipio, superintendencia = resolver_local(dados_sp["cidade"])
                    except Exception as e:  # noqa: BLE001
                        logger.warning("Falha ao resolver município/superintendência: %s", e)

                # Divisão responsável, conforme a classe do agente
                segmento = ""
                if agente == AUTOESCOLA:
                    segmento = "Educacao"
                elif agente in (CLASSE_ECV, ESTAMPADORA, DESMONTE):
                    segmento = "Veiculos"
                elif agente in (PERITO, DESPACHANTE):
                    segmento = "Condutores"

                # Perito e despachante são pessoas físicas; as demais classes,
                # empresas.
                tipo_doc = "CPF" if agente in (PERITO, DESPACHANTE) else "CNPJ"

                logger.info("[+] %s | %s | %s", numero_formatado, agente, razao_social[:40])

                if not dry_run:
                    with Session() as s:
                        novo = m.CaixaEntrada(
                            protocolo_limpo=p_limpo,
                            numero_sei=numero_formatado,
                            id_procedimento=str(id_proc) if id_proc else None,
                            id_relatorio=id_relatorio,
                            razao_social=razao_social,
                            agente_regulado=agente,
                            agente_origem=agente_origem,
                            segmento=segmento,
                            tipo_documento=tipo_doc,
                            cnpj_cpf=cnpj_cpf,
                            data_recebimento=formatar_data_sei(d_rec or d_rem),
                            data_remetido=formatar_data_sei(d_rem),
                            data_inicio_fiscalizacao=data_inicio_fisc,
                            municipio=municipio,
                            superintendencia=superintendencia,
                            status_triagem="pendente",
                            id_unidade_sei=unid,
                        )
                        s.add(novo)
                        s.commit()

                protocolos_existentes.add(p_limpo)
                total_novos += 1

            if len(lista) < 500:
                break
            pagina += 1
            time.sleep(1)

    elapsed = time.time() - inicio
    logger.info("=== Varredura concluída em %.1fs. Novos processos: %d ===", elapsed, total_novos)

    if dry_run:
        return

    # ETAPA 2: gerar HTML dos relatórios pendentes
    _gerar_htmls_pendentes(Session)

    # ══════════════════════════════════════════════════════════════════════
    # ETAPA 3: Limpar itens que não atendem mais o filtro da caixa de entrada
    # ══════════════════════════════════════════════════════════════════════
    # Roda aqui (e não como tarefa agendada separada) para reaproveitar o
    # cliente SEI já autenticado. Limitado por ciclo: os itens são verificados
    # em rotação (menos recentemente verificados primeiro), então cada execução
    # tem duração previsível mesmo com a caixa cheia.
    try:
        from automacoes.limpar_caixa_entrada import limpar as limpar_caixa
        logger.info("=== Limpando itens fora do filtro (rotação) ===")
        limpar_caixa(max_itens=LIMPEZA_MAX_ITENS_POR_CICLO, sei=sei)
    except Exception as e:  # noqa: BLE001
        logger.warning("Falha na limpeza da caixa de entrada: %s", e)


def _gerar_htmls_pendentes(Session):
    """Gera o HTML do relatório de fiscalização para os itens que ainda não têm.

    Separado de ``varrer()`` para que os retornos antecipados daqui (flow não
    configurado, nada pendente) não impeçam as etapas seguintes da varredura.
    """
    flow_url = os.getenv("FLOW_DETALHES_URL", "")
    if not flow_url:
        logger.info("FLOW_DETALHES_URL não configurada. Pulando geração de HTML.")
        return

    import requests as req

    with Session() as s:
        pendentes = (
            s.query(m.CaixaEntrada)
            .filter(m.CaixaEntrada.id_relatorio.is_not(None))
            .filter(m.CaixaEntrada.id_relatorio != "")
            .filter(
                (m.CaixaEntrada.conteudo_html.is_(None)) | (m.CaixaEntrada.conteudo_html == "")
            )
            .limit(20)
            .all()
        )

    if not pendentes:
        logger.info("Nenhum relatório HTML pendente de geração.")
        return

    logger.info("=== Gerando HTML para %d relatórios ===", len(pendentes))
    gerados = 0

    for item in pendentes:
        try:
            resp = req.post(flow_url, json={"idRelatorio": item.id_relatorio}, timeout=120)
            if resp.status_code != 200:
                logger.warning("Flow retornou %d para %s", resp.status_code, item.id_relatorio)
                continue

            detalhes = resp.json()
            respostas = detalhes.get("respostas", [])
            if not respostas:
                logger.info("  %s: sem respostas. Pulando.", item.numero_sei)
                continue

            html = _gerar_html(item, detalhes)

            with Session() as s:
                db_item = s.get(m.CaixaEntrada, item.id)
                db_item.conteudo_html = html
                s.commit()

            gerados += 1
            logger.info("  %s: HTML gerado (%d chars)", item.numero_sei, len(html))
            time.sleep(1)

        except Exception as e:
            logger.warning("  Erro ao gerar HTML para %s: %s", item.numero_sei, e)

    logger.info("=== Geração concluída. Relatórios gerados: %d ===", gerados)


def _gerar_html(item: m.CaixaEntrada, detalhes: dict) -> str:
    """Gera HTML do relatório de fiscalização."""
    respostas = detalhes.get("respostas", [])
    fiscais = detalhes.get("fiscais", [])
    fotos = detalhes.get("fotos", [])

    # Constatações e conclusão
    constatacoes = ""
    conclusao = ""
    for r in respostas:
        texto = r.get("Texto", "")
        resposta = r.get("Resposta", "")
        if texto == "Conclusão":
            conclusao = resposta
        elif texto:
            constatacoes += (
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
    html_fotos = ""
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
        <tr><td style="padding:10px; border:1px solid #000;"><table>{html_fotos}</table></td></tr>
    </table>
</div>
</body></html>"""


def main():
    parser = argparse.ArgumentParser(description="Varredura SEI → banco próprio")
    parser.add_argument("--dry-run", action="store_true", help="Não grava, só mostra o que faria.")
    parser.add_argument("--limit", type=int, default=0, help="Máximo de processos novos (0=todos).")
    args = parser.parse_args()

    varrer(dry_run=args.dry_run, limite=args.limit)


if __name__ == "__main__":
    main()
