"""Testes do inventário de relatórios e processos do agente.

Endpoint: ``GET /caixa-entrada/{id}/historico-agente``

Regra de contagem: cada linha da caixa de entrada rende **um relatório** (o
``numero_sei``, que é o processo de fiscalização) e, quando a instauração criou
um processo sancionatório novo, **também um processo**
(``numero_processo_sei``). Em TAC/Arquivamento não nasce processo novo, então
essas linhas contam só o relatório. O item consultado entra no inventário.
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

DOC_AGENTE = "12.345.678/0001-99"
DOC_OUTRO = "98.765.432/0001-10"


@pytest.fixture()
def cliente():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)

    with Session() as s:
        # Duas fiscalizações instauradas do mesmo agente: 2 relatórios + 2 processos = 4
        inst1 = m.CaixaEntrada(
            numero_sei="140.00100000/2026-01", id_procedimento="111",
            cnpj_cpf=DOC_AGENTE, razao_social="Agente X", status_triagem="instaurado",
            numero_processo_sei="140.00900001/2026-91", id_procedimento_processo="911",
            data_recebimento=date(2026, 1, 10),
        )
        inst2 = m.CaixaEntrada(
            # Documento gravado sem máscara de propósito
            numero_sei="140.00200000/2026-02", id_procedimento="222",
            cnpj_cpf="12345678000199", razao_social="Agente X", status_triagem="instaurado",
            numero_processo_sei="140.00900002/2026-92", id_procedimento_processo="922",
            data_recebimento=date(2026, 2, 10),
        )
        # TAC: não gera processo novo, conta apenas o relatório
        tac = m.CaixaEntrada(
            numero_sei="140.00300000/2026-03", id_procedimento="333",
            cnpj_cpf=DOC_AGENTE, razao_social="Agente X", status_triagem="tac",
            data_recebimento=date(2026, 3, 10),
        )
        # Ainda em triagem: só relatório
        pendente = m.CaixaEntrada(
            numero_sei="140.00400000/2026-04", id_procedimento="444",
            cnpj_cpf=DOC_AGENTE, razao_social="Agente X", status_triagem="pendente",
            data_recebimento=date(2026, 4, 10),
        )
        # Outro agente — não deve aparecer
        outro = m.CaixaEntrada(
            numero_sei="140.00500000/2026-05", id_procedimento="555",
            cnpj_cpf=DOC_OUTRO, razao_social="Agente Y", status_triagem="instaurado",
            numero_processo_sei="140.00900005/2026-95", id_procedimento_processo="955",
        )
        s.add_all([inst1, inst2, tac, pendente, outro])
        s.commit()
        ids = {
            "inst1": inst1.id, "inst2": inst2.id, "tac": tac.id,
            "pendente": pendente.id, "outro": outro.id,
        }

    def _get_db():
        with Session() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
        email="dev@local", nome="Dev",
    )
    yield TestClient(app, base_url="http://testserver/api"), Session, ids
    app.dependency_overrides.clear()


def test_conta_relatorios_e_processos_do_agente(cliente):
    """4 linhas do agente: 2 instauradas (2 rel + 2 proc), 1 TAC e 1 pendente
    (só relatório cada) = 4 relatórios + 2 processos."""
    client, _, ids = cliente
    resp = client.get(f"/caixa-entrada/{ids['inst1']}/historico-agente")
    assert resp.status_code == 200
    corpo = resp.json()
    assert corpo["total_relatorios"] == 4
    assert corpo["total_processos"] == 2
    assert corpo["total"] == 6


def test_exemplo_do_usuario_duas_instauracoes_dao_quatro(cliente):
    """Isolando só as duas instauradas: 2 relatórios + 2 processos = 4."""
    client, Session, ids = cliente
    # Remove as linhas que não são instauração para reproduzir o cenário exato
    with Session() as s:
        for chave in ("tac", "pendente"):
            s.delete(s.get(m.CaixaEntrada, ids[chave]))
        s.commit()

    corpo = client.get(f"/caixa-entrada/{ids['inst1']}/historico-agente").json()
    assert corpo["total"] == 4
    assert corpo["total_relatorios"] == 2
    assert corpo["total_processos"] == 2


def test_tac_nao_gera_registro_de_processo(cliente):
    """TAC entra no processo de fiscalização existente, não cria número novo."""
    client, _, ids = cliente
    corpo = client.get(f"/caixa-entrada/{ids['tac']}/historico-agente").json()
    do_tac = [r for r in corpo["registros"] if r["caixa_entrada_id"] == ids["tac"]]
    assert len(do_tac) == 1
    assert do_tac[0]["tipo"] == "relatorio"


def test_registros_trazem_id_procedimento_para_o_link_do_sei(cliente):
    client, _, ids = cliente
    corpo = client.get(f"/caixa-entrada/{ids['inst1']}/historico-agente").json()
    por_numero = {r["numero_sei"]: r for r in corpo["registros"]}
    assert por_numero["140.00100000/2026-01"]["id_procedimento"] == "111"
    # O processo usa o id do procedimento novo, não o do relatório
    assert por_numero["140.00900001/2026-91"]["id_procedimento"] == "911"


def test_marca_os_registros_do_item_consultado(cliente):
    client, _, ids = cliente
    corpo = client.get(f"/caixa-entrada/{ids['inst1']}/historico-agente").json()
    atuais = [r for r in corpo["registros"] if r["atual"]]
    # O relatório e o processo da própria linha
    assert len(atuais) == 2
    assert {r["caixa_entrada_id"] for r in atuais} == {ids["inst1"]}


def test_casa_documento_com_e_sem_mascara(cliente):
    """inst2 tem o CNPJ sem máscara e ainda assim entra no inventário."""
    client, _, ids = cliente
    corpo = client.get(f"/caixa-entrada/{ids['inst1']}/historico-agente").json()
    numeros = {r["numero_sei"] for r in corpo["registros"]}
    assert "140.00200000/2026-02" in numeros
    assert "140.00900002/2026-92" in numeros


def test_nao_mistura_agentes(cliente):
    client, _, ids = cliente
    corpo = client.get(f"/caixa-entrada/{ids['inst1']}/historico-agente").json()
    numeros = {r["numero_sei"] for r in corpo["registros"]}
    assert "140.00500000/2026-05" not in numeros
    assert "140.00900005/2026-95" not in numeros


def test_agente_com_um_unico_relatorio(cliente):
    client, _, ids = cliente
    corpo = client.get(f"/caixa-entrada/{ids['outro']}/historico-agente").json()
    assert corpo["total_relatorios"] == 1
    assert corpo["total_processos"] == 1
    assert corpo["total"] == 2


def test_item_sem_documento_devolve_vazio(cliente):
    client, Session, _ = cliente
    with Session() as s:
        sem_doc = m.CaixaEntrada(numero_sei="140.00600000/2026-06", status_triagem="pendente")
        s.add(sem_doc)
        s.commit()
        item_id = sem_doc.id

    corpo = client.get(f"/caixa-entrada/{item_id}/historico-agente").json()
    assert corpo["total"] == 0
    assert corpo["registros"] == []


def test_item_inexistente_retorna_404(cliente):
    client, _, _ = cliente
    assert client.get("/caixa-entrada/999999/historico-agente").status_code == 404
