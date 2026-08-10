"""Testes das rotas de despachos SEI (Arquivar, TAC, Instaurar).

Cobre o contrato HTTP: 503 para erros temporários, 502 para definitivos
(com numero_sei_criado quando aplicável), e o registro em HistoricoDespacho.
Toda chamada real ao SEI/Graph é substituída por mocks via monkeypatch.
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.api.routes import despachos as rotas_despachos
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.db.base import Base
from app.main import app
from app.services import despachos_sei as svc


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, future=True)

    with TestSession() as s:
        item = m.CaixaEntrada(
            numero_sei="140.00286276/2026-27", cnpj_cpf="12.345.678/0001-99",
            razao_social="Auto Escola Modelo", agente_regulado="Autoescola",
            segmento="Educacao", data_recebimento=date(2026, 1, 10),
        )
        s.add(item)
        s.commit()
        item_id = item.id

    def _override():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
        email="teste@local", nome="Teste", roles=[])

    yield TestSession, item_id

    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture()
def client(db_session, monkeypatch):
    # As rotas chamam _sei_client()/_graph_cpsar() diretamente (não são
    # dependências do FastAPI) — substituímos por stubs simples via monkeypatch.
    monkeypatch.setattr(rotas_despachos, "_sei_client", lambda: object())
    monkeypatch.setattr(rotas_despachos, "_graph_cpsar", lambda: (object(), "site-id"))
    monkeypatch.setattr(rotas_despachos, "_id_unidade", lambda: "110053117")
    return TestClient(app, base_url="http://testserver/api")


def test_arquivar_sucesso_retorna_200_e_grava_historico(client, db_session, monkeypatch):
    TestSession, item_id = db_session
    resultado = svc.ResultadoAcaoSei(
        numero_sei="140.00286276/2026-27", id_procedimento="123456",
        id_documento="9", documento_formatado="0009999", avisos=[],
    )
    monkeypatch.setattr(svc, "executar_arquivar", lambda *a, **k: resultado)

    resp = client.post(f"/caixa-entrada/{item_id}/despachos/arquivar", json={"html": "<p>final</p>"})

    assert resp.status_code == 200
    corpo = resp.json()
    assert corpo["numero_sei"] == "140.00286276/2026-27"
    assert corpo["avisos"] == []

    with TestSession() as s:
        item = s.get(m.CaixaEntrada, item_id)
        assert item.status_triagem == "arquivado"
        historico = s.scalars(select(m.HistoricoDespacho)).all()
        assert len(historico) == 1
        assert historico[0].status == "sucesso"
        assert historico[0].tipo == "arquivar"


def test_arquivar_com_erro_temporario_retorna_503(client, db_session, monkeypatch):
    TestSession, item_id = db_session

    def _levanta(*a, **k):
        raise svc.DespachoSeiError("SEI fora do ar", temporario=True, etapa="consultar_processo")

    monkeypatch.setattr(svc, "executar_arquivar", _levanta)

    resp = client.post(f"/caixa-entrada/{item_id}/despachos/arquivar", json={"html": "<p>final</p>"})

    assert resp.status_code == 503
    detalhe = resp.json()["detail"]
    assert detalhe["temporario"] is True
    assert detalhe["numero_sei_criado"] is None

    with TestSession() as s:
        historico = s.scalars(select(m.HistoricoDespacho)).all()
        assert len(historico) == 1
        assert historico[0].status == "erro_temporario"


def test_instaurar_com_erro_definitivo_e_processo_ja_criado_retorna_502_com_numero(
    client, db_session, monkeypatch,
):
    TestSession, item_id = db_session

    def _levanta(*a, **k):
        raise svc.DespachoSeiError(
            "Processo já criado, mas falhou ao incluir documento",
            temporario=False, numero_sei_criado="140.00999999/2026-01",
            id_procedimento_criado="999999", etapa="incluir_documento",
        )

    monkeypatch.setattr(svc, "executar_instaurar", _levanta)

    resp = client.post(f"/caixa-entrada/{item_id}/despachos/instaurar", json={"html": "<p>termo</p>", "cautelar": False})

    assert resp.status_code == 502
    detalhe = resp.json()["detail"]
    assert detalhe["temporario"] is False
    assert detalhe["numero_sei_criado"] == "140.00999999/2026-01"
    assert detalhe["id_procedimento_criado"] == "999999"

    with TestSession() as s:
        historico = s.scalars(select(m.HistoricoDespacho)).all()
        assert len(historico) == 1
        assert historico[0].status == "erro_definitivo"
        assert historico[0].numero_sei_resultado == "140.00999999/2026-01"


def test_tac_com_avisos_de_sucesso_parcial_aparece_no_corpo(client, db_session, monkeypatch):
    TestSession, item_id = db_session
    resultado = svc.ResultadoAcaoSei(
        numero_sei="140.00286276/2026-27", id_procedimento="123456",
        id_documento="9", documento_formatado="0009999",
        avisos=["Não foi possível incluir no bloco de assinatura."],
    )
    monkeypatch.setattr(svc, "executar_tac", lambda *a, **k: resultado)

    resp = client.post(f"/caixa-entrada/{item_id}/despachos/tac", json={"html": "<p>final</p>"})

    assert resp.status_code == 200
    assert resp.json()["avisos"] == ["Não foi possível incluir no bloco de assinatura."]

    with TestSession() as s:
        historico = s.scalars(select(m.HistoricoDespacho)).all()
        assert historico[0].avisos == "Não foi possível incluir no bloco de assinatura."


def test_listar_historico_retorna_tentativas_em_ordem_decrescente(client, db_session, monkeypatch):
    TestSession, item_id = db_session
    ok = svc.ResultadoAcaoSei(
        numero_sei="140.00286276/2026-27", id_procedimento="123456",
        id_documento="9", documento_formatado="0009999", avisos=[],
    )
    monkeypatch.setattr(svc, "executar_arquivar", lambda *a, **k: ok)
    client.post(f"/caixa-entrada/{item_id}/despachos/arquivar", json={"html": "<p>1</p>"})

    def _levanta(*a, **k):
        raise svc.DespachoSeiError("instável", temporario=True)
    monkeypatch.setattr(svc, "executar_tac", _levanta)
    client.post(f"/caixa-entrada/{item_id}/despachos/tac", json={"html": "<p>2</p>"})

    resp = client.get(f"/caixa-entrada/{item_id}/despachos/historico")

    assert resp.status_code == 200
    itens = resp.json()
    assert len(itens) == 2
    # Mais recente primeiro.
    assert itens[0]["tipo"] == "tac"
    assert itens[0]["status"] == "erro_temporario"
    assert itens[1]["tipo"] == "arquivar"
    assert itens[1]["status"] == "sucesso"


def test_item_inexistente_retorna_404(client):
    resp = client.post("/caixa-entrada/999999/despachos/arquivar", json={"html": "<p>x</p>"})
    assert resp.status_code == 404


# --- Mala direta: o GET do template inventaria as lacunas do modelo --------
_MODELO_COM_LACUNAS = (
    "<p>[NOME DA EMPRESA], inscrita no CNPJ [NNN.NNN.NNN-NN], "
    "fiscalização [remota ou in loco], [descrição] [SE HOUVER]</p>"
)


def test_template_arquivar_devolve_marcadores_classificados(client, db_session, monkeypatch):
    """A tela precisa das lacunas para pedir os valores antes de abrir o editor."""
    _TestSession, item_id = db_session
    monkeypatch.setattr(svc, "montar_template_arquivar", lambda *a, **k: _MODELO_COM_LACUNAS)
    monkeypatch.setattr(svc, "modelos_disponiveis", lambda *a, **k: [])

    resp = client.get(f"/caixa-entrada/{item_id}/despachos/arquivar")
    assert resp.status_code == 200

    por_token = {mk["token"]: mk for mk in resp.json()["marcadores"]}
    assert por_token["[NOME DA EMPRESA]"]["tipo"] == "cadastral"
    # Razão social sugerida em caixa alta, como o padrão do projeto.
    assert por_token["[NOME DA EMPRESA]"]["valor_sugerido"] == "AUTO ESCOLA MODELO"
    assert por_token["[NNN.NNN.NNN-NN]"]["valor_sugerido"] == "12.345.678/0001-99"
    assert por_token["[remota ou in loco]"]["opcoes"] == ["remota", "in loco"]
    assert por_token["[descrição]"]["tipo"] == "texto"
    # Instrução de edição não é campo do formulário.
    assert por_token["[SE HOUVER]"]["preenchivel"] is False


def test_template_sem_lacuna_devolve_lista_vazia(client, db_session, monkeypatch):
    _TestSession, item_id = db_session
    monkeypatch.setattr(svc, "montar_template_tac", lambda *a, **k: "<p>Texto pronto.</p>")
    monkeypatch.setattr(svc, "modelos_disponiveis", lambda *a, **k: [])

    resp = client.get(f"/caixa-entrada/{item_id}/despachos/tac")
    assert resp.status_code == 200
    assert resp.json()["marcadores"] == []
