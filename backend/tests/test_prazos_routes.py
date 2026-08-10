"""Testes da tela de Controle de Prazos (/prazos).

Cobre o semáforo aplicado às linhas, os cartões de resumo (que contam o
universo antes do filtro de situação, porque servem de filtro rápido), os
filtros e a ordenação com priorizados na frente.
"""
from datetime import date, timedelta

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

HOJE = date.today()


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(engine)
    TestSession = sessionmaker(bind=engine, future=True)

    with TestSession() as s:
        analista = m.Usuario(email="ana@detran.sp.gov.br", nome="Ana Lista", ativo=True)
        s.add(analista)
        s.flush()

        # Vencido (vermelho)
        vencido = m.CaixaEntrada(
            numero_sei="140.00100000/2026-01", numero_processo_sei="140.00900001/2026-01",
            cnpj_cpf="11.111.111/0001-11", razao_social="Autoescola Vencida",
            agente_regulado="Autoescola", status_triagem="instaurado",
            responsavel_id=analista.id,
        )
        # Vence em 2 dias (amarelo) e priorizado
        amarelo = m.CaixaEntrada(
            numero_sei="140.00200000/2026-02", numero_processo_sei="140.00900002/2026-02",
            cnpj_cpf="22.222.222/0001-22", razao_social="ECV Ponto Certo",
            agente_regulado="ECV", status_triagem="instaurado",
            prioritario=True, prioridade_justificativa="Reincidência",
        )
        # Vence em 10 dias (verde)
        verde = m.CaixaEntrada(
            numero_sei="140.00300000/2026-03", numero_processo_sei="140.00900003/2026-03",
            cnpj_cpf="33.333.333/0001-33", razao_social="Perito Tranquilo",
            agente_regulado="Perito", status_triagem="instaurado",
        )
        s.add_all([vencido, amarelo, verde])
        s.flush()

        s.add_all([
            m.PrazoProcesso(
                caixa_entrada_id=vencido.id, fase="aguardando_defesa", dias=15,
                data_inicio=HOJE - timedelta(days=20), data_vencimento=HOJE - timedelta(days=5),
                status="em_andamento",
            ),
            m.PrazoProcesso(
                caixa_entrada_id=amarelo.id, fase="aguardando_alegacoes", dias=7,
                data_inicio=HOJE - timedelta(days=5), data_vencimento=HOJE + timedelta(days=2),
                status="em_andamento",
            ),
            m.PrazoProcesso(
                caixa_entrada_id=verde.id, fase="recurso", dias=15,
                data_inicio=HOJE, data_vencimento=HOJE + timedelta(days=10),
                status="em_andamento",
            ),
            # Encerrado: não deve aparecer
            m.PrazoProcesso(
                caixa_entrada_id=verde.id, fase="aguardando_defesa", dias=15,
                data_inicio=HOJE - timedelta(days=40), data_vencimento=HOJE - timedelta(days=25),
                status="respondido",
            ),
        ])
        s.commit()
        ids = {"vencido": vencido.id, "amarelo": amarelo.id, "verde": verde.id}

    def _override():
        db = TestSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
        email="dev@local", nome="Teste", roles=[])

    yield TestSession, ids

    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture()
def client(db_session):
    return TestClient(app, base_url="http://testserver/api")


class TestListagem:
    def test_traz_somente_prazos_ativos(self, client):
        dados = client.get("/prazos").json()
        assert dados["total"] == 3
        assert all(p["status"] in ("em_andamento", "decurso") for p in dados["prazos"])

    def test_semaforo_por_linha(self, client):
        prazos = client.get("/prazos").json()["prazos"]
        cores = {p["interessado"]: p["semaforo"] for p in prazos}
        assert cores["Autoescola Vencida"] == "vermelho"
        assert cores["ECV Ponto Certo"] == "amarelo"
        assert cores["Perito Tranquilo"] == "verde"

    def test_priorizados_vem_primeiro(self, client):
        prazos = client.get("/prazos").json()["prazos"]
        assert prazos[0]["interessado"] == "ECV Ponto Certo"
        assert prazos[0]["prioritario"] is True

    def test_usa_o_numero_do_processo_sancionatorio(self, client):
        prazos = client.get("/prazos").json()["prazos"]
        numeros = {p["numero_sei"] for p in prazos}
        assert "140.00900001/2026-01" in numeros

    def test_rotulo_do_tipo_vem_da_matriz(self, client):
        prazos = client.get("/prazos").json()["prazos"]
        rotulos = {p["interessado"]: p["tipo_prazo"] for p in prazos}
        assert rotulos["Autoescola Vencida"] == "Defesa prévia"
        assert rotulos["ECV Ponto Certo"] == "Alegações finais"
        assert rotulos["Perito Tranquilo"] == "Recurso administrativo"

    def test_base_legal_acompanha_o_tipo(self, client):
        prazos = client.get("/prazos").json()["prazos"]
        bases = {p["interessado"]: p["base_legal"] for p in prazos}
        assert bases["Perito Tranquilo"] == "Art. 44"

    def test_responsavel_atribuido_aparece(self, client):
        prazos = client.get("/prazos").json()["prazos"]
        por_nome = {p["interessado"]: p["responsavel"] for p in prazos}
        assert por_nome["Autoescola Vencida"] == "Ana Lista"
        assert por_nome["Perito Tranquilo"] is None


class TestResumo:
    def test_conta_cada_cor(self, client):
        resumo = client.get("/prazos").json()["resumo"]
        assert resumo == {
            "vencidos": 1, "vence_em_3_dias": 1, "no_prazo": 1, "priorizados": 1,
        }

    def test_resumo_ignora_o_filtro_de_situacao(self, client):
        """Os cartões são filtro rápido: precisam manter a contagem total."""
        dados = client.get("/prazos", params={"situacao": "vermelho"}).json()
        assert dados["total"] == 1
        assert dados["resumo"]["no_prazo"] == 1
        assert dados["resumo"]["vence_em_3_dias"] == 1


class TestFiltros:
    def test_por_situacao(self, client):
        prazos = client.get("/prazos", params={"situacao": "amarelo"}).json()["prazos"]
        assert [p["interessado"] for p in prazos] == ["ECV Ponto Certo"]

    def test_por_agente(self, client):
        prazos = client.get("/prazos", params={"agente": "ECV"}).json()["prazos"]
        assert [p["interessado"] for p in prazos] == ["ECV Ponto Certo"]

    def test_somente_priorizados(self, client):
        prazos = client.get("/prazos", params={"priorizados": True}).json()["prazos"]
        assert all(p["prioritario"] for p in prazos)
        assert len(prazos) == 1

    def test_busca_por_numero_sem_mascara(self, client):
        prazos = client.get("/prazos", params={"busca": "14000900001202601"}).json()["prazos"]
        assert [p["interessado"] for p in prazos] == ["Autoescola Vencida"]

    def test_busca_por_nome_do_interessado(self, client):
        prazos = client.get("/prazos", params={"busca": "perito"}).json()["prazos"]
        assert [p["interessado"] for p in prazos] == ["Perito Tranquilo"]

    def test_por_tipo_de_prazo(self, client):
        prazos = client.get("/prazos", params={"tipo": "alegacoes_finais"}).json()["prazos"]
        assert [p["interessado"] for p in prazos] == ["ECV Ponto Certo"]

    def test_por_responsavel(self, client, db_session):
        _, _ids = db_session
        responsaveis = client.get("/prazos/responsaveis").json()
        assert len(responsaveis) == 1
        prazos = client.get(
            "/prazos", params={"responsavel_id": responsaveis[0]["id"]}
        ).json()["prazos"]
        assert [p["interessado"] for p in prazos] == ["Autoescola Vencida"]

    def test_janela_de_vencimento_para_o_calendario(self, client):
        prazos = client.get(
            "/prazos",
            params={
                "venc_de": (HOJE + timedelta(days=1)).isoformat(),
                "venc_ate": (HOJE + timedelta(days=5)).isoformat(),
            },
        ).json()["prazos"]
        assert [p["interessado"] for p in prazos] == ["ECV Ponto Certo"]


class TestMatriz:
    def test_endpoint_de_tipos_devolve_a_matriz_inteira(self, client):
        tipos = client.get("/prazos/tipos").json()
        assert len(tipos) == 12
        chaves = {t["chave"] for t in tipos}
        assert {"defesa_previa", "recurso", "maximo_recurso"} <= chaves
        recurso = next(t for t in tipos if t["chave"] == "recurso")
        assert recurso["dias"] == 15
        assert recurso["base_legal"] == "Art. 44"
        assert recurso["no_vencimento"] == "Trânsito administrativo"
