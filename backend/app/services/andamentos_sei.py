"""Descoberta da data de instauração de um processo SEI (data de ASSINATURA).

Portado do fluxo de referência `atualizar_assinatura` (`flows_referencia/`).

Importante: "data de instauração" aqui NÃO é a data de criação do documento
de instauração — é a data em que o documento foi efetivamente ASSINADO.
O SEI registra isso como um andamento de tarefa=5 ("documento assinado").
Como podem existir vários documentos assinados ao longo da vida do processo,
filtramos pelos templates conhecidos de instauração/despacho, cadastrados em
`listaSEIDespachos` (mesma lista usada em `despachos_sei.py`, campo
`descricaoDOC`): só aceitamos um andamento de assinatura cuja descrição
contenha um desses templates como substring — mesma lógica do fluxo original.
"""
from __future__ import annotations

import logging
from datetime import date

from app.integrations.graph.client import GraphClient
from app.integrations.sei.client import SeiClient
from app.services.despachos_sei import LISTA_SEI_DESPACHOS_ID

logger = logging.getLogger(__name__)


def _descricoes_conhecidas(graph: GraphClient, site_id: str) -> set[str]:
    """Valores distintos de descricaoDOC cadastrados em listaSEIDespachos."""
    descricoes: set[str] = set()
    try:
        for campos in graph.iter_itens(site_id, LISTA_SEI_DESPACHOS_ID, page_size=200):
            desc = campos.get("descricaoDOC")
            if desc:
                descricoes.add(str(desc))
    except Exception:  # noqa: BLE001
        logger.exception("Falha ao listar descricaoDOC de listaSEIDespachos")
    return descricoes


def _converter_data_sei(data_str: str) -> date | None:
    """Converte 'dd/mm/yyyy' (formato do SEI) para date. None se inválido."""
    try:
        dia, mes, ano = data_str.strip().split("/")
        return date(int(ano), int(mes), int(dia))
    except Exception:  # noqa: BLE001
        return None


def buscar_data_instauracao(
    sei: SeiClient,
    graph: GraphClient,
    site_id: str,
    id_procedimento: str,
    id_unidade: str,
) -> date | None:
    """Procura a data de assinatura de um documento de despacho conhecido.

    Retorna None se não encontrar (ex.: nenhum documento foi assinado ainda,
    ou nenhum dos templates conhecidos corresponde). Nunca levanta exceção —
    falhas de rede/API são logadas e tratadas como "não encontrado", já que
    esta função é usada tanto como gatilho best-effort (tela) quanto em
    automação agendada (fallback).
    """
    descricoes = _descricoes_conhecidas(graph, site_id)
    if not descricoes:
        return None

    try:
        resp = sei.listar_andamentos(
            id_procedimento, id_unidade, tipo_historico="Z", tarefas="5", start=0, limit=90,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Falha ao listar andamentos (tarefa=5) do procedimento %s", id_procedimento)
        return None

    andamentos = resp.get("Andamentos", [])
    # A API do SEI retorna do andamento mais recente para o mais antigo, então
    # o primeiro match já é a assinatura mais recente que bate com um template
    # conhecido — suficiente para a data de instauração (que só é gravada uma
    # única vez, segundo o comportamento do fluxo original).
    for andamento in andamentos:
        descricao = andamento.get("descricao", "")
        if "(" in descricao and ")" in descricao and any(d in descricao for d in descricoes):
            data_str = andamento.get("data")
            if data_str:
                convertida = _converter_data_sei(data_str)
                if convertida:
                    return convertida
    return None
