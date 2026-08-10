"""Testes da tela Consulta Unificada (GET /consulta-unificada).

A tela é somente leitura e serve para ver relatórios de fiscalização e
processos sancionatórios juntos. Os dados vêm da tabela ``consulta_unificada``,
alimentada por automação — o endpoint não consulta SEI nem SharePoint.
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


@pytest.fixture()
def cliente():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as s:
        s.add_all([
            m.ConsultaUnificada(
                tipo="processo", numero_sei="140.00900001/2026-91", numero_limpo="14000900001202691",
                id_procedimento="911", razao_social="AUTO ESCOLA MODELO LTDA",
                cnpj_cpf="12.345.678/0001-99", agente_regulado="Autoescola", ano="2026",
                situacao="Processo instaurado", fase_atual="aguardando_defesa",
                data_criacao_sei=date(2026, 3, 1), data_ultima_acao=date(2026, 5, 20),
            ),
            m.ConsultaUnificada(
                tipo="relatorio", numero_sei="140.00100000/2026-01", numero_limpo="14000100000202601",
                razao_social="VISTORIAS SP LTDA", cnpj_cpf="98.765.432/0001-10",
                agente_regulado="ECV", ano="2026", situacao="Concluído",
                data_criacao_sei=date(2026, 2, 1), data_ultima_acao=date(2026, 2, 10),
            ),
            # Sem datas: representa linha ainda não enriquecida pela automação
            m.ConsultaUnificada(
                tipo="relatorio", numero_sei="140.00200000/2025-02", numero_limpo="14000200000202502",
                razao_social="PERITOS SP LTDA", cnpj_cpf="55.555.555/0001-55",
                agente_regulado="Médicos", ano="2025", situacao="Avaliado",
            ),
        ])
        s.commit()

    def _get_db():
        with Session() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
        email="dev@local", nome="Dev",
    )
    yield TestClient(app, base_url="http://testserver/api")
    app.dependency_overrides.clear()


def _listar(client, **params):
    resp = client.get("/consulta-unificada", params=params)
    assert resp.status_code == 200
    return resp.json()


def test_lista_relatorios_e_processos_juntos(cliente):
    d = _listar(cliente)
    assert d["total"] == 3
    tipos = {l["tipo"] for l in d["linhas"]}
    assert tipos == {"relatorio", "processo"}


def test_linhas_sem_data_vao_para_o_fim(cliente):
    """Sem data não pode parecer "mais antigo" — vai para o fim da ordenação."""
    d = _listar(cliente)
    numeros = [l["numero_sei"] for l in d["linhas"]]
    assert numeros[-1] == "140.00200000/2025-02"
    # As demais vêm da mais recente para a mais antiga
    assert numeros[0] == "140.00900001/2026-91"


def test_filtra_por_tipo(cliente):
    assert _listar(cliente, tipo="processo")["total"] == 1
    assert _listar(cliente, tipo="relatorio")["total"] == 2


def test_filtra_por_agente_situacao_e_ano(cliente):
    assert _listar(cliente, agente="ECV")["total"] == 1
    assert _listar(cliente, situacao="Avaliado")["total"] == 1
    assert _listar(cliente, ano="2025")["total"] == 1
    assert _listar(cliente, ano="2026")["total"] == 2


def test_busca_por_numero_com_e_sem_mascara(cliente):
    assert _listar(cliente, busca="140.00900001/2026-91")["total"] == 1
    assert _listar(cliente, busca="14000900001202691")["total"] == 1
    assert _listar(cliente, busca="00900001")["total"] == 1


def test_busca_por_cnpj(cliente):
    assert _listar(cliente, busca="12.345.678/0001-99")["total"] == 1
    assert _listar(cliente, busca="12345678000199")["total"] == 1


def test_busca_por_razao_social_sem_diferenciar_caixa(cliente):
    d = _listar(cliente, busca="vistorias")
    assert d["total"] == 1
    assert d["linhas"][0]["razao_social"] == "VISTORIAS SP LTDA"


def test_processo_traz_a_fase_atual_e_relatorio_nao(cliente):
    processo = _listar(cliente, tipo="processo")["linhas"][0]
    assert processo["fase_atual"] == "aguardando_defesa"
    relatorio = _listar(cliente, busca="vistorias")["linhas"][0]
    assert relatorio["fase_atual"] is None


def test_total_reflete_o_filtro_e_nao_so_a_pagina(cliente):
    d = _listar(cliente, limit=1)
    assert d["total"] == 3
    assert len(d["linhas"]) == 1


def test_paginacao_nao_repete_linhas(cliente):
    p1 = _listar(cliente, limit=2, offset=0)
    p2 = _listar(cliente, limit=2, offset=2)
    n1 = {l["numero_sei"] for l in p1["linhas"]}
    n2 = {l["numero_sei"] for l in p2["linhas"]}
    assert n1.isdisjoint(n2)
    assert len(n1) == 2 and len(n2) == 1


def test_filtros_disponiveis(cliente):
    agentes = cliente.get("/consulta-unificada/agentes").json()
    assert set(agentes) == {"Autoescola", "ECV", "Médicos"}
    situacoes = cliente.get("/consulta-unificada/situacoes").json()
    assert set(situacoes) == {"Processo instaurado", "Concluído", "Avaliado"}


def test_busca_sem_resultado(cliente):
    assert _listar(cliente, busca="INEXISTENTE LTDA")["total"] == 0
