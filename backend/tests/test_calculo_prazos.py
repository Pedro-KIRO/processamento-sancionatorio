"""Contagem de prazos da Lei 10.177/1998 e matriz consolidada.

A regra tem consequência jurídica: um vencimento antecipado gera certidão de
decurso antes de o prazo ter terminado de verdade, e um atrasado dá dia extra
que a lei não concede. Por isso cada parte da regra tem teste próprio.
"""
from datetime import date

import pytest

from app.services import calculo_prazos as cp


class TestExcluiDiaInicial:
    """Art. 25: exclui-se o dia inicial e inclui-se o dia final."""

    def test_prazo_de_15_dias_iniciado_numa_segunda(self):
        # 03/08/2026 é segunda. Dia 1 é 04/08; dia 15 é 18/08 (terça, útil).
        assert cp.calcular_vencimento(date(2026, 8, 3), 15, feriados=set()) == date(2026, 8, 18)

    def test_prazo_de_7_dias(self):
        # 03/08 + 7 = 10/08, segunda-feira útil: não prorroga.
        assert cp.calcular_vencimento(date(2026, 8, 3), 7, feriados=set()) == date(2026, 8, 10)

    def test_nao_conta_o_proprio_dia_de_inicio(self):
        # Se contasse o dia inicial, 1 dia a partir de 03/08 venceria em 03/08.
        assert cp.calcular_vencimento(date(2026, 8, 3), 1, feriados=set()) == date(2026, 8, 4)


class TestProrrogacaoParaDiaUtil:
    """Vencimento em dia sem expediente vai para o primeiro dia útil seguinte."""

    def test_vencimento_em_domingo_vai_para_segunda(self):
        # 01/08/2026 (sábado) + 15 = 16/08, um domingo.
        assert cp.calcular_vencimento(date(2026, 8, 1), 15, feriados=set()) == date(2026, 8, 17)

    def test_vencimento_em_sabado_vai_para_segunda(self):
        # 31/07/2026 (sexta) + 7 = 07/08 (sexta). Usando 01/08 (sáb) + 7 = 08/08 (sáb).
        assert cp.calcular_vencimento(date(2026, 8, 1), 7, feriados=set()) == date(2026, 8, 10)

    def test_vencimento_em_feriado_cadastrado_vai_para_o_dia_seguinte(self):
        assert cp.calcular_vencimento(
            date(2026, 8, 3), 7, feriados={date(2026, 8, 10)}
        ) == date(2026, 8, 11)

    def test_feriado_seguido_de_fim_de_semana_pula_o_bloco_inteiro(self):
        # Vencimento natural 07/08 (sexta) feriado → sábado e domingo também não
        # têm expediente → cai na segunda, 10/08.
        assert cp.calcular_vencimento(
            date(2026, 7, 31), 7, feriados={date(2026, 8, 7)}
        ) == date(2026, 8, 10)


class TestPrazosContinuos:
    """Fins de semana e feriados no meio da contagem contam normalmente."""

    def test_feriado_no_meio_nao_estende_o_prazo(self):
        sem_feriado = cp.calcular_vencimento(date(2026, 8, 3), 15, feriados=set())
        com_feriado_no_meio = cp.calcular_vencimento(
            date(2026, 8, 3), 15, feriados={date(2026, 8, 10)}
        )
        assert sem_feriado == com_feriado_no_meio


class TestDiaUtil:
    def test_sabado_e_domingo_nao_sao_uteis(self):
        assert not cp.e_dia_util(date(2026, 8, 1))  # sábado
        assert not cp.e_dia_util(date(2026, 8, 2))  # domingo

    def test_dia_de_semana_e_util(self):
        assert cp.e_dia_util(date(2026, 8, 3))

    def test_feriado_cadastrado_nao_e_util(self):
        assert not cp.e_dia_util(date(2026, 8, 3), {date(2026, 8, 3)})


class TestSemaforo:
    """Verde ≥4 dias; amarelo do vencimento até 3 dias antes; vermelho vencido."""

    @pytest.mark.parametrize("dias", [4, 5, 10, 120])
    def test_verde_com_quatro_dias_ou_mais(self, dias):
        assert cp.semaforo(dias) == cp.VERDE

    @pytest.mark.parametrize("dias", [0, 1, 2, 3])
    def test_amarelo_no_vencimento_e_ate_tres_dias_antes(self, dias):
        assert cp.semaforo(dias) == cp.AMARELO

    @pytest.mark.parametrize("dias", [-1, -15])
    def test_vermelho_depois_do_vencimento(self, dias):
        assert cp.semaforo(dias) == cp.VERMELHO

    def test_sem_vencimento_nao_tem_cor(self):
        assert cp.semaforo(None) is None


class TestDiasRestantes:
    def test_conta_a_partir_de_hoje(self):
        assert cp.dias_restantes(date(2026, 8, 10), hoje=date(2026, 8, 5)) == 5

    def test_negativo_quando_vencido(self):
        assert cp.dias_restantes(date(2026, 8, 1), hoje=date(2026, 8, 5)) == -4

    def test_zero_no_dia_do_vencimento(self):
        assert cp.dias_restantes(date(2026, 8, 5), hoje=date(2026, 8, 5)) == 0


class TestMatrizDePrazos:
    def test_tem_os_doze_tipos_do_documento(self):
        assert len(cp.MATRIZ_PRAZOS) == 12

    def test_duracoes_conforme_a_lei(self):
        esperado = {
            "defesa_previa": 15,
            "defesa_previa_edital": 15,
            "manifestacao_documentos": 7,
            "quesitos_assistente": 7,
            "alegacoes_finais": 7,
            "decisao_instrucao": 20,
            "recurso": 15,
            "reconsideracao": 7,
            "julgamento_recurso": 30,
            "maximo_recurso": 120,
            "sem_movimentacao": 15,
            "encerramento_sem_conclusao": 2,
        }
        assert {t.chave: t.dias for t in cp.MATRIZ_PRAZOS} == esperado

    def test_toda_entrada_tem_base_legal_e_gatilho(self):
        for tipo in cp.MATRIZ_PRAZOS:
            assert tipo.base_legal, tipo.chave
            assert tipo.gatilho, tipo.chave
            assert tipo.no_vencimento, tipo.chave

    def test_prazos_da_cautelar(self):
        assert cp.PRAZOS_CAUTELAR == (30, 45, 60, 90)

    def test_rotulo_pela_fase(self):
        assert cp.rotulo_do_prazo("aguardando_defesa", 15) == "Defesa prévia"
        assert cp.rotulo_do_prazo("aguardando_alegacoes", 7) == "Alegações finais"

    def test_rotulo_desempata_pela_duracao_quando_a_fase_serve_a_mais_de_um_tipo(self):
        # Fase de recurso tem recurso (15), reconsideração (7), julgamento (30)
        # e prazo máximo (120).
        assert cp.rotulo_do_prazo("recurso", 30) == "Julgamento do recurso"
        assert cp.rotulo_do_prazo("recurso", 120) == "Prazo máximo de decisão do recurso"

    def test_fase_desconhecida_nao_quebra(self):
        assert cp.rotulo_do_prazo("fase_que_nao_existe") == "Fase que nao existe"
        assert cp.rotulo_do_prazo(None) == "Prazo"
