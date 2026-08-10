"""Testes das rotas de Processos em Andamento (/processos-andamento).

Cobre: filtro por status (arquivado/tac/instaurado), busca/agente/data,
escolha do id_procedimento correto (novo vs. original) para listar/baixar
documentos, e o gatilho best-effort de data de instauração no GET de detalhe.
Toda chamada ao SEI/Graph é substituída por mocks via monkeypatch.
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.api.routes import processos_andamento as rotas_pa
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.db.base import Base
from app.main import app


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, future=True)

    with TestSession() as s:
        pendente = m.CaixaEntrada(
            numero_sei="140.00100000/2026-01", cnpj_cpf="11.111.111/0001-11",
            razao_social="Ainda na Caixa", agente_regulado="Autoescola",
            data_recebimento=date(2026, 1, 5), status_triagem="pendente",
        )
        instaurado = m.CaixaEntrada(
            numero_sei="140.00286276/2026-27", id_procedimento="111111",
            cnpj_cpf="12.345.678/0001-99", razao_social="Auto Escola Modelo",
            agente_regulado="Autoescola", data_recebimento=date(2026, 1, 10),
            status_triagem="instaurado", numero_processo_sei="140.00999999/2026-01",
            id_procedimento_processo="999999",
        )
        tac = m.CaixaEntrada(
            numero_sei="140.00299001/2026-08", id_procedimento="222222",
            cnpj_cpf="98.765.432/0001-10", razao_social="Vistorias SP",
            agente_regulado="ECV", data_recebimento=date(2026, 1, 15),
            status_triagem="tac",
        )
        arquivado = m.CaixaEntrada(
            numero_sei="140.00300002/2026-09", id_procedimento="333333",
            cnpj_cpf="55.555.555/0001-55", razao_social="Peritos SP",
            agente_regulado="Peritos", data_recebimento=date(2026, 1, 20),
            status_triagem="arquivado",
        )
        s.add_all([pendente, instaurado, tac, arquivado])
        s.commit()
        ids = {
            "pendente": pendente.id, "instaurado": instaurado.id,
            "tac": tac.id, "arquivado": arquivado.id,
        }

    def _override():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
        email="teste@local", nome="Teste", roles=[])

    yield TestSession, ids

    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture()
def client(db_session, monkeypatch):
    monkeypatch.setattr(rotas_pa, "_sei_client", lambda: object())
    monkeypatch.setattr(rotas_pa, "_graph_cpsar", lambda: (object(), "site-id"))
    monkeypatch.setattr(rotas_pa, "_id_unidade", lambda: "110053117")
    return TestClient(app, base_url="http://testserver/api")


def test_listar_so_retorna_status_em_andamento(client, db_session):
    _, ids = db_session
    resp = client.get("/processos-andamento")
    assert resp.status_code == 200
    numeros_sei = {d["numero_sei"] for d in resp.json()}
    assert numeros_sei == {
        "140.00286276/2026-27", "140.00299001/2026-08", "140.00300002/2026-09",
    }


def test_listar_filtra_por_agente(client):
    resp = client.get("/processos-andamento", params={"agente": "ECV"})
    assert resp.status_code == 200
    itens = resp.json()
    assert len(itens) == 1
    assert itens[0]["numero_sei"] == "140.00299001/2026-08"


def test_listar_filtra_por_busca_no_numero_do_processo_novo(client):
    # A busca deve encontrar tanto pelo numero_sei original quanto pelo
    # numero_processo_sei (o processo NOVO criado na Instauração).
    resp = client.get("/processos-andamento", params={"busca": "00999999"})
    assert resp.status_code == 200
    itens = resp.json()
    assert len(itens) == 1
    assert itens[0]["status_triagem"] == "instaurado"


def test_obter_item_pendente_retorna_404(client, db_session):
    _, ids = db_session
    resp = client.get(f"/processos-andamento/{ids['pendente']}")
    assert resp.status_code == 404


def test_obter_item_instaurado_agenda_busca_de_data_instauracao(client, db_session, monkeypatch):
    """A busca da data de instauração é agendada, não executada no request.

    Ela consulta SharePoint + SEI (segundos), então roda em background para não
    atrasar a abertura da tela. A rota responde na hora, ainda sem a data.
    """
    _, ids = db_session
    agendados = []
    monkeypatch.setattr(
        rotas_pa, "_agendar_busca_data_instauracao",
        lambda item_id, id_procedimento_processo: agendados.append((item_id, id_procedimento_processo)),
    )

    resp = client.get(f"/processos-andamento/{ids['instaurado']}")

    assert resp.status_code == 200
    assert resp.json()["data_instauracao"] is None
    assert agendados == [(ids["instaurado"], "999999")]


def test_obter_item_ja_com_data_nao_agenda_busca(client, db_session, monkeypatch):
    """Se a data já está no banco, não faz sentido consultar o SEI de novo."""
    TestSession, ids = db_session
    with TestSession() as s:
        item = s.get(m.CaixaEntrada, ids["instaurado"])
        item.data_instauracao = date(2026, 2, 1)
        s.commit()

    agendados = []
    monkeypatch.setattr(
        rotas_pa, "_agendar_busca_data_instauracao",
        lambda *a, **k: agendados.append(a),
    )

    resp = client.get(f"/processos-andamento/{ids['instaurado']}")

    assert resp.status_code == 200
    assert resp.json()["data_instauracao"] == "2026-02-01"
    assert agendados == []


def test_obter_item_instaurado_falha_de_rede_e_silenciosa(client, db_session, monkeypatch):
    """Qualquer exceção ao consultar SEI/Graph não deve quebrar a rota."""
    _, ids = db_session

    def _levanta(*a, **k):
        raise RuntimeError("SEI indisponível")
    monkeypatch.setattr(rotas_pa, "buscar_data_instauracao", _levanta)

    resp = client.get(f"/processos-andamento/{ids['instaurado']}")

    assert resp.status_code == 200
    assert resp.json()["data_instauracao"] is None


def test_documentos_do_instaurado_usa_id_procedimento_do_processo_novo(client, db_session, monkeypatch):
    _, ids = db_session
    chamadas = []

    def _stub(id_procedimento, sei=None, id_unidade_hint=None, db=None):
        chamadas.append(id_procedimento)
        return []
    monkeypatch.setattr(rotas_pa, "listar_documentos_por_procedimento", _stub)

    resp = client.get(f"/processos-andamento/{ids['instaurado']}/documentos")

    assert resp.status_code == 200
    assert chamadas == ["999999"]  # id_procedimento_processo, não o original


def test_documentos_do_tac_usa_id_procedimento_original(client, db_session, monkeypatch):
    _, ids = db_session
    chamadas = []

    def _stub(id_procedimento, sei=None, id_unidade_hint=None, db=None):
        chamadas.append(id_procedimento)
        return []
    monkeypatch.setattr(rotas_pa, "listar_documentos_por_procedimento", _stub)

    resp = client.get(f"/processos-andamento/{ids['tac']}/documentos")

    assert resp.status_code == 200
    assert chamadas == ["222222"]  # id_procedimento original (mesmo processo)


def test_conteudo_documento_delega_para_helper_compartilhado(client, db_session, monkeypatch):
    _, ids = db_session
    monkeypatch.setattr(
        rotas_pa, "obter_conteudo_documento_por_numero",
        lambda numero_doc, tipo_doc=None, sei=None, id_unidade_hint=None, db=None: {"numero": numero_doc, "nome": "X", "tipo": "interno", "conteudo": "abc"},
    )

    resp = client.get(f"/processos-andamento/{ids['instaurado']}/documentos/12345/conteudo")

    assert resp.status_code == 200
    assert resp.json() == {"numero": "12345", "nome": "X", "tipo": "interno", "conteudo": "abc"}


def test_documentos_de_item_inexistente_retorna_404(client):
    resp = client.get("/processos-andamento/999999/documentos")
    assert resp.status_code == 404
