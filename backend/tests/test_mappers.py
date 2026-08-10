"""Testes dos mapeadores de migração."""
from datetime import date

from app.migration.mappers import map_caixa_entrada, parse_date


def test_parse_date():
    assert parse_date("2026-01-10T00:00:00Z") == date(2026, 1, 10)
    assert parse_date("") is None
    assert parse_date(None) is None
    assert parse_date("xpto") is None


def test_map_caixa_entrada():
    f = {
        "ID_Relatorio": "R-1",
        "numeroSEI": "0001123456202600",
        "razaoSocial": "CFC Exemplo",
        "agenteRegulado": "Autoescola",
        "tipoDocumento": "Relatorio de Fiscalizacao",
        "CNPJ_x002f_CPF": "12345678000199",
        "dataRecebimento": "2026-01-10T00:00:00Z",
    }
    obj = map_caixa_entrada(f)
    assert obj.numero_sei == "0001123456202600"
    assert obj.razao_social == "CFC Exemplo"
    assert obj.cnpj_cpf == "12345678000199"
    assert obj.data_recebimento == date(2026, 1, 10)
    assert obj.status_triagem is None or obj.status_triagem == "pendente"
