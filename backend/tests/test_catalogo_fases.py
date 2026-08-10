"""Testes do catálogo de documentos por fase.

Cobre o que a área definiu: quais documentos cada fase produz, em que ordem, e
quando a fase pode avançar. Também protege as séries do SEI — usar a série
errada faz o documento aparecer com o rótulo errado na árvore do processo, o que
já aconteceu (todo documento saía como "Termo de encerramento").

Cada passo aponta para uma **função** (``saneador``, ``decisao``...), e as
variantes vêm do banco, porque os modelos oficiais têm uma versão por motivo:
quatro saneadores de autoescola, nove arquivamentos de relatório de perito.
"""
import pytest

from app.services import series_sei as series
from app.services.catalogo_fases import (
    FASES_DE_ESPERA,
    FASES_DOCUMENTAIS,
    SERIE_POR_FUNCAO,
    avanco_da_fase,
    passo_pendente,
)


class TestSequenciaDeFases:
    def test_saneador_e_o_documento_da_defesa_apresentada(self):
        passo, ultimo, indice, total = passo_pendente("defesa_apresentada", set())

        assert passo is not None
        assert passo.funcao == "saneador"
        assert (indice, total, ultimo) == (0, 1, True)
        assert avanco_da_fase("defesa_apresentada") == "instrucao"

    def test_intimacao_abre_prazo_de_sete_dias(self):
        passo, _, _, _ = passo_pendente("instrucao", set())

        assert passo is not None
        assert passo.funcao == "intimacao_alegacoes"
        assert passo.dias_prazo == 7
        assert avanco_da_fase("instrucao") == "aguardando_alegacoes"

    def test_julgamento_tem_tres_passos_na_ordem_definida(self):
        funcoes = [p.funcao for p in FASES_DOCUMENTAIS["julgamento"].passos]

        assert funcoes == ["manifestacao_cj", "relatorio_opinativo", "decisao"]

    def test_fase_so_avanca_depois_do_ultimo_documento(self):
        gerados = {"manifestacao_cj", "relatorio_opinativo|Relatório Opinativo"}

        passo, ultimo, indice, total = passo_pendente("julgamento", gerados)

        assert passo is not None and passo.funcao == "decisao"
        assert (indice, total) == (2, 3)
        assert ultimo is True

    def test_sem_documento_pendente_a_fase_esta_completa(self):
        gerados = {
            "termo_encerramento|Termo de encerramento",
            "arquivamento_processo|Despacho 75 - Arquivamento PA",
        }

        passo, _, indice, total = passo_pendente("encerramento", gerados)

        assert passo is None
        assert indice == total == 2

    def test_fases_de_espera_nao_produzem_documento(self):
        for fase in FASES_DE_ESPERA:
            passo, _, _, total = passo_pendente(fase, set())

            assert passo is None
            assert total == 0

    def test_recurso_nao_avanca_sozinho(self):
        # A fase espera o prazo de recurso correr; quem move é a automação.
        assert avanco_da_fase("recurso") is None


class TestVariantesDoPasso:
    """Qualquer variante da função cumpre o passo."""

    def test_variante_escolhida_cumpre_o_passo(self):
        # Quem gerou o "Despacho 135 - BAIXA CADASTRAL" não precisa dos outros
        # oito arquivamentos.
        gerados = {
            "manifestacao_cj",
            "relatorio_opinativo|Relatório Opinativo - Baixa Cadastral",
            "decisao|Decisão 2524 I - ARQUIVAMENTO",
        }

        passo, _, _, _ = passo_pendente("julgamento", gerados)

        assert passo is None

    def test_aceita_qualquer_chave_da_propria_funcao(self):
        passo, _, _, _ = passo_pendente("defesa_apresentada", set())

        assert passo is not None
        # Sem banco, a validação é pelo prefixo da função.
        assert passo.aceita("saneador|Despacho 82 - SANEADOR - COM DEFESA") is True
        assert passo.aceita(None) is True
        assert passo.aceita("decisao|Decisão 2500") is False

    def test_sem_banco_nao_ha_opcoes_a_oferecer(self):
        passo, _, _, _ = passo_pendente("defesa_apresentada", set())

        assert passo is not None
        assert passo.opcoes() == []


class TestSeriesDoSei:
    def test_termo_de_encerramento_nao_e_despacho(self):
        # A confusão original: 2403 foi usada como se fosse Despacho.
        assert series.TERMO_ENCERRAMENTO == "2403"
        assert series.DESPACHO == "1172"
        assert series.DESPACHO != series.TERMO_ENCERRAMENTO

    def test_opinativo_entra_como_relatorio_e_saneador_como_despacho(self):
        assert SERIE_POR_FUNCAO["relatorio_opinativo"] == series.RELATORIO
        assert SERIE_POR_FUNCAO["saneador"] == series.DESPACHO

    def test_serie_vem_da_funcao_e_nao_da_variante(self):
        passo, _, _, _ = passo_pendente("defesa_apresentada", set())

        assert passo is not None
        # As quatro versões do saneador são todas despacho.
        assert passo.id_serie() == series.DESPACHO
        assert passo.id_serie("saneador|Despacho 82 - SANEADOR - COM DEFESA") == series.DESPACHO

    @pytest.mark.parametrize("fase", sorted(FASES_DOCUMENTAIS))
    def test_toda_funcao_de_todo_passo_tem_serie(self, fase):
        for passo in FASES_DOCUMENTAIS[fase].passos:
            assert passo.funcao in SERIE_POR_FUNCAO, f"{fase}/{passo.funcao} sem série definida"


class TestPassoDeAnexo:
    def test_manifestacao_da_cj_e_anexo_sem_assinatura(self):
        passo, _, _, _ = passo_pendente("julgamento", set())

        assert passo is not None
        assert passo.funcao == "manifestacao_cj"
        assert passo.tipo == "anexo"
        # Documento externo não vai a bloco de assinatura.
        assert passo.cargos_assinatura == ()
        assert passo.id_serie() == series.ANEXO

    def test_os_demais_passos_sao_gerados_de_modelo(self):
        for fase, config in FASES_DOCUMENTAIS.items():
            for passo in config.passos:
                if passo.funcao == "manifestacao_cj":
                    continue
                assert passo.tipo == "documento", f"{fase}/{passo.funcao}"
