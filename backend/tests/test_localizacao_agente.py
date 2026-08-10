"""Testes da resolução de município → superintendência (listaMunicipios).

A lista real vive no SharePoint (site DGR) e usa nomes de coluna internos
(``field_1``..``field_4``), com o município repetido em duas grafias: sem acento
(chave de busca) e com acento (para exibir). Aqui usamos um Graph falso para
exercitar essa forma sem depender de rede.
"""
import pytest

from app.services import localizacao_agente as loc


class GraphFalso:
    """Devolve itens no mesmo formato que ``GraphClient.iter_itens``."""

    def __init__(self, itens):
        self._itens = itens
        self.chamadas = 0

    def iter_itens(self, site_id, list_id, page_size=200):
        self.chamadas += 1
        for i in self._itens:
            yield i


ITENS = [
    # field_1 = cidade sem acento (chave), field_2 = super sem acento,
    # field_3 = municipio com acento, field_4 = super com acento
    {"field_1": "Aracatuba", "field_2": "Aracatuba", "field_3": "Araçatuba", "field_4": "Araçatuba"},
    {"field_1": "Rubineia", "field_2": "Fernandopolis", "field_3": "Rubinéia", "field_4": "Fernandópolis"},
    {"field_1": "Ribeirao Bonito", "field_2": "Araraquara", "field_3": "Ribeirão Bonito", "field_4": "Araraquara"},
    {"field_1": "Sao Paulo", "field_2": "Sao Paulo", "field_3": "São Paulo", "field_4": "São Paulo"},
]


@pytest.fixture(autouse=True)
def _limpar_cache():
    loc.resetar_cache()
    yield
    loc.resetar_cache()


@pytest.mark.parametrize(
    "entrada,esperado",
    [
        ("Araçatuba", "aracatuba"),
        ("ARAÇATUBA", "aracatuba"),
        ("  Ribeirão   Bonito ", "ribeirao bonito"),
        ("São Paulo", "sao paulo"),
        ("Embu-Guaçu", "embu guacu"),
        (None, ""),
        ("", ""),
    ],
)
def test_normalizar_remove_acento_caixa_e_pontuacao(entrada, esperado):
    assert loc.normalizar(entrada) == esperado


def test_resolver_devolve_versoes_acentuadas():
    graph = GraphFalso(ITENS)
    municipio, super_ = loc.resolver("Rubineia", graph=graph, site_id="site-x")
    assert municipio == "Rubinéia"
    assert super_ == "Fernandópolis"


def test_resolver_casa_independente_de_acento_e_caixa():
    """A cidade vem da listaDesignacao, cuja grafia pode divergir da listaMunicipios."""
    graph = GraphFalso(ITENS)
    assert loc.resolver("ARAÇATUBA", graph=graph, site_id="s")[0] == "Araçatuba"
    assert loc.resolver("ribeirao bonito", graph=graph, site_id="s")[0] == "Ribeirão Bonito"
    assert loc.resolver("sao paulo", graph=graph, site_id="s")[1] == "São Paulo"


def test_resolver_cidade_desconhecida_devolve_none():
    graph = GraphFalso(ITENS)
    assert loc.resolver("Cidade Inexistente", graph=graph, site_id="s") == (None, None)


def test_resolver_cidade_vazia_nao_consulta_o_graph():
    graph = GraphFalso(ITENS)
    assert loc.resolver("", graph=graph, site_id="s") == (None, None)
    assert loc.resolver(None, graph=graph, site_id="s") == (None, None)
    assert graph.chamadas == 0


def test_mapa_e_carregado_uma_unica_vez():
    """A lista quase não muda; recarregar a cada consulta seria desperdício."""
    graph = GraphFalso(ITENS)
    loc.resolver("Rubineia", graph=graph, site_id="s")
    loc.resolver("Aracatuba", graph=graph, site_id="s")
    loc.resolver("Sao Paulo", graph=graph, site_id="s")
    assert graph.chamadas == 1


def test_falha_no_graph_nao_propaga_e_permite_nova_tentativa():
    """Se o SharePoint falhar, resolver devolve None sem quebrar o fluxo — e a
    falha não é cacheada, então a próxima chamada tenta de novo."""

    class GraphQuebrado:
        def __init__(self):
            self.tentativas = 0

        def iter_itens(self, *a, **k):
            self.tentativas += 1
            raise RuntimeError("SharePoint indisponível")

    graph = GraphQuebrado()
    assert loc.resolver("Rubineia", graph=graph, site_id="s") == (None, None)
    assert loc.resolver("Rubineia", graph=graph, site_id="s") == (None, None)
    assert graph.tentativas == 2


def test_usa_campo_sem_acento_quando_o_acentuado_esta_vazio():
    """Nem toda linha da lista tem as colunas acentuadas preenchidas."""
    graph = GraphFalso([{"field_1": "Bauru", "field_2": "Bauru", "field_3": "", "field_4": ""}])
    municipio, super_ = loc.resolver("Bauru", graph=graph, site_id="s")
    assert municipio == "Bauru"
    assert super_ == "Bauru"
