"""Configuracoes carregadas do arquivo .env."""
import os
from dotenv import load_dotenv

load_dotenv()


def _req(nome):
    valor = os.getenv(nome)
    if not valor:
        raise RuntimeError(f"Variavel de ambiente obrigatoria ausente: {nome}")
    return valor


# Microsoft Graph
GRAPH_TENANT_ID = _req("GRAPH_TENANT_ID")
GRAPH_CLIENT_ID = _req("GRAPH_CLIENT_ID")
GRAPH_CLIENT_SECRET = _req("GRAPH_CLIENT_SECRET")

# SharePoint
SHAREPOINT_HOSTNAME = _req("SHAREPOINT_HOSTNAME")
SHAREPOINT_SITE_PATH = _req("SHAREPOINT_SITE_PATH")

# API SEI
SEI_TOKEN_URL = _req("SEI_TOKEN_URL")
SEI_CLIENT_ID = _req("SEI_CLIENT_ID")
SEI_CLIENT_SECRET = _req("SEI_CLIENT_SECRET")
SEI_API_BASE = _req("SEI_API_BASE")
SEI_SIGLA_SISTEMA = _req("SEI_SIGLA_SISTEMA")
SEI_IDENTIFICACAO_SERVICO = _req("SEI_IDENTIFICACAO_SERVICO")
SEI_TRACE_ID = _req("SEI_TRACE_ID")

# Nomes das listas do SharePoint (displayName)
LISTA_PROC_EM_ANDAMENTO = "listaProcEmAndamento"
LISTA_FASES_PA = "listaFasesPA"
LISTA_SEI_DESPACHOS = "listaSEIDespachos"
LISTA_USUARIOS = "listaUsuarios"
LISTA_CAIXA_ENTRADA = "listaCaixaDeEntrada"

# Nomes internos das colunas
COL_PROC_NUMERO_SEI = "numeroSEI"
COL_PROC_AGENTE = "agenteRegulado"
COL_PROC_DATA_INSTAURACAO = "dataInstauracao"
COL_PROC_DATA_SITUACAO = "dataSituacaoProcessual"

COL_FASES_NUMERO_SEI = "numeroSEIPA"
COL_FASES_FASE = "fasePA"
COL_FASES_DATA = "dataFase"

COL_DESPACHOS_DESCRICAO = "descricaoDOC"

COL_USUARIOS_AGENTE = "agenteRegulado"
COL_USUARIOS_ID_UNIDADE = "idUnidade"