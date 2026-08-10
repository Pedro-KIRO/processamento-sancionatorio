"""Painel de recurso e Decisão II (Documentação de Negócio v3.0).

Cobre o registro de interposição (Sim/Não), a abertura dos prazos do trâmite
recursal, a obrigatoriedade do parecer da Consultoria Jurídica antes da Decisão
II e o retorno do processo a uma fase específica.
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core import security
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.db.base import Base
from app.main import app


@pytest.fixture()
def sessao():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(engine)
    Sessao = sessionmaker(bind=engine, future=True)

    with Sessao() as s:
        item = m.CaixaEntrada(
            numero_sei="140.00100000/2026-01", numero_processo_sei="140.00900001/2026-01",
            razao_social="Autoescola Recorrente", agente_regulado="Autoescola",
            cnpj_cpf="11.111.111/0001-11", status_triagem="instaurado",
        )
        s.add(item)
        s.flush()
        # Processo na fase de recurso, como fica após a Decisão I.
        s.add(m.FaseProcessoAndamento(caixa_entrada_id=item.id, fase="recurso", autor="Sistema"))
        s.commit()
        item_id = item.id

    def _override():
        db = Sessao()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
        email="dev@local", nome="Teste", roles=[])

    yield Sessao, item_id

    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture()
def client(sessao):
    return TestClient(app, base_url="http://testserver/api")


class TestPainel:
    def test_comeca_vazio(self, client, sessao):
        _, item_id = sessao
        dados = client.get(f"/processos-andamento/{item_id}/recurso").json()
        assert dados["existe"] is False
        assert dados["interposto"] is None

    def test_oferece_as_fases_de_retorno_sem_o_proprio_recurso(self, client, sessao):
        _, item_id = sessao
        fases = client.get(f"/processos-andamento/{item_id}/recurso").json()["fases_disponiveis"]
        assert "recurso" not in fases
        assert "encerrado" not in fases
        assert "aguardando_defesa" in fases


class TestInterposicao:
    def test_sim_abre_os_tres_prazos_do_tramite(self, client, sessao):
        Sessao, item_id = sessao
        resp = client.post(
            f"/processos-andamento/{item_id}/recurso/interposicao",
            json={"interposto": True, "data_interposicao": "2026-08-03"},
        )
        assert resp.status_code == 200
        assert resp.json()["interposto"] is True

        with Sessao() as s:
            prazos = s.scalars(
                select(m.PrazoProcesso).where(m.PrazoProcesso.fase == "recurso")
            ).all()
            assert sorted(p.dias for p in prazos) == [7, 30, 120]

    def test_prazos_aparecem_no_painel_com_semaforo(self, client, sessao):
        _, item_id = sessao
        client.post(
            f"/processos-andamento/{item_id}/recurso/interposicao",
            json={"interposto": True},
        )
        prazos = client.get(f"/processos-andamento/{item_id}/recurso").json()["prazos"]
        chaves = {p["chave"] for p in prazos}
        assert chaves == {"reconsideracao", "julgamento_recurso", "maximo_recurso"}
        assert all(p["semaforo"] in ("verde", "amarelo", "vermelho") for p in prazos)

    def test_nao_registra_transito_administrativo(self, client, sessao):
        Sessao, item_id = sessao
        resp = client.post(
            f"/processos-andamento/{item_id}/recurso/interposicao",
            json={"interposto": False},
        )
        assert resp.json()["interposto"] is False
        with Sessao() as s:
            tipos = [e.tipo for e in s.scalars(select(m.EventoProcesso)).all()]
            assert "transito_administrativo" in tipos
            # Sem recurso não há prazo do trâmite recursal.
            assert s.scalars(
                select(m.PrazoProcesso).where(m.PrazoProcesso.fase == "recurso")
            ).all() == []

    def test_nao_duplica_prazos_ao_registrar_de_novo(self, client, sessao):
        Sessao, item_id = sessao
        for _ in range(2):
            client.post(
                f"/processos-andamento/{item_id}/recurso/interposicao",
                json={"interposto": True},
            )
        with Sessao() as s:
            prazos = s.scalars(
                select(m.PrazoProcesso).where(m.PrazoProcesso.fase == "recurso")
            ).all()
            assert len(prazos) == 3


class TestParecerJuridico:
    def test_exige_recurso_interposto(self, client, sessao):
        _, item_id = sessao
        resp = client.post(
            f"/processos-andamento/{item_id}/recurso/parecer",
            json={"numero_sei": "0123456", "resumo": "Pelo desprovimento."},
        )
        assert resp.status_code == 409

    def test_registra_parecer(self, client, sessao):
        _, item_id = sessao
        client.post(
            f"/processos-andamento/{item_id}/recurso/interposicao", json={"interposto": True}
        )
        resp = client.post(
            f"/processos-andamento/{item_id}/recurso/parecer",
            json={"numero_sei": "0123456", "resumo": "Pelo desprovimento."},
        )
        assert resp.status_code == 200
        dados = resp.json()
        assert dados["parecer_numero_sei"] == "0123456"
        assert dados["parecer_em"] is not None

    def test_negado_para_analista(self, client, sessao, monkeypatch):
        _, item_id = sessao
        client.post(
            f"/processos-andamento/{item_id}/recurso/interposicao", json={"interposto": True}
        )
        monkeypatch.setattr(security, "AUTH_ENABLED", True)
        app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
            email="analista@detran.sp.gov.br", nome="Analista", roles=[])
        try:
            resp = client.post(
                f"/processos-andamento/{item_id}/recurso/parecer", json={"resumo": "x"}
            )
            assert resp.status_code == 403
        finally:
            app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
                email="dev@local", nome="Teste", roles=[])

    def test_consultoria_juridica_pode_registrar(self, client, sessao, monkeypatch):
        _, item_id = sessao
        client.post(
            f"/processos-andamento/{item_id}/recurso/interposicao", json={"interposto": True}
        )
        monkeypatch.setattr(security, "AUTH_ENABLED", True)
        app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
            email="cj@detran.sp.gov.br", nome="CJ", roles=["CPSAR.ConsultoriaJuridica"])
        try:
            resp = client.post(
                f"/processos-andamento/{item_id}/recurso/parecer", json={"resumo": "Parecer."}
            )
            assert resp.status_code == 200
        finally:
            app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
                email="dev@local", nome="Teste", roles=[])


class TestDecisaoII:
    def _preparar(self, client, item_id, com_parecer=True):
        client.post(
            f"/processos-andamento/{item_id}/recurso/interposicao", json={"interposto": True}
        )
        if com_parecer:
            client.post(
                f"/processos-andamento/{item_id}/recurso/parecer",
                json={"numero_sei": "0123456", "resumo": "Pelo desprovimento."},
            )

    def test_exige_parecer_juridico(self, client, sessao):
        """O documento diz que a Decisão II considera o parecer obrigatoriamente."""
        _, item_id = sessao
        self._preparar(client, item_id, com_parecer=False)
        resp = client.post(
            f"/processos-andamento/{item_id}/recurso/decisao-ii",
            json={"resultado": "mantida"},
        )
        assert resp.status_code == 409
        assert "parecer" in resp.json()["detail"].lower()

    def test_manter_a_decisao_um(self, client, sessao):
        _, item_id = sessao
        self._preparar(client, item_id)
        resp = client.post(
            f"/processos-andamento/{item_id}/recurso/decisao-ii",
            json={"resultado": "mantida", "fundamentacao": "Recurso desprovido."},
        )
        assert resp.status_code == 200
        assert resp.json()["decisao_resultado"] == "mantida"

    def test_resultado_invalido(self, client, sessao):
        _, item_id = sessao
        self._preparar(client, item_id)
        resp = client.post(
            f"/processos-andamento/{item_id}/recurso/decisao-ii",
            json={"resultado": "anulada"},
        )
        assert resp.status_code == 422

    def test_retorno_de_fase_exige_a_fase(self, client, sessao):
        _, item_id = sessao
        self._preparar(client, item_id)
        resp = client.post(
            f"/processos-andamento/{item_id}/recurso/decisao-ii",
            json={"resultado": "retorno_fase"},
        )
        assert resp.status_code == 422

    def test_retorno_de_fase_recusa_fase_invalida(self, client, sessao):
        _, item_id = sessao
        self._preparar(client, item_id)
        resp = client.post(
            f"/processos-andamento/{item_id}/recurso/decisao-ii",
            json={"resultado": "retorno_fase", "fase_retorno": "encerrado"},
        )
        assert resp.status_code == 422

    def test_retorno_de_fase_reabre_o_processo_no_ponto_indicado(self, client, sessao):
        Sessao, item_id = sessao
        self._preparar(client, item_id)
        resp = client.post(
            f"/processos-andamento/{item_id}/recurso/decisao-ii",
            json={
                "resultado": "retorno_fase",
                "fase_retorno": "instrucao",
                "fundamentacao": "Prova nova exige reabertura da instrução.",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["decisao_fase_retorno"] == "instrucao"

        with Sessao() as s:
            fases = s.scalars(
                select(m.FaseProcessoAndamento)
                .where(m.FaseProcessoAndamento.caixa_entrada_id == item_id)
                .order_by(m.FaseProcessoAndamento.id)
            ).all()
            # A fase de recurso foi fechada e a nova é a indicada na decisão.
            assert fases[0].fase == "recurso"
            assert fases[0].data_saida is not None
            assert fases[-1].fase == "instrucao"
            assert fases[-1].data_saida is None

    def test_decisao_encerra_os_prazos_do_recurso(self, client, sessao):
        Sessao, item_id = sessao
        self._preparar(client, item_id)
        client.post(
            f"/processos-andamento/{item_id}/recurso/decisao-ii",
            json={"resultado": "reformada"},
        )
        with Sessao() as s:
            prazos = s.scalars(
                select(m.PrazoProcesso).where(m.PrazoProcesso.fase == "recurso")
            ).all()
            assert all(p.status == "respondido" for p in prazos)
            assert all(p.data_resposta == date.today() for p in prazos)

    def test_gera_notificacao(self, client, sessao):
        Sessao, item_id = sessao
        self._preparar(client, item_id)
        client.post(
            f"/processos-andamento/{item_id}/recurso/decisao-ii",
            json={"resultado": "mantida"},
        )
        with Sessao() as s:
            notificacoes = s.scalars(select(m.Notificacao)).all()
            assert any(n.tipo == "decisao_ii" for n in notificacoes)

    def test_negado_para_quem_nao_e_coordenacao(self, client, sessao, monkeypatch):
        _, item_id = sessao
        self._preparar(client, item_id)
        monkeypatch.setattr(security, "AUTH_ENABLED", True)
        app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
            email="chefe@detran.sp.gov.br", nome="Chefe", roles=["CPSAR.ChefeServico"])
        try:
            resp = client.post(
                f"/processos-andamento/{item_id}/recurso/decisao-ii",
                json={"resultado": "mantida"},
            )
            assert resp.status_code == 403
        finally:
            app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
                email="dev@local", nome="Teste", roles=[])

    def test_novo_recurso_depois_de_retorno_de_fase(self, client, sessao):
        """Retorno de fase reabre o rito, então pode haver um segundo recurso."""
        Sessao, item_id = sessao
        self._preparar(client, item_id)
        client.post(
            f"/processos-andamento/{item_id}/recurso/decisao-ii",
            json={"resultado": "retorno_fase", "fase_retorno": "instrucao"},
        )
        # Novo recurso nasce em registro próprio, sem apagar o histórico.
        client.post(
            f"/processos-andamento/{item_id}/recurso/interposicao", json={"interposto": True}
        )
        with Sessao() as s:
            registros = s.scalars(select(m.RecursoProcesso)).all()
            assert len(registros) == 2
        atual = client.get(f"/processos-andamento/{item_id}/recurso").json()
        assert atual["decisao_resultado"] is None
