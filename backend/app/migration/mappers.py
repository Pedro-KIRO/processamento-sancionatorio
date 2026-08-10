"""Mapeadores: campos das listas do SharePoint -> modelos do banco.

Apenas o mapeamento da Caixa de Entrada está implementado como exemplo
completo. Os demais entram conforme confirmarmos os campos das listas.
"""
from datetime import date, datetime
from typing import Any

from app.db import models as m


def parse_date(valor: Any) -> date | None:
    """Converte datas do Graph (ISO 8601) para date; tolera vazio/inválido."""
    if not valor:
        return None
    try:
        return datetime.fromisoformat(str(valor).replace("Z", "+00:00")).date()
    except ValueError:
        return None


def map_caixa_entrada(f: dict) -> m.CaixaEntrada:
    return m.CaixaEntrada(
        id_relatorio=f.get("ID_Relatorio"),
        numero_sei=f.get("numeroSEI"),
        razao_social=f.get("razaoSocial"),
        agente_regulado=f.get("agenteRegulado"),
        tipo_documento=f.get("tipoDocumento"),
        cnpj_cpf=f.get("CNPJ_x002f_CPF") or f.get("CNPJ_CPF"),
        data_recebimento=parse_date(f.get("dataRecebimento")),
        data_remetido=parse_date(f.get("dataRemetido")),
    )


# chave CLI -> (displayName da lista no SharePoint, modelo, função de mapeamento)
MAPEAMENTOS = {
    "caixa": ("listaCaixaDeEntrada", m.CaixaEntrada, map_caixa_entrada),
}
