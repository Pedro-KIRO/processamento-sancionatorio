"""Testes da apuração de apontamentos (não conformidades) do checklist.

A regra central: a coluna ``Conformidade`` da lista_perguntas diz **qual
resposta caracteriza conformidade** para aquela pergunta. Há apontamento quando
a resposta do fiscal difere dela.

Isso importa porque as perguntas são escritas nos dois sentidos — "O local está
aberto?" espera "Sim", "Foi constatado manuseio por terceiro?" espera "Não".
Uma regra do tipo "Conformidade = Sim significa irregular" daria resultado
errado para metade do checklist.
"""
import pytest

from app.services import conformidade_relatorio as conf


class GraphFalso:
    """Imita GraphClient para as duas chamadas usadas pelo serviço."""

    def __init__(self, perguntas, respostas):
        self._perguntas = perguntas
        self._respostas = respostas
        self.chamadas_perguntas = 0

    def iter_itens(self, site_id, list_id, page_size=200):
        self.chamadas_perguntas += 1
        for p in self._perguntas:
            yield p

    def get_list_items_filtered(self, site_id, list_id, filtro, top=300):
        return [{"fields": r} for r in self._respostas]


# id → pergunta. Note os valores "sujos" que o SharePoint devolve de verdade:
# espaço sobrando em 'Sim ' e ids como float.
PERGUNTAS = [
    {"id": "1", "TextoPergunta": "O local está aberto?", "Conformidade": "Sim"},
    {"id": "2", "TextoPergunta": "Foi constatado manuseio por terceiro?", "Conformidade": "Não"},
    {"id": "3", "TextoPergunta": "Termo de Acompanhamento?", "Conformidade": "Sim "},
    {"id": "4", "TextoPergunta": "Houve irregularidades nos laudos?", "Conformidade": "Não",
     "Enquadramento": "Art. 22, IV"},
    {"id": "5", "TextoPergunta": "Conclusão", "Conformidade": ""},
    {"id": "6", "TextoPergunta": "Observações livres", "Conformidade": ""},
    # Valores reais que aparecem na coluna Conformidade e não são julgáveis
    {"id": "7", "TextoPergunta": "O estabelecimento possui CNPJ?", "Conformidade": "N/A"},
    {"id": "8", "TextoPergunta": "Houve recusa na assinatura do Termo?",
     "Conformidade": "Não se aplica"},
    {"id": "9", "TextoPergunta": "Uso indevido de identidade visual?",
     "Conformidade": "Notificação para regularização"},
    # Variantes em caixa alta, também presentes nos dados reais
    {"id": "10", "TextoPergunta": "O perito estava presente?", "Conformidade": "SIM"},
    {"id": "11", "TextoPergunta": "Havia peças destinadas à desmontagem?", "Conformidade": "NÃO"},
]


@pytest.fixture(autouse=True)
def _limpar_cache():
    conf.resetar_cache()
    yield
    conf.resetar_cache()


def _apurar(respostas, perguntas=PERGUNTAS):
    graph = GraphFalso(perguntas, respostas)
    return conf.apurar("REL-1", graph=graph, site_id="site"), graph


def test_relatorio_totalmente_conforme():
    resultado, _ = _apurar([
        {"IDPergunta": 1.0, "Resposta": "Sim"},
        {"IDPergunta": 2.0, "Resposta": "Não"},
        {"IDPergunta": 3.0, "Resposta": "Sim"},
    ])
    assert resultado.avaliadas == 3
    assert resultado.total_apontamentos == 0
    assert resultado.em_conformidade is True
    assert resultado.apontamentos == []


def test_pergunta_que_espera_sim_gera_apontamento_quando_responde_nao():
    resultado, _ = _apurar([{"IDPergunta": 1.0, "Resposta": "Não"}])
    assert resultado.total_apontamentos == 1
    assert resultado.em_conformidade is False
    assert resultado.apontamentos[0].pergunta == "O local está aberto?"
    assert resultado.apontamentos[0].resposta_esperada == "Sim"
    assert resultado.apontamentos[0].resposta_dada == "Não"


def test_pergunta_que_espera_nao_gera_apontamento_quando_responde_sim():
    """Caso que uma regra ingênua ('Conformidade=Sim é irregular') erraria."""
    resultado, _ = _apurar([{"IDPergunta": 2.0, "Resposta": "Sim"}])
    assert resultado.total_apontamentos == 1
    assert resultado.apontamentos[0].resposta_esperada == "Não"


def test_comparacao_ignora_espaco_sobrando_e_acento():
    """'Sim ' (com espaço) no cadastro deve casar com 'Sim' respondido."""
    resultado, _ = _apurar([
        {"IDPergunta": 3.0, "Resposta": "Sim"},   # cadastro tem 'Sim '
        {"IDPergunta": 2.0, "Resposta": "NAO"},   # sem acento e maiúsculo
    ])
    assert resultado.total_apontamentos == 0
    assert resultado.avaliadas == 2


def test_conclusao_nao_conta_como_item_avaliado():
    resultado, _ = _apurar([
        {"IDPergunta": 1.0, "Resposta": "Sim"},
        {"IDPergunta": 5.0, "Resposta": "Estabelecimento com pendências."},
    ])
    assert resultado.avaliadas == 1
    assert resultado.conclusao == "Estabelecimento com pendências."


def test_pergunta_sem_conformidade_definida_nao_e_avaliada():
    resultado, _ = _apurar([
        {"IDPergunta": 1.0, "Resposta": "Sim"},
        {"IDPergunta": 6.0, "Resposta": "qualquer coisa"},
    ])
    assert resultado.avaliadas == 1
    assert resultado.sem_regra == 1
    assert resultado.total_apontamentos == 0


def test_apontamento_carrega_o_enquadramento_legal():
    resultado, _ = _apurar([{"IDPergunta": 4.0, "Resposta": "Sim"}])
    assert resultado.apontamentos[0].enquadramento == "Art. 22, IV"


def test_resposta_de_pergunta_desconhecida_e_ignorada():
    resultado, _ = _apurar([{"IDPergunta": 999.0, "Resposta": "Sim"}])
    assert resultado.avaliadas == 0
    assert resultado.total_apontamentos == 0


def test_sem_id_relatorio_nao_consulta_nada():
    graph = GraphFalso(PERGUNTAS, [])
    resultado = conf.apurar(None, graph=graph, site_id="s")
    assert resultado.avaliadas == 0
    assert graph.chamadas_perguntas == 0


def test_checklist_ainda_nao_preenchido():
    """Sem respostas, o relatório não é considerado conforme nem irregular."""
    resultado, _ = _apurar([])
    assert resultado.avaliadas == 0
    assert resultado.total_apontamentos == 0


def test_banco_de_perguntas_e_carregado_uma_vez():
    graph = GraphFalso(PERGUNTAS, [{"IDPergunta": 1.0, "Resposta": "Sim"}])
    conf.apurar("REL-1", graph=graph, site_id="s")
    conf.apurar("REL-2", graph=graph, site_id="s")
    assert graph.chamadas_perguntas == 1


def test_falha_no_sharepoint_nao_propaga():
    class GraphQuebrado:
        def get_list_items_filtered(self, *a, **k):
            raise RuntimeError("SharePoint fora")

        def iter_itens(self, *a, **k):
            raise RuntimeError("SharePoint fora")

    resultado = conf.apurar("REL-1", graph=GraphQuebrado(), site_id="s")
    assert resultado.avaliadas == 0
    assert resultado.total_apontamentos == 0


# ─── "Não se aplica" fica fora da apuração ───────────────────────────────────

@pytest.mark.parametrize("conformidade_id", ["7", "8", "9"])
def test_pergunta_nao_aplicavel_fica_fora_da_conta(conformidade_id):
    """Conformidade 'N/A', 'Não se aplica' ou 'Notificação para regularização'
    não define um critério julgável — o item não conta nem como conforme nem
    como apontamento."""
    resultado, _ = _apurar([
        {"IDPergunta": float(conformidade_id), "Resposta": "Sim"},
    ])
    assert resultado.avaliadas == 0
    assert resultado.total_apontamentos == 0
    assert resultado.nao_aplicaveis == 1


@pytest.mark.parametrize("resposta", ["Não se aplica", "N/A", "NÃO SE APLICA", "n/a"])
def test_resposta_nao_aplicavel_fica_fora_da_conta(resposta):
    """Se o fiscal respondeu 'não se aplica', o item não é avaliado — mesmo que
    a pergunta tenha resposta esperada definida."""
    resultado, _ = _apurar([{"IDPergunta": 1.0, "Resposta": resposta}])
    assert resultado.avaliadas == 0
    assert resultado.total_apontamentos == 0
    assert resultado.nao_aplicaveis == 1


def test_nao_aplicaveis_nao_contaminam_o_total():
    """Mistura de itens: só os julgáveis entram em avaliadas/apontamentos."""
    resultado, _ = _apurar([
        {"IDPergunta": 1.0, "Resposta": "Sim"},              # conforme
        {"IDPergunta": 2.0, "Resposta": "Sim"},              # apontamento
        {"IDPergunta": 7.0, "Resposta": "Sim"},              # pergunta N/A
        {"IDPergunta": 3.0, "Resposta": "Não se aplica"},    # resposta N/A
        {"IDPergunta": 5.0, "Resposta": "Texto da conclusão."},
        {"IDPergunta": 6.0, "Resposta": "observação"},       # sem regra
    ])
    assert resultado.avaliadas == 2
    assert resultado.total_apontamentos == 1
    assert resultado.nao_aplicaveis == 2
    assert resultado.sem_regra == 1
    assert resultado.conclusao == "Texto da conclusão."


def test_conformidade_em_caixa_alta_e_tratada_igual():
    """Os dados reais têm 'SIM' e 'NÃO' em caixa alta além de 'Sim'/'Não'."""
    resultado, _ = _apurar([
        {"IDPergunta": 10.0, "Resposta": "Sim"},   # Conformidade 'SIM' → conforme
        {"IDPergunta": 11.0, "Resposta": "Sim"},   # Conformidade 'NÃO' → apontamento
    ])
    assert resultado.avaliadas == 2
    assert resultado.total_apontamentos == 1
    assert resultado.apontamentos[0].pergunta == "Havia peças destinadas à desmontagem?"
