"""Testes de app/api/routes/documentos.py (funções puras, sem servidor HTTP).

Cobre o bug real encontrado em produção: a API do SEI responde HTTP 500
("Unidade [...] não possui acesso ao documento [...]") quando a unidade
consultada não é a que gerou o documento — não é uma instabilidade real,
mas o SeiClient classifica 500 como erro temporário. Sem o fallback entre
unidades, cada documento sofria 3 tentativas com backoff exponencial antes
de desistir, e com vários documentos isso demorava dezenas de segundos
(parecia travado) na tela de Processos em Andamento.
"""
from unittest.mock import MagicMock

import pytest

from app.api.routes.documentos import (
    UNIDADES_CONSULTA,
    _consultar_documento_em_unidades,
    listar_documentos_por_procedimento,
    obter_conteudo_documento_por_numero,
)
from app.integrations.sei.client import SeiApiError


def _erro_sem_acesso(unidade: str) -> SeiApiError:
    return SeiApiError(
        f"Unidade [{unidade}] não possui acesso ao documento.", status_code=500,
    )


def test_consultar_documento_em_unidades_tenta_ate_achar_a_correta():
    sei = MagicMock()
    unidade_certa = UNIDADES_CONSULTA[2]

    def _consultar(numero_doc, id_unidade, tentar_novamente=True):
        assert tentar_novamente is False  # não deve repetir por unidade
        if id_unidade != unidade_certa:
            raise _erro_sem_acesso(id_unidade)
        return {"nomeArvore": "Documento Achado"}

    sei.consultar_documento.side_effect = _consultar

    meta, id_unidade = _consultar_documento_em_unidades(sei, "0001")

    assert meta["nomeArvore"] == "Documento Achado"
    assert id_unidade == unidade_certa
    # Parou de tentar assim que achou (não testou as unidades restantes).
    assert sei.consultar_documento.call_count == 3


def test_consultar_documento_em_unidades_levanta_erro_se_nenhuma_unidade_tem_acesso():
    sei = MagicMock()

    def _consultar(numero_doc, id_unidade, tentar_novamente=True):
        raise _erro_sem_acesso(id_unidade)

    sei.consultar_documento.side_effect = _consultar

    with pytest.raises(SeiApiError):
        _consultar_documento_em_unidades(sei, "0001")

    assert sei.consultar_documento.call_count == len(UNIDADES_CONSULTA)


def test_listar_documentos_usa_nome_extraido_da_descricao():
    """A listagem agora usa o nome extraído da descrição do andamento (rápido,
    sem chamadas extras à API de documentos). Não consulta metadados."""
    sei = MagicMock()

    sei.listar_andamentos.return_value = {
        "Andamentos": [
            {
                "idTarefa": "2",
                "descricao": "Gerado documento público 0113098567 (E-mail)",
                "dataHora": "02/07/2026 11:57:12",
                "atributoAndamento": [{"nome": "DOCUMENTO", "valor": "0113098567"}],
            },
        ],
    }

    docs = listar_documentos_por_procedimento("129229494", sei=sei)

    assert len(docs) == 1
    assert docs[0].numero == "0113098567"
    assert docs[0].nome == "E-mail"  # extraído da descrição, sem consultar API
    assert docs[0].tipo == "interno"
    # Nenhuma chamada extra a consultar_documento na listagem
    sei.consultar_documento.assert_not_called()


def test_listar_documentos_mantem_nome_da_descricao_se_nenhuma_unidade_tiver_acesso():
    """Se nenhuma unidade configurada tiver acesso ao documento, a listagem
    não deve falhar — mantém o nome extraído da descrição do andamento."""
    sei = MagicMock()
    sei.listar_andamentos.return_value = {
        "Andamentos": [
            {
                "idTarefa": "2",
                "descricao": "Gerado documento público 0113098567 (E-mail)",
                "dataHora": "02/07/2026 11:57:12",
                "atributoAndamento": [{"nome": "DOCUMENTO", "valor": "0113098567"}],
            },
        ],
    }
    def _consultar(numero_doc, id_unidade, tentar_novamente=True):
        raise _erro_sem_acesso(id_unidade)

    sei.consultar_documento.side_effect = _consultar

    docs = listar_documentos_por_procedimento("129229494", sei=sei)

    assert len(docs) == 1
    assert docs[0].nome == "E-mail"  # extraído da descrição, sem quebrar


def test_listar_documentos_remove_documentos_excluidos():
    sei = MagicMock()
    sei.listar_andamentos.return_value = {
        "Andamentos": [
            {
                "idTarefa": "33",
                "descricao": "Excluído documento 0001 (Ofício)",
                "atributoAndamento": [{"nome": "DOCUMENTO", "valor": "0001"}],
            },
            {
                "idTarefa": "2",
                "descricao": "Gerado documento público 0001 (Ofício)",
                "dataHora": "01/01/2026 10:00:00",
                "atributoAndamento": [{"nome": "DOCUMENTO", "valor": "0001"}],
            },
        ],
    }
    sei.consultar_documento.return_value = {"nomeArvore": "Ofício"}

    docs = listar_documentos_por_procedimento("129229494", sei=sei)

    assert docs == []


def test_obter_conteudo_documento_usa_unidade_que_teve_acesso():
    sei = MagicMock()
    unidade_certa = UNIDADES_CONSULTA[1]

    def _consultar(numero_doc, id_unidade, tentar_novamente=True):
        if id_unidade != unidade_certa:
            raise _erro_sem_acesso(id_unidade)
        return {"tipo": "I", "nomeArvore": "Documento X"}

    sei.consultar_documento.side_effect = _consultar
    sei.download_conteudo.return_value = {"conteudo": "YWJj"}

    resultado = obter_conteudo_documento_por_numero("0001", sei=sei)

    assert resultado["nome"] == "Documento X"
    assert resultado["tipo"] == "interno"
    sei.download_conteudo.assert_called_once_with("0001", unidade_certa)
