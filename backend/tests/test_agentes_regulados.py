"""Testes da consolidação dos nomes de agente regulado.

Os nomes vêm do app de fiscalização detalhados por credenciamento; aqui viram a
classe do agente, que é o que define unidade, tipo de procedimento e modelo de
documento no processamento.
"""
import pytest

from app.services.agentes_regulados import (
    AUTOESCOLA,
    DESMONTE,
    DESPACHANTE,
    ECV,
    ESTAMPADORA,
    PERITO,
    normalizar,
    subclasse,
)


@pytest.mark.parametrize("nome", [
    "Centros de formação de condutores – CFC A",
    "Centros de formação de condutores – CFC AB",
    "Centros de formação de condutores – CFC B",
    "Autoescola",
])
def test_centros_de_formacao_viram_autoescola(nome):
    assert normalizar(nome) == AUTOESCOLA


@pytest.mark.parametrize("nome", [
    "Clínica de Medicina do Tráfego",
    "Clínica de Psicologia do Trânsito",
    "Clínica de Medicina do Tráfego e Psicologia do Trânsito",
    "Médicos",
    "Psicólogos",
    "Poupatempo",
    "Peritos",
])
def test_clinicas_medicos_psicologos_e_poupatempo_viram_perito(nome):
    assert normalizar(nome) == PERITO


@pytest.mark.parametrize("nome", [
    "Desmontes Fiscalização",
    "Desmontes Credenciamento",
    "Desmanche Clandestino",
    "Comércio de Peças",
])
def test_desmanches_e_comercio_viram_desmonte(nome):
    assert normalizar(nome) == DESMONTE


@pytest.mark.parametrize("nome", [
    "Empresas credenciadas de vistoria – Presencial",
    "Empresas credenciadas de vistoria – Remota",
    "ECV",
])
def test_vistoria_vira_ecv(nome):
    assert normalizar(nome) == ECV


@pytest.mark.parametrize("nome", [
    "Empresas estampadoras de placas – PIV",
    "EPIV",
])
def test_estampadoras_e_epiv_viram_estampadora(nome):
    assert normalizar(nome) == ESTAMPADORA


def test_despachantes_vira_despachante():
    assert normalizar("Despachantes") == DESPACHANTE


@pytest.mark.parametrize("nome", [
    "Pátios",
    "Renave",
    "Médicos e psicólogos",
    "Instituições de ensino",
])
def test_classes_fora_do_app_sao_descartadas(nome):
    assert normalizar(nome) is None


def test_medicos_e_psicologos_nao_se_confunde_com_medicos():
    # O cadastro antigo "Médicos e psicólogos" sai do app; "Médicos" e
    # "Psicólogos", separados, são Perito.
    assert normalizar("Médicos e psicólogos") is None
    assert normalizar("Médicos") == PERITO
    assert normalizar("Psicólogos") == PERITO


@pytest.mark.parametrize("valor", [None, "", "   "])
def test_vazio_e_descartado(valor):
    assert normalizar(valor) is None


def test_nome_desconhecido_e_preservado():
    # Preservar em vez de descartar: o registro continua visível e o nome
    # estranho no filtro sinaliza que falta uma regra.
    assert normalizar("Categoria Nova XYZ") == "Categoria Nova XYZ"


class TestSubclasseDePerito:
    """O SEI exige tipo de procedimento distinto para clínica, médico e psicólogo.

    Confirmado em GET /processos/tipos: existem 100002002 (Clínica), 100002001
    (Médico) e 100002006 (Psicólogo), e nenhum tipo único de "Perito". Sem a
    subclasse não é possível instaurar processo de perito com o tipo correto.
    """

    @pytest.mark.parametrize("nome", [
        "Clínica de Medicina do Tráfego",
        "Clínica de Psicologia do Trânsito",
        "Clínica de Medicina do Tráfego e Psicologia do Trânsito",
    ])
    def test_clinica_tem_precedencia_sobre_medicina_e_psicologia(self, nome):
        # O nome da clínica contém "medicina"/"psicologia"; sem a precedência,
        # cairia como Médico ou Psicólogo.
        assert subclasse(nome) == "Clínica"

    def test_medico_e_psicologo(self):
        assert subclasse("Médicos") == "Médico"
        assert subclasse("Psicólogos") == "Psicólogo"

    @pytest.mark.parametrize("nome", [
        "Autoescola", "Despachantes", "Empresas credenciadas de vistoria – Remota",
        "Desmontes Fiscalização", "Empresas estampadoras de placas – PIV",
    ])
    def test_classes_sem_subclasse(self, nome):
        assert subclasse(nome) is None

    def test_poupatempo_e_perito_mas_sem_subclasse_definida(self):
        # Poupatempo entra como Perito por decisão da área, mas não é clínica,
        # médico nem psicólogo — a instauração precisa perguntar qual usar.
        assert normalizar("Poupatempo") == PERITO
        assert subclasse("Poupatempo") is None

    def test_agente_vazio(self):
        assert subclasse(None) is None
        assert subclasse("") is None
