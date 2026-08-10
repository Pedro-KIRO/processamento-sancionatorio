"""Testes da tela de textos-padrão (consulta e edição pelo coordenador).

Três coisas precisam valer aqui:

1. **Só coordenador entra.** O texto editado vale para o app inteiro e termina
   assinado num processo administrativo.
2. **A marca de padrão é exclusiva** dentro de (agente, função) e muda a ordem
   que o resto do app usa para escolher o modelo.
3. **A edição sobrevive à reimportação** dos textos-padrão do SEI, e dá para
   voltar ao original.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.db.base import Base
from app.main import app
from app.services.catalogo_fases import listar_modelos

HTML_A = '<p class="Texto_Justificado">Modelo A, sem irregularidade.</p>'
HTML_B = '<p class="Texto_Justificado">Modelo B, regularizado.</p>'
HTML_OUTRO = '<p class="Texto_Justificado">Saneador com defesa.</p>'


@pytest.fixture()
def cliente():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as s:
        a = m.ConfigTemplateDespacho(
            agente_regulado="Perito",
            descricao_doc="arquivamento_relatorio|Despacho 47 - Sem irregular",
            template_html=HTML_A,
            html_original=HTML_A,
            nome_arvore="Despacho",
        )
        b = m.ConfigTemplateDespacho(
            agente_regulado="Perito",
            descricao_doc="arquivamento_relatorio|Despacho 49 - Regularizado",
            template_html=HTML_B,
            html_original=HTML_B,
            nome_arvore="Despacho",
        )
        outro = m.ConfigTemplateDespacho(
            agente_regulado="Autoescola",
            descricao_doc="saneador|Despacho 83 - COM DEFESA",
            template_html=HTML_OUTRO,
            html_original=HTML_OUTRO,
            nome_arvore="Despacho saneador",
        )
        s.add_all([a, b, outro])
        s.commit()
        ids = {"a": a.id, "b": b.id, "outro": outro.id}

    def _get_db():
        with Session() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
        email="coord@detran.sp.gov.br", nome="Coordenador",
    )
    yield TestClient(app, base_url="http://testserver/api"), ids, Session
    app.dependency_overrides.clear()


class TestListagem:
    def test_lista_sem_o_html_para_nao_trafegar_texto_grande(self, cliente):
        client, _ids, _S = cliente
        dados = client.get("/textos-padroes").json()

        assert len(dados) == 3
        assert "template_html" not in dados[0]

    def test_traz_funcao_legivel_e_rotulo_separados(self, cliente):
        client, _ids, _S = cliente
        dados = client.get(
            "/textos-padroes", params={"funcao": "arquivamento_relatorio"}
        ).json()

        assert len(dados) == 2
        assert dados[0]["funcao"] == "arquivamento_relatorio"
        assert dados[0]["funcao_titulo"] == "Arquivamento do Relatório"
        assert dados[0]["rotulo"] == "Despacho 47 - Sem irregular"

    def test_filtra_por_agente(self, cliente):
        client, _ids, _S = cliente
        dados = client.get("/textos-padroes", params={"agente": "Autoescola"}).json()

        assert [d["agente_regulado"] for d in dados] == ["Autoescola"]

    def test_busca_por_trecho_do_rotulo(self, cliente):
        client, _ids, _S = cliente
        dados = client.get("/textos-padroes", params={"busca": "regulariz"}).json()

        assert len(dados) == 1
        assert dados[0]["rotulo"] == "Despacho 49 - Regularizado"

    def test_agentes_e_funcoes_para_os_filtros(self, cliente):
        client, _ids, _S = cliente

        assert client.get("/textos-padroes/agentes").json() == ["Autoescola", "Perito"]

        funcoes = client.get("/textos-padroes/funcoes").json()
        assert {f["funcao"]: f["quantidade"] for f in funcoes} == {
            "arquivamento_relatorio": 2,
            "saneador": 1,
        }

    def test_obter_traz_o_texto_e_o_original(self, cliente):
        client, ids, _S = cliente
        dados = client.get(f"/textos-padroes/{ids['a']}").json()

        assert dados["template_html"] == HTML_A
        assert dados["html_original"] == HTML_A
        assert dados["editado"] is False

    def test_id_inexistente_da_404(self, cliente):
        client, _ids, _S = cliente

        assert client.get("/textos-padroes/999999").status_code == 404


class TestEdicao:
    def test_salvar_marca_quem_editou(self, cliente):
        client, ids, _S = cliente
        novo = HTML_A + "<p>Parágrafo acrescentado pela coordenação.</p>"

        dados = client.put(
            f"/textos-padroes/{ids['a']}", json={"template_html": novo}
        ).json()

        assert dados["template_html"] == novo
        assert dados["editado"] is True
        assert dados["editado_por"] == "coord@detran.sp.gov.br"
        assert dados["editado_em"] is not None
        # O original fica intacto, para comparar e restaurar.
        assert dados["html_original"] == HTML_A
        assert dados["divergente_do_original"] is True

    def test_texto_vazio_e_recusado(self, cliente):
        """Modelo vazio geraria documento em branco no processo do agente."""
        client, ids, _S = cliente

        assert (
            client.put(
                f"/textos-padroes/{ids['a']}", json={"template_html": "   "}
            ).status_code
            == 422
        )

    def test_restaurar_volta_ao_original_e_libera_a_reimportacao(self, cliente):
        client, ids, _S = cliente
        client.put(f"/textos-padroes/{ids['a']}", json={"template_html": "<p>X</p>"})

        dados = client.post(f"/textos-padroes/{ids['a']}/restaurar").json()

        assert dados["template_html"] == HTML_A
        assert dados["editado"] is False
        assert dados["editado_em"] is None
        assert dados["divergente_do_original"] is False

    def test_restaurar_sem_original_guardado_da_conflito(self, cliente):
        client, ids, Session = cliente
        with Session() as s:
            s.get(m.ConfigTemplateDespacho, ids["a"]).html_original = None
            s.commit()

        resposta = client.post(f"/textos-padroes/{ids['a']}/restaurar")

        assert resposta.status_code == 409

    def test_primeira_edicao_guarda_o_original_quando_estava_vazio(self, cliente):
        """Registros importados antes das colunas novas podem não ter original."""
        client, ids, Session = cliente
        with Session() as s:
            s.get(m.ConfigTemplateDespacho, ids["a"]).html_original = None
            s.commit()

        dados = client.put(
            f"/textos-padroes/{ids['a']}", json={"template_html": "<p>Novo</p>"}
        ).json()

        assert dados["html_original"] == HTML_A


class TestPadrao:
    def test_marcar_padrao_desmarca_o_irmao(self, cliente):
        client, ids, _S = cliente
        client.post(f"/textos-padroes/{ids['a']}/padrao")

        irmas = client.post(f"/textos-padroes/{ids['b']}/padrao").json()

        assert {i["id"]: i["padrao"] for i in irmas} == {
            ids["a"]: False,
            ids["b"]: True,
        }

    def test_padrao_nao_afeta_outra_funcao_ou_agente(self, cliente):
        client, ids, _S = cliente
        client.post(f"/textos-padroes/{ids['a']}/padrao")

        outro = client.get(f"/textos-padroes/{ids['outro']}").json()

        assert outro["padrao"] is False

    def test_padrao_muda_a_ordem_que_o_app_usa_para_escolher(self, cliente):
        """É por essa ordem que a escolha do coordenador vale no app inteiro."""
        client, ids, Session = cliente
        client.post(f"/textos-padroes/{ids['b']}/padrao")

        with Session() as s:
            ordem = listar_modelos(s, "arquivamento_relatorio", "Perito")

        # Sem marca, "Despacho 47" viria antes de "Despacho 49" (alfabética).
        assert [r.id for r in ordem] == [ids["b"], ids["a"]]

    def test_remover_padrao(self, cliente):
        client, ids, _S = cliente
        client.post(f"/textos-padroes/{ids['a']}/padrao")

        dados = client.delete(f"/textos-padroes/{ids['a']}/padrao").json()

        assert dados["padrao"] is False


class TestAcesso:
    """Sem perfil de coordenação, nem ler nem escrever."""

    @pytest.fixture()
    def cliente_analista(self, cliente, monkeypatch):
        client, ids, _S = cliente
        monkeypatch.setattr("app.core.security.AUTH_ENABLED", True)
        app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
            email="analista@detran.sp.gov.br", nome="Analista", roles=[],
        )
        return client, ids

    def test_analista_nao_lista(self, cliente_analista):
        client, _ids = cliente_analista

        assert client.get("/textos-padroes").status_code == 403

    def test_analista_nao_edita(self, cliente_analista):
        client, ids = cliente_analista

        resposta = client.put(
            f"/textos-padroes/{ids['a']}", json={"template_html": "<p>X</p>"}
        )

        assert resposta.status_code == 403

    def test_analista_nao_define_padrao(self, cliente_analista):
        client, ids = cliente_analista

        assert client.post(f"/textos-padroes/{ids['a']}/padrao").status_code == 403

    def test_role_do_entra_libera(self, cliente, monkeypatch):
        client, _ids, _S = cliente
        monkeypatch.setattr("app.core.security.AUTH_ENABLED", True)
        app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
            email="chefe@detran.sp.gov.br", roles=["coordenador"],
        )

        assert client.get("/textos-padroes").status_code == 200

    def test_lista_do_env_libera(self, cliente, monkeypatch):
        client, _ids, _S = cliente
        monkeypatch.setattr("app.core.security.AUTH_ENABLED", True)
        monkeypatch.setenv("COORDENADORES", "outro@x.gov.br, Chefe@Detran.SP.gov.BR")
        app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
            email="chefe@detran.sp.gov.br", roles=[],
        )

        assert client.get("/textos-padroes").status_code == 200

    def test_perfil_na_tabela_usuario_libera(self, cliente, monkeypatch):
        client, _ids, Session = cliente
        with Session() as s:
            s.add(
                m.Usuario(
                    email="chefe@detran.sp.gov.br",
                    nome="Chefe",
                    perfil="coordenador",
                    ativo=True,
                )
            )
            s.commit()
        monkeypatch.setattr("app.core.security.AUTH_ENABLED", True)
        app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
            email="chefe@detran.sp.gov.br", roles=[],
        )

        assert client.get("/textos-padroes").status_code == 200

    def test_me_informa_o_perfil_para_o_menu(self, cliente):
        client, _ids, _S = cliente

        assert client.get("/me").json()["coordenador"] is True
