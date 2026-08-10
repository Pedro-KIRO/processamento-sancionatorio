"""
Automação Caixa de Entrada — Produção
Varre processos do SEI, filtra por regras de negócio e integra com o
SharePoint via Microsoft Graph.
"""

import logging
import os
import re
import json
import tempfile
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from logging.handlers import RotatingFileHandler

import requests
from dotenv import load_dotenv

# Diretório do próprio script. Resolver os caminhos a partir daqui garante que
# .env, cache e log funcionem mesmo quando o script é executado pelo Agendador
# de Tarefas (que usa um diretório de trabalho diferente).
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# ==============================================================================
# 0. LOGGING (arquivo rotativo + console)
# ==============================================================================
LOG_FILE = os.path.join(BASE_DIR, "automacao.log")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        RotatingFileHandler(LOG_FILE, maxBytes=5_000_000, backupCount=3, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)

# ==============================================================================
# 1. CONFIGURAÇÕES (segredos via .env)
# ==============================================================================
load_dotenv(os.path.join(BASE_DIR, ".env"))

# --- Microsoft Graph / SharePoint ---
GRAPH_TENANT_ID     = os.environ["GRAPH_TENANT_ID"]
GRAPH_CLIENT_ID     = os.environ["GRAPH_CLIENT_ID"]
GRAPH_CLIENT_SECRET = os.environ["GRAPH_CLIENT_SECRET"]
GRAPH_BASE          = "https://graph.microsoft.com/v1.0"
GRAPH_SCOPE         = "https://graph.microsoft.com/.default"
GRAPH_TOKEN_URL     = f"https://login.microsoftonline.com/{GRAPH_TENANT_ID}/oauth2/v2.0/token"

# Sites e listas (GUIDs extraídos dos fluxos originais do Power Automate)
SITE_DCAN_PATH         = "governosp.sharepoint.com:/teams/DETRAN-DCAN"   # Designação
SITE_CPSAR_PATH        = "governosp.sharepoint.com:/teams/DETRAN-CPSAR"  # Caixa de Entrada
LISTA_DESIGNACAO_ID    = "2855ddc6-c7e4-4b1a-a972-5bb939f378d3"          # lista na DCAN
LISTA_CAIXA_ENTRADA_ID = "62d23c4f-0ccb-44c9-bc0a-be052bea3668"          # lista na CPSAR

URL_TOKEN          = "https://idp.sp.gov.br/auth/realms/idpsp/protocol/openid-connect/token"
URL_LISTAR         = "https://sei-processos.api.rota.sp.gov.br/processos"
URL_CONSULTAR_BASE = "https://sei-processos.api.rota.sp.gov.br/processos"
URL_ANDAMENTOS     = "https://sei-processos.api.rota.sp.gov.br/andamentos/completo"

BODY_TOKEN = {
    "grant_type":    "client_credentials",
    "client_id":     os.environ["CLIENT_ID"],
    "client_secret": os.environ["CLIENT_SECRET"],
}

UNIDADES_ALVO = ["110051045", "110051042", "110053117", "110051044", "110051043", "110053119"]

# Lista expandida (inclui unidades CQCFAR)
UNIDADES_PERMITIDAS_SFR = [
    "DETRAN/SI-ARR/SFR", "DETRAN/SI-BTC/SFR", "DETRAN/SI-CPN/SFR", "DETRAN/SI-FND/SFR",
    "DETRAN/SI-ITP/SFR", "DETRAN/SI-JND/SFR", "DETRAN/SI-PPR/SFR", "DETRAN/SI-RPT/SFR",
    "DETRAN/SI-SAN/SFR", "DETRAN/SI-SJC/SFR", "DETRAN/SI-SJR/SFR", "DETRAN/SI-SPL/SFR",
    "DETRAN/SI-BRU/SFR", "DETRAN/SI-RGT/SFR", "DETRAN/SI-ARC/SFR", "DETRAN/SI-GRU/SFR",
    "DETRAN/SI-SBC/SFR", "DETRAN/SI-OSC/SFR", "DETRAN/SI-FRC/SFR", "DETRAN/SI-SRC/SFR",
    "DETRAN/DGR/CQCFAR/DCAR", "DETRAN/DGR/CQCFAR/DFAR", "DETRAN/DGR/CQCFAR/DFAR/SFA-VPD",
    "DETRAN/DGR/CQCFAR/DFAR/SFAC", "DETRAN/DGR/CQCFAR/DFAR/SFAET", "DETRAN/DGR/CQCFAR/DFAR/SFAMA",
    "DETRAN/DGR/CQCFAR/DFAR/SFAV",
]

# Converte para set para busca O(1) — evita duplicados entre páginas
_UNIDADES_PERMITIDAS_SFR_SET = set(UNIDADES_PERMITIDAS_SFR)

HEADERS_BASE = {
    "X-SiglaSistema":         "CSDR_PROCESSAMENTO",
    "X-IdentificacaoServico": "af86add34a8610fe91904a954719b724e698e3ca3b6a5f0234ecc379f0671216b51f454d",
    "Accept":                 "application/json",
}

PREFIXO_UNIDADE_VALIDA = "Serviço de Processamento Sancionatório"
PREFIXO_REMETIDO       = "Processo remetido pela unidade "

# --- Persistência, threads e limites ---
ARQUIVO_CACHE       = os.path.join(BASE_DIR, "processos_ja_vistos.json")
NUM_THREADS         = 2
TOKEN_EXPIRACAO_SEG = 3540   # Renova com 1 min de antecedência
TIMEOUT_LISTAGEM    = 60
TIMEOUT_DETALHE     = 20
TIMEOUT_ANDAMENTOS  = 20
TIMEOUT_GRAPH       = 25
MAX_TENTATIVAS      = 4
BACKOFF_BASE_SEG    = 3
CACHE_FLUSH_INTERVALO = 50   # Salva cache a cada N processos novos


# ==============================================================================
# 2. RATE LIMITER GLOBAL
# ==============================================================================
class RateLimiter:
    """Token bucket simples: máximo de `max_por_segundo` chamadas por segundo."""

    def __init__(self, max_por_segundo: int):
        self._lock = threading.Lock()
        self._intervalo = 1.0 / max_por_segundo
        self._ultimo = 0.0

    def aguardar(self):
        with self._lock:
            agora = time.monotonic()
            esperar = self._intervalo - (agora - self._ultimo)
            if esperar > 0:
                time.sleep(esperar)
            self._ultimo = time.monotonic()


_rate_limiter = RateLimiter(max_por_segundo=3)


# ==============================================================================
# 3. SESSÃO HTTP REUTILIZÁVEL
# ==============================================================================
_http_session = requests.Session()
_http_session.headers.update(HEADERS_BASE)


# ==============================================================================
# 4. GERENCIADOR DE TOKEN COM RENOVAÇÃO AUTOMÁTICA
# ==============================================================================
_token_lock = threading.Lock()
_token_valor: str | None = None
_token_expira_em: datetime | None = None


def _renovar_token() -> bool:
    """Solicita novo access_token ao IdP e atualiza variáveis globais."""
    global _token_valor, _token_expira_em
    try:
        res = requests.post(URL_TOKEN, data=BODY_TOKEN, timeout=15)
        res.raise_for_status()
        dados = res.json()
        _token_valor = dados.get("access_token")
        _token_expira_em = datetime.now() + timedelta(seconds=TOKEN_EXPIRACAO_SEG)
        logger.info("Token renovado. Próxima renovação: %s", _token_expira_em.strftime("%H:%M:%S"))
        return True
    except Exception as e:
        _exibir_erro_detalhado("Renovação do Token", e)
        return False


def obter_token_valido() -> str | None:
    """Retorna token válido, renovando se necessário (thread-safe)."""
    with _token_lock:
        if _token_valor is None or datetime.now() >= _token_expira_em:
            logger.info("Token expirado ou ausente. Renovando...")
            if not _renovar_token():
                return None
        return _token_valor


def obter_headers(id_unidade: str | None = None) -> dict:
    """Monta headers com Bearer token e, opcionalmente, X-IdUnidade."""
    token = obter_token_valido()
    if not token:
        raise RuntimeError("Não foi possível obter um token de acesso válido.")
    h = {"Authorization": f"Bearer {token}"}
    if id_unidade:
        h["X-IdUnidade"] = id_unidade
    return h


# ==============================================================================
# 5. CACHE DE PROCESSOS JÁ PROCESSADOS (thread-safe, JSON)
# ==============================================================================
_cache_lock = threading.Lock()
_processos_vistos: set = set()
_contador_novos: int = 0


def carregar_cache() -> set:
    """Lê o cache JSON de processos já vistos do disco."""
    if not os.path.exists(ARQUIVO_CACHE):
        logger.info("Nenhum cache anterior encontrado. Iniciando do zero.")
        return set()
    try:
        with open(ARQUIVO_CACHE, "r", encoding="utf-8") as f:
            dados = json.load(f)
        vistos = set(dados.get("protocolos_vistos", []))
        logger.info("Cache carregado: %d processos já conhecidos serão ignorados.", len(vistos))
        return vistos
    except Exception as e:
        logger.warning("Falha ao ler cache (%s). Iniciando do zero.", e)
        return set()


def salvar_cache(vistos: set):
    """Salva cache de forma atômica (write → rename) para evitar corrupção."""
    try:
        dir_cache = os.path.dirname(os.path.abspath(ARQUIVO_CACHE))
        with tempfile.NamedTemporaryFile(
            "w", dir=dir_cache, suffix=".tmp", delete=False, encoding="utf-8"
        ) as tmp:
            json.dump({"protocolos_vistos": sorted(vistos)}, tmp, ensure_ascii=False, indent=2)
            tmp_path = tmp.name
        os.replace(tmp_path, ARQUIVO_CACHE)
    except Exception as e:
        logger.warning("Falha ao salvar cache: %s", e)


def marcar_como_visto(protocolo_limpo: str):
    """Adiciona protocolo ao cache e persiste periodicamente."""
    global _contador_novos
    with _cache_lock:
        _processos_vistos.add(protocolo_limpo)
        _contador_novos += 1
        if _contador_novos % CACHE_FLUSH_INTERVALO == 0:
            salvar_cache(_processos_vistos)


def flush_cache():
    """Força a gravação do cache (chamar ao final do processamento)."""
    with _cache_lock:
        salvar_cache(_processos_vistos)


def ja_foi_processado(protocolo_limpo: str) -> bool:
    """Verifica se o protocolo já está no cache."""
    with _cache_lock:
        return protocolo_limpo in _processos_vistos


# ==============================================================================
# 6. EXIBIÇÃO DE ERROS DETALHADOS
# ==============================================================================
def _exibir_erro_detalhado(fase: str, erro: Exception):
    """Loga informações detalhadas sobre falhas em chamadas HTTP."""
    logger.error("=" * 50)
    logger.error("Fase da Falha : %s", fase)
    logger.error("Tipo do Erro  : %s", type(erro).__name__)
    logger.error("Mensagem      : %s", erro)

    resposta = getattr(erro, "response", None)
    if resposta is not None:
        logger.error("Código HTTP   : %d", resposta.status_code)
        corpo = resposta.text.strip() if resposta.text else "(sem corpo)"
        logger.error("Resposta da API:\n%s", corpo)
    elif isinstance(erro, requests.exceptions.Timeout):
        logger.error("Causa: timeout — a API não respondeu a tempo.")
    elif isinstance(erro, requests.exceptions.ConnectionError):
        logger.error("Causa: falha de conexão (DNS, rede ou servidor fora do ar).")
    logger.error("=" * 50)


# ==============================================================================
# 7. REQUISIÇÃO COM RATE LIMIT + RETRY AUTOMÁTICO
# ==============================================================================
def requisicao_com_retry(metodo: str, url: str, fase: str, **kwargs) -> requests.Response | None:
    """
    Executa requisição HTTP com rate limit global e retry automático.

    Trata: Timeout, ConnectionError e HTTP 429.
    Backoff exponencial: 3s → 6s → 12s → ...

    Args:
        metodo: Método HTTP (GET, POST, etc.)
        url: URL de destino.
        fase: Descrição legível para logging.
        **kwargs: Argumentos repassados a requests.Session.request().

    Returns:
        Response em caso de sucesso, None em caso de falha permanente.
    """
    espera = BACKOFF_BASE_SEG

    for tentativa in range(1, MAX_TENTATIVAS + 1):
        _rate_limiter.aguardar()
        try:
            res = _http_session.request(metodo, url, **kwargs)

            if res.status_code == 429:
                corpo = res.text.strip() if res.text else "(sem corpo)"
                logger.warning(
                    "[429] %s | Tentativa %d/%d | Resposta: %s",
                    fase, tentativa, MAX_TENTATIVAS, corpo
                )
                if tentativa < MAX_TENTATIVAS:
                    logger.info("[429] Aguardando %ds...", espera)
                    time.sleep(espera)
                    espera *= 2
                    continue
                else:
                    logger.error("[429] Limite de tentativas esgotado para: %s", fase)
                    return None

            res.raise_for_status()
            return res

        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            logger.warning(
                "[RETRY] %s | Tentativa %d/%d falhou (%s).",
                fase, tentativa, MAX_TENTATIVAS, type(e).__name__
            )
            if tentativa < MAX_TENTATIVAS:
                logger.info("[RETRY] Aguardando %ds...", espera)
                time.sleep(espera)
                espera *= 2
            else:
                _exibir_erro_detalhado(f"{fase} (após {MAX_TENTATIVAS} tentativas)", e)
                return None

        except requests.exceptions.HTTPError as e:
            _exibir_erro_detalhado(fase, e)
            return None

        except Exception as e:
            _exibir_erro_detalhado(fase, e)
            return None

    return None


# ==============================================================================
# 8. LÓGICA DE NEGÓCIO
# ==============================================================================

# Mapeamento estático (definido uma única vez fora da função para performance)
_MAPEAMENTO_AGENTE = {
    # CFCs → Autoescola
    "Centros de formação de condutores – CFC A":  "Autoescola",
    "Centros de formação de condutores – CFC AB": "Autoescola",
    "Centros de formação de condutores – CFC B":  "Autoescola",
    # Peritos
    "Clínica de Medicina do Tráfego":                          "Peritos",
    "Clínica de Medicina do Tráfego e Psicologia do Trânsito": "Peritos",
    "Clínica de Psicologia do Trânsito":                       "Peritos",
    # ECV
    "Empresas credenciadas de vistoria – Presencial": "ECV",
    "Empresas credenciadas de vistoria – Remota":     "ECV",
    # EPIV
    "Empresas estampadoras de placas – PIV": "EPIV",
    # Desmontes
    "Desmontes Fiscalização":   "Desmontes",
    "Desmontes Credenciamento": "Desmontes",
}


def normalizar_agente(agente_sharepoint: str) -> str:
    """
    Converte o valor de agenteRegulado da listaDesignacao (SharePoint)
    para o valor canônico que será gravado na listaCaixaDeEntrada.

    Valores não mapeados são mantidos como vieram.
    """
    return _MAPEAMENTO_AGENTE.get(agente_sharepoint, agente_sharepoint)


def identificar_agente_fallback(tipo_processo: str) -> str:
    """
    Fallback: classifica o agente com base no tipoProcesso da API SEI.
    Usado apenas quando a listaDesignacao não retorna agenteRegulado.
    """
    t = tipo_processo.lower()
    if "autoescola"  in t: return "Autoescola"
    if "médico"      in t: return "Peritos"
    if "psicólogo"   in t: return "Peritos"
    if "clínica"     in t: return "Peritos"
    if "despachante" in t: return "Despachantes"
    if "desmonte"    in t: return "Desmontes"
    if "estampadora" in t: return "EPIV"
    if "ecv"         in t: return "ECV"
    return "Outros"


def buscar_historico_sfr(id_procedimento: str, id_unidade: str) -> tuple[str | None, str | None]:
    """
    Busca andamentos com paginação de 50 em 50 e retorna
    (data_remessa, data_recebimento) referentes ao primeiro andamento
    válido de cada tipo encontrado.

    Args:
        id_procedimento: ID do procedimento no SEI.
        id_unidade: ID da unidade para header de autenticação.

    Returns:
        Tupla (data_remessa, data_recebimento). Qualquer valor pode ser None.
    """
    d_remessa: str | None = None
    d_rec: str | None = None
    start = 0
    limit = 50

    while True:
        params = {
            "protocoloProcedimento": id_procedimento,
            "retornaAtributos":      "S",
            "tipoHistorico":         "R",
            "start":                 start,
            "limit":                 limit,
        }
        h = obter_headers(id_unidade)
        res = requisicao_com_retry(
            "GET", URL_ANDAMENTOS,
            fase=f"Andamentos (ID: {id_procedimento} | Start: {start})",
            headers=h, params=params, timeout=TIMEOUT_ANDAMENTOS,
        )
        if res is None:
            break

        andamentos = res.json().get("Andamentos", [])
        if not andamentos:
            break

        for a in andamentos:
            desc = a.get("descricao", "").replace("\xa0", " ").strip()
            unid_origem = a.get("unidadeOrigem", {})
            unid_destino = a.get("unidade", {})

            if d_remessa is None and any(sfr in desc for sfr in _UNIDADES_PERMITIDAS_SFR_SET):
                if unid_destino.get("descricao", "").startswith(PREFIXO_UNIDADE_VALIDA):
                    d_remessa = a.get("dataHora")

            if d_rec is None and desc == "Processo recebido na unidade":
                if unid_origem.get("descricao", "").startswith(PREFIXO_UNIDADE_VALIDA):
                    d_rec = a.get("dataHora")

            if d_remessa is not None and d_rec is not None:
                return d_remessa, d_rec

        if len(andamentos) < limit:
            break

        start += 1
        time.sleep(0.5)

    return d_remessa, d_rec


def processar_item(item: dict, unid: str) -> dict | None:
    """
    Processa um único processo: consulta detalhes, aplica filtros de negócio
    e busca histórico de remessa/recebimento.

    Returns:
        Dicionário com dados do processo válido, ou None se descartado.
    """
    p_limpo = re.sub(r"\D", "", str(item.get("protocoloProcedimento")))

    if ja_foi_processado(p_limpo):
        return None

    h = obter_headers(unid)
    res = requisicao_com_retry(
        "GET", f"{URL_CONSULTAR_BASE}/{p_limpo}",
        fase=f"Detalhes do Processo ({p_limpo})",
        headers=h,
        params={"sinRetornarUltimoAndamento": "true"},
        timeout=TIMEOUT_DETALHE,
    )
    if res is None:
        return None

    det = res.json()
    status = det.get("ultimoAndamento", {}).get("descricao", "")

    # Filtra apenas processos remetidos por uma unidade SFR permitida
    unidade_remetente = status[len(PREFIXO_REMETIDO):] if status.startswith(PREFIXO_REMETIDO) else ""
    if unidade_remetente not in _UNIDADES_PERMITIDAS_SFR_SET:
        marcar_como_visto(p_limpo)
        return None

    tipo_processo = det.get("tipoProcesso", "")
    agente = identificar_agente_fallback(tipo_processo)

    d_rem, d_rec = buscar_historico_sfr(item.get("idProcedimento"), unid)
    marcar_como_visto(p_limpo)

    if d_rem:
        processo_valido = {
            "protocolo":        det.get("procedimentoFormatado"),
            "protocolo_limpo":  p_limpo,
            "agente":           agente,
            "data_remessa":     d_rem,
            "data_recebimento": d_rec if d_rec else det.get("ultimoAndamento", {}).get("dataHora"),
            "razaoSocial":      det.get("razaoSocial"),
        }
        logger.info("[+] Processo Válido: %s | Agente: %s", processo_valido["protocolo"], agente)
        return processo_valido

    return None


def processar_lista(lista: list[dict], unid: str) -> list[dict]:
    """Processa os itens da lista com NUM_THREADS workers simultâneos."""
    encontrados: list[dict] = []
    with ThreadPoolExecutor(max_workers=NUM_THREADS) as executor:
        futuros = {executor.submit(processar_item, item, unid): item for item in lista}
        for fut in as_completed(futuros):
            try:
                resultado = fut.result()
                if resultado:
                    encontrados.append(resultado)
            except Exception as e:
                logger.exception("Erro inesperado ao processar item: %s", e)
    return encontrados


def processar_unidade(unid: str) -> list[dict]:
    """
    Varre todas as páginas de uma unidade e retorna os processos válidos encontrados.
    Usa um set local para desduplicar itens que apareçam em mais de uma página.
    """
    processos_da_unidade: list[dict] = []
    protocolos_pagina: set = set()  # Desduplicação entre páginas
    pagina = 0

    while True:
        logger.info("Unidade %s | Solicitando Página %d (limit=500)...", unid, pagina)
        time.sleep(1)

        h_lista = obter_headers(unid)
        res_l = requisicao_com_retry(
            "GET", URL_LISTAR,
            fase=f"Listagem da Unidade {unid} (Pág: {pagina})",
            headers=h_lista,
            params={"limit": 500, "start": pagina, "tipo": "T"},
            timeout=TIMEOUT_LISTAGEM,
        )

        if res_l is None:
            logger.warning("Unidade %s | Página %d falhou. Interrompendo.", unid, pagina)
            break

        lista = res_l.json().get("listaProcessos", [])
        if not lista:
            logger.info("Fim dos dados da Unidade %s.", unid)
            break

        # Desduplicação: remove processos já vistos nesta varredura ou no cache
        lista_nova: list[dict] = []
        for item in lista:
            p_limpo = re.sub(r"\D", "", str(item.get("protocoloProcedimento")))
            if p_limpo in protocolos_pagina:
                continue
            protocolos_pagina.add(p_limpo)
            if not ja_foi_processado(p_limpo):
                lista_nova.append(item)

        ignorados = len(lista) - len(lista_nova)
        if ignorados > 0:
            logger.info("%d processo(s) ignorados (cache ou duplicados).", ignorados)

        logger.info("Processando %d itens novos da página %d...", len(lista_nova), pagina)

        encontrados = processar_lista(lista_nova, unid)
        processos_da_unidade.extend(encontrados)

        logger.info("Página %d finalizada. (+%d válidos encontrados)", pagina, len(encontrados))
        pagina += 1

    return processos_da_unidade


# ==============================================================================
# 9. INTEGRAÇÃO SHAREPOINT (Microsoft Graph)
# ==============================================================================

# --- 9.1 Token Graph (renovação automática, thread-safe) ---
_graph_token_lock = threading.Lock()
_graph_token_valor: str | None = None
_graph_token_expira_em: datetime | None = None


def _renovar_token_graph() -> bool:
    """Solicita novo access_token ao Azure AD (fluxo client_credentials)."""
    global _graph_token_valor, _graph_token_expira_em
    try:
        res = requests.post(
            GRAPH_TOKEN_URL,
            data={
                "grant_type":    "client_credentials",
                "client_id":     GRAPH_CLIENT_ID,
                "client_secret": GRAPH_CLIENT_SECRET,
                "scope":         GRAPH_SCOPE,
            },
            timeout=15,
        )
        res.raise_for_status()
        dados = res.json()
        _graph_token_valor = dados.get("access_token")
        expira_seg = int(dados.get("expires_in", 3600))
        _graph_token_expira_em = datetime.now() + timedelta(seconds=expira_seg - 60)
        logger.info("Token Graph renovado. Próxima renovação após %s.",
                    _graph_token_expira_em.strftime("%H:%M:%S"))
        return bool(_graph_token_valor)
    except Exception as e:
        _exibir_erro_detalhado("Renovação do Token Graph", e)
        return False


def obter_token_graph_valido() -> str | None:
    """Retorna token Graph válido, renovando se necessário (thread-safe)."""
    with _graph_token_lock:
        if _graph_token_valor is None or datetime.now() >= _graph_token_expira_em:
            logger.info("Token Graph expirado ou ausente. Renovando...")
            if not _renovar_token_graph():
                return None
        return _graph_token_valor


# --- 9.2 Resolução de IDs de site (cacheada em memória) ---
_graph_site_ids: dict[str, str] = {}


def resolver_site_id(site_path: str) -> str | None:
    """
    Resolve o ID interno de um site do SharePoint a partir do caminho
    'hostname:/caminho-relativo'. O resultado é cacheado para a sessão.
    """
    if site_path in _graph_site_ids:
        return _graph_site_ids[site_path]

    token = obter_token_graph_valido()
    if not token:
        return None

    res = requisicao_com_retry(
        "GET", f"{GRAPH_BASE}/sites/{site_path}",
        fase=f"Graph Resolver Site ({site_path})",
        headers={"Authorization": f"Bearer {token}"},
        timeout=TIMEOUT_GRAPH,
    )
    if res is None:
        return None

    site_id = res.json().get("id")
    if site_id:
        _graph_site_ids[site_path] = site_id
        logger.info("Site resolvido: %s", site_path)
    return site_id


# --- 9.3 Conversão de datas (dd/mm/yyyy hh:mm:ss -> ISO 8601) ---
def _formatar_data_iso(data_str: str | None) -> str | None:
    """
    Converte a data do SEI ('dd/mm/yyyy hh:mm:ss') para ISO 8601
    ('yyyy-mm-ddThh:mm:ssZ') — mesma transformação feita no fluxo original.
    """
    if not data_str:
        return None
    try:
        partes = str(data_str).strip().split(" ")
        dia, mes, ano = partes[0].split("/")
        hora = partes[1] if len(partes) > 1 else "00:00:00"
        return f"{ano}-{mes.zfill(2)}-{dia.zfill(2)}T{hora}Z"
    except Exception:
        logger.warning("Data em formato inesperado ('%s'). Enviando sem conversão.", data_str)
        return data_str


def _mascarar_documento(valor) -> str:
    """
    Formata CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00) conforme a
    quantidade de dígitos. É idempotente: se o valor já vier mascarado, o
    resultado é o mesmo. Valores com tamanho inesperado voltam só com dígitos.
    """
    digitos = re.sub(r"\D", "", str(valor or ""))
    if len(digitos) == 11:   # CPF
        return f"{digitos[:3]}.{digitos[3:6]}.{digitos[6:9]}-{digitos[9:]}"
    if len(digitos) == 14:   # CNPJ
        return f"{digitos[:2]}.{digitos[2:5]}.{digitos[5:8]}/{digitos[8:12]}-{digitos[12:]}"
    return digitos


# --- 9.4 Leitura (substitui a Ponte de Leitura) ---
def consultar_sharepoint(sei: str) -> dict | None:
    """
    Busca os dados na Designação (DCAN) e verifica duplicidade na
    Caixa de Entrada (CPSAR).

    Returns:
        Dict com ID_Relatorio, agenteRegulado, cnpj_real, razaoSocial e
        ja_existe; ou None se alguma consulta falhar.
    """
    token = obter_token_graph_valido()
    site_dcan = resolver_site_id(SITE_DCAN_PATH)
    site_cpsar = resolver_site_id(SITE_CPSAR_PATH)
    if not token or not site_dcan or not site_cpsar:
        return None

    headers = {
        "Authorization": f"Bearer {token}",
        # Permite filtrar mesmo em colunas não indexadas.
        "Prefer": "HonorNonIndexedQueriesWarningMayFailRandomly",
    }

    # 1. Designação (DCAN) — filtra por numeroSei
    res_desig = requisicao_com_retry(
        "GET", f"{GRAPH_BASE}/sites/{site_dcan}/lists/{LISTA_DESIGNACAO_ID}/items",
        fase=f"Graph Leitura Designação ({sei})",
        headers=headers,
        params={
            "$expand": "fields",
            "$filter": f"fields/numeroSei eq '{sei}'",
            "$top": "1",
        },
        timeout=TIMEOUT_GRAPH,
    )
    if res_desig is None:
        return None

    itens = res_desig.json().get("value", [])
    if not itens:
        # Não está na Designação: ID_Relatorio vazio faz a integração pular.
        return {"ID_Relatorio": None, "agenteRegulado": "",
                "cnpj_real": "", "razaoSocial": "", "ja_existe": False}

    campos = itens[0].get("fields", {})

    # 2. Caixa de Entrada (CPSAR) — verifica duplicidade por numeroSEI
    res_caixa = requisicao_com_retry(
        "GET", f"{GRAPH_BASE}/sites/{site_cpsar}/lists/{LISTA_CAIXA_ENTRADA_ID}/items",
        fase=f"Graph Leitura Caixa ({sei})",
        headers=headers,
        params={
            "$expand": "fields",
            "$filter": f"fields/numeroSEI eq '{sei}'",
            "$top": "1",
        },
        timeout=TIMEOUT_GRAPH,
    )
    if res_caixa is None:
        return None

    return {
        "ID_Relatorio":   campos.get("ID_Relatorio"),
        "agenteRegulado": campos.get("agenteRegulado", ""),
        "cnpj_real":      campos.get("cnpj", ""),
        "razaoSocial":    campos.get("razaoSocial", ""),
        "ja_existe":      len(res_caixa.json().get("value", [])) > 0,
    }


# --- 9.5 Gravação (substitui a Ponte de Gravação) ---
def gravar_sharepoint(payload: dict) -> bool:
    """
    Cria o item na Caixa de Entrada (CPSAR) e atualiza copiaID com o ID do
    item recém-criado (mesma lógica dos passos "Criar item" + "Atualizar item").
    """
    token = obter_token_graph_valido()
    site_cpsar = resolver_site_id(SITE_CPSAR_PATH)
    if not token or not site_cpsar:
        return False

    headers = {"Authorization": f"Bearer {token}"}
    url_itens = f"{GRAPH_BASE}/sites/{site_cpsar}/lists/{LISTA_CAIXA_ENTRADA_ID}/items"

    # Campos gravados na Caixa de Entrada. CNPJ/CPF sempre com máscara;
    # datas convertidas para ISO 8601 (como o fluxo original fazia).
    fields = {
        "ID_Relatorio":    payload["ID_Relatorio"],
        "numeroSEI":       payload["numeroSEI"],
        "razaoSocial":     payload.get("razaoSocial", ""),
        "agenteRegulado":  payload["agenteRegulado"],
        "tipoDocumento":   payload["tipoDocumento"],
        "CNPJ_x002f_CPF":  _mascarar_documento(payload["valorDocumento"]),
        "dataRecebimento": _formatar_data_iso(payload["dataRecebimento"]),
        "dataRemetido":    _formatar_data_iso(payload["dataRemetido"]),
    }

    res = requisicao_com_retry(
        "POST", url_itens,
        fase=f"Graph Gravação ({payload['numeroSEI']})",
        headers=headers,
        json={"fields": fields},
        timeout=TIMEOUT_GRAPH,
    )
    if res is None or res.status_code not in (200, 201):
        return False

    # Atualiza copiaID com o ID do item criado (o fluxo grava o body/ID numérico).
    novo_id = res.json().get("id")
    if novo_id:
        try:
            copia_valor = int(novo_id)
        except (TypeError, ValueError):
            copia_valor = str(novo_id)
        requisicao_com_retry(
            "PATCH", f"{url_itens}/{novo_id}/fields",
            fase=f"Graph copiaID ({payload['numeroSEI']})",
            headers=headers,
            json={"copiaID": copia_valor},
            timeout=TIMEOUT_GRAPH,
        )
    return True


# --- 9.6 Orquestração da integração ---
def integrar_sharepoint(processos_validos: list[dict]):
    """Integra cada processo válido ao SharePoint via Graph e atualiza o cache."""
    logger.info("[3/3] Integrando com SharePoint via Microsoft Graph (%d processos novos)...",
                len(processos_validos))

    # Resolve os sites uma vez; falha cedo se credenciais/sites estiverem incorretos.
    if resolver_site_id(SITE_DCAN_PATH) is None or resolver_site_id(SITE_CPSAR_PATH) is None:
        logger.error("Falha ao resolver os sites do SharePoint. Integração abortada.")
        return

    for p in processos_validos:
        sei = p["protocolo"]
        p_limpo = p["protocolo_limpo"]
        agente = p["agente"]

        try:
            # Consulta (leitura): dados da Designação + checagem de duplicidade
            dados_sp = consultar_sharepoint(sei)
            if dados_sp is None:
                logger.warning("Gravando %s: erro na consulta ao SharePoint. Pulando.", sei)
                continue

            if not dados_sp.get("ID_Relatorio") or dados_sp.get("ja_existe"):
                logger.info("Gravando %s: ignorado (não designado ou duplicado).", sei)
                marcar_como_visto(p_limpo)
                continue

            # Agente: normaliza o valor da Designação; usa fallback do SEI se vazio
            agente_bruto = dados_sp.get("agenteRegulado", "")
            agente_final = normalizar_agente(agente_bruto) if agente_bruto else agente
            tipo_doc = "CPF" if agente_final in ("Peritos", "Despachantes") else "CNPJ"

            payload = {
                "numeroSEI":       sei,
                "ID_Relatorio":    str(dados_sp.get("ID_Relatorio")),
                "razaoSocial":     dados_sp.get("razaoSocial") or p.get("razaoSocial") or "",
                "agenteRegulado":  agente_final,
                "tipoDocumento":   tipo_doc,
                "valorDocumento":  str(dados_sp.get("cnpj_real", "")),
                "dataRecebimento": p["data_recebimento"],
                "dataRemetido":    p["data_remessa"],
            }

            if gravar_sharepoint(payload):
                logger.info("Gravando %s: SUCESSO!", sei)
                marcar_como_visto(p_limpo)
            else:
                logger.error("Gravando %s: falha na gravação via Graph.", sei)

        except Exception as e:
            logger.exception("Erro na integração do processo %s: %s", sei, e)


# ==============================================================================
# 10. MAIN
# ==============================================================================
def main():
    inicio_global = time.time()

    # 0. Carrega cache
    logger.info("[0/3] Carregando cache de processos já processados...")
    global _processos_vistos
    _processos_vistos = carregar_cache()

    # 1. Autenticação inicial
    logger.info("[1/3] Autenticando no SEI...")
    if not _renovar_token():
        logger.critical("ERRO FATAL: Não foi possível autenticar. Encerrando.")
        return

    # 2. Varredura completa do SEI
    logger.info("[2/3] Iniciando Varredura Completa de Todas as Unidades...")
    logger.info("Configuração: %d threads | Rate limit: 3 req/s | Cache ativo", NUM_THREADS)
    processos_validos_totais: list[dict] = []

    for unid in UNIDADES_ALVO:
        resultados = processar_unidade(unid)
        processos_validos_totais.extend(resultados)

    # Flush final do cache após varredura
    flush_cache()

    logger.info("=== VARREDURA DO SEI FINALIZADA ===")
    logger.info("Total de processos válidos filtrados: %d", len(processos_validos_totais))
    logger.info("Total acumulado no cache: %d processos", len(_processos_vistos))

    # 3. Integração SharePoint
    if processos_validos_totais:
        integrar_sharepoint(processos_validos_totais)
    else:
        logger.info("[3/3] Nenhum processo novo para integrar ao SharePoint.")

    # Flush final pós-integração
    flush_cache()

    logger.info("Concluído em %.2fs.", time.time() - inicio_global)


if __name__ == "__main__":
    main()
