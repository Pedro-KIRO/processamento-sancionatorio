"""Testes da busca unificada (GET /busca).

O ponto central: um item da caixa de entrada pode responder por dois números
SEI — o do relatório de fiscalização e, se houve instauração, o do processo
sancionatório. A busca precisa dizer QUAL dos dois casou, porque é isso que
define a tela de destino. Antes a pesquisa mandava tudo para "Processos em
Andamento" e caía na tela errada quando o número era de um relatório.
"""
from datetime import date

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

NUM_RELATORIO = "140.00100000/2026-01"
NUM_PROCESSO = "140.00900001/2026-91"
NUM_PENDENTE = "140.00400000/2026-04"
CNPJ = "12.345.678/0001-99"


@pytest.fixture()
def cliente():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as s:
        instaurado = m.CaixaEntrada(
            numero_sei=NUM_RELATORIO, id_procedimento="111",
            cnpj_cpf=CNPJ, razao_social="AUTO ESCOLA MODELO LTDA",
            agente_regulado="Autoescola", status_triagem="instaurado",
            numero_processo_sei=NUM_PROCESSO, id_procedimento_processo="911",
            data_recebimento=date(2026, 1, 10),
        )
        pendente = m.CaixaEntrada(
            numero_sei=NUM_PENDENTE, id_procedimento="444",
            cnpj_cpf="98.765.432/0001-10", razao_social="VISTORIAS SP LTDA",
            agente_regulado="ECV", status_triagem="pendente",
            data_recebimento=date(2026, 4, 10),
        )
        s.add_all([instaurado, pendente])
        s.commit()
        ids = {"instaurado": instaurado.id, "pendente": pendente.id}

    def _get_db():
        with Session() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
        email="dev@local", nome="Dev",
    )
    yield TestClient(app, base_url="http://testserver/api"), ids
    app.dependency_overrides.clear()


def _buscar(client, termo):
    resp = client.get("/busca", params={"termo": termo})
    assert resp.status_code == 200
    return resp.json()


def test_numero_de_relatorio_e_classificado_como_relatorio(cliente):
    """Este é o caso que levava à tela errada."""
    client, ids = cliente
    d = _buscar(client, NUM_RELATORIO)
    assert d["total"] == 1
    assert d["resultados"][0]["tipo"] == "relatorio"
    assert d["resultados"][0]["numero_sei"] == NUM_RELATORIO
    assert d["resultados"][0]["caixa_entrada_id"] == ids["instaurado"]


def test_numero_de_processo_e_classificado_como_processo(cliente):
    client, _ = cliente
    d = _buscar(client, NUM_PROCESSO)
    assert d["total"] == 1
    resultado = d["resultados"][0]
    assert resultado["tipo"] == "processo"
    assert resultado["numero_sei"] == NUM_PROCESSO
    # O link do SEI precisa do procedimento do processo novo, não o do relatório
    assert resultado["id_procedimento"] == "911"


def test_busca_por_numero_sem_mascara(cliente):
    client, _ = cliente
    d = _buscar(client, "14000100000202601")
    assert d["total"] == 1
    assert d["resultados"][0]["tipo"] == "relatorio"


def test_busca_parcial_por_numero(cliente):
    client, _ = cliente
    d = _buscar(client, "00900001")
    assert d["total"] == 1
    assert d["resultados"][0]["tipo"] == "processo"


def test_busca_por_cnpj_com_e_sem_mascara(cliente):
    client, _ = cliente
    assert _buscar(client, CNPJ)["total"] == 1
    assert _buscar(client, "12345678000199")["total"] == 1


def test_busca_por_razao_social_parcial_e_sem_diferenciar_caixa(cliente):
    client, _ = cliente
    d = _buscar(client, "auto escola")
    assert d["total"] == 1
    assert d["resultados"][0]["razao_social"] == "AUTO ESCOLA MODELO LTDA"


def test_relatorio_pendente_mantem_status_para_o_frontend_rotear(cliente):
    client, ids = cliente
    d = _buscar(client, NUM_PENDENTE)
    resultado = d["resultados"][0]
    assert resultado["tipo"] == "relatorio"
    assert resultado["status_triagem"] == "pendente"
    assert resultado["caixa_entrada_id"] == ids["pendente"]


def test_termo_curto_nao_busca(cliente):
    """Evita varrer a base a cada tecla digitada."""
    client, _ = cliente
    assert _buscar(client, "1")["total"] == 0
    assert _buscar(client, "")["total"] == 0


def test_termo_sem_resultado(cliente):
    client, _ = cliente
    assert _buscar(client, "999.99999999/9999-99")["total"] == 0


def test_respeita_o_limite(cliente):
    client, _ = cliente
    resp = client.get("/busca", params={"termo": "140", "limit": 1})
    assert resp.status_code == 200
    assert len(resp.json()["resultados"]) <= 1
