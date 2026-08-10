"""Ciclo de vida da medida cautelar (Documentação de Negócio v3.0).

Cobre o semáforo de 3 dias, os cartões do painel, a detecção de defesa
apresentada por agente bloqueado (regra crítica do documento), a concordância e
a recusa pelo Coordenador Geral, a renovação e a revogação com certidão de
desbloqueio.
"""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core import security
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.db.base import Base
from app.main import app

HOJE = date.today()


@pytest.fixture()
def sessao():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool, future=True,
    )
    Base.metadata.create_all(engine)
    Sessao = sessionmaker(bind=engine, future=True)

    with Sessao() as s:
        vigente = m.CaixaEntrada(
            numero_sei="140.00100000/2026-01", numero_processo_sei="140.00900001/2026-01",
            razao_social="Autoescola Norte", agente_regulado="Autoescola",
            cnpj_cpf="11.111.111/0001-11", status_triagem="instaurado",
        )
        com_defesa = m.CaixaEntrada(
            numero_sei="140.00200000/2026-02", numero_processo_sei="140.00900002/2026-02",
            razao_social="ECV Ponto Certo", agente_regulado="ECV",
            cnpj_cpf="22.222.222/0001-22", status_triagem="instaurado",
        )
        vencendo = m.CaixaEntrada(
            numero_sei="140.00300000/2026-03", numero_processo_sei="140.00900003/2026-03",
            razao_social="Clinica Trafego", agente_regulado="Perito",
            cnpj_cpf="33.333.333/0001-33", status_triagem="instaurado",
        )
        s.add_all([vigente, com_defesa, vencendo])
        s.flush()

        # Defesa juntada no processo bloqueado: dispara a regra crítica.
        s.add(m.PrazoProcesso(
            caixa_entrada_id=com_defesa.id, fase="aguardando_defesa", dias=15,
            data_inicio=HOJE - timedelta(days=10), data_vencimento=HOJE + timedelta(days=5),
            status="respondido", data_resposta=HOJE - timedelta(days=1),
        ))

        s.add_all([
            m.Cautelar(
                caixa_entrada_id=vigente.id, tipo="Bloqueio", prazo_dias=30,
                data_inicio=HOJE - timedelta(days=5), data_fim=HOJE + timedelta(days=25),
                situacao="vigente", aprovacao="aprovada",
            ),
            m.Cautelar(
                caixa_entrada_id=com_defesa.id, tipo="Bloqueio", prazo_dias=30,
                data_inicio=HOJE - timedelta(days=10), data_fim=HOJE + timedelta(days=20),
                situacao="vigente", aprovacao="aprovada",
            ),
            m.Cautelar(
                caixa_entrada_id=vencendo.id, tipo="Bloqueio", prazo_dias=30,
                data_inicio=HOJE - timedelta(days=28), data_fim=HOJE + timedelta(days=2),
                situacao="vigente", aprovacao="pendente",
            ),
        ])
        s.commit()
        ids = {
            "vigente": vigente.id, "com_defesa": com_defesa.id, "vencendo": vencendo.id,
        }

    def _override():
        db = Sessao()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override
    app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
        email="dev@local", nome="Teste", roles=[])

    yield Sessao, ids

    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_current_user, None)


@pytest.fixture()
def client(sessao):
    return TestClient(app, base_url="http://testserver/api")


def _por_razao(client, razao: str) -> dict:
    return next(c for c in client.get("/cautelares").json() if c["razao_social"] == razao)


class TestSemaforoEResumo:
    def test_vencendo_usa_limiar_de_tres_dias(self, client):
        """Antes eram 7 dias; o documento manda casar com o semáforo de prazos."""
        assert _por_razao(client, "Clinica Trafego")["situacao"] == "vencendo"
        # 25 e 20 dias restantes continuam vigentes.
        assert _por_razao(client, "Autoescola Norte")["situacao"] == "vigente"

    def test_semaforo_por_linha(self, client):
        assert _por_razao(client, "Clinica Trafego")["semaforo"] == "amarelo"
        assert _por_razao(client, "Autoescola Norte")["semaforo"] == "verde"

    def test_cartoes_do_painel(self, client):
        resumo = client.get("/cautelares/resumo").json()
        assert resumo["vigentes"] == 2
        assert resumo["vencendo"] == 1
        assert resumo["vencidas"] == 0
        assert resumo["defesa_apresentada"] == 1
        assert resumo["aguardando_aprovacao"] == 1

    def test_dias_restantes_negativo_quando_vencida(self, client, sessao):
        Sessao, ids = sessao
        with Sessao() as s:
            c = s.query(m.Cautelar).filter_by(caixa_entrada_id=ids["vigente"]).first()
            c.data_fim = HOJE - timedelta(days=4)
            s.commit()
        linha = _por_razao(client, "Autoescola Norte")
        assert linha["situacao"] == "vencida"
        assert linha["dias_restantes"] == -4


class TestDefesaApresentada:
    """Regra crítica: agente bloqueado que apresenta defesa exige revisão."""

    def test_marca_a_cautelar_com_defesa(self, client):
        assert _por_razao(client, "ECV Ponto Certo")["defesa_apresentada"] is True
        assert _por_razao(client, "Autoescola Norte")["defesa_apresentada"] is False

    def test_bloqueio_fica_como_revisar(self, client):
        assert _por_razao(client, "ECV Ponto Certo")["status_bloqueio"] == "revisar"
        assert _por_razao(client, "Autoescola Norte")["status_bloqueio"] == "ativo"

    def test_sobe_ao_topo_da_fila(self, client):
        lista = client.get("/cautelares").json()
        assert lista[0]["razao_social"] == "ECV Ponto Certo"

    def test_filtro_somente_com_defesa(self, client):
        lista = client.get("/cautelares", params={"somente_com_defesa": True}).json()
        assert [c["razao_social"] for c in lista] == ["ECV Ponto Certo"]

    def test_evento_de_defesa_tambem_sinaliza(self, client, sessao):
        """A automação fecha o prazo; a verificação em tempo real grava evento."""
        Sessao, ids = sessao
        with Sessao() as s:
            s.add(m.EventoProcesso(
                caixa_entrada_id=ids["vigente"], tipo="defesa_juntada",
                descricao="Defesa juntada pelo interessado",
            ))
            s.commit()
        assert _por_razao(client, "Autoescola Norte")["defesa_apresentada"] is True


class TestConcordanciaDoCoordenadorGeral:
    def test_aprovar_marca_pendente_de_assinatura(self, client, sessao):
        _, ids = sessao
        cautelar = _por_razao(client, "Clinica Trafego")
        resp = client.post(f"/cautelares/{cautelar['id']}/aprovar")
        assert resp.status_code == 200
        dados = resp.json()
        assert dados["aprovacao"] == "aprovada"
        assert dados["pendente_assinatura"] is True

    def test_recusar_devolve_o_processo_para_a_caixa_de_entrada(self, client, sessao):
        Sessao, ids = sessao
        cautelar = _por_razao(client, "Clinica Trafego")
        resp = client.post(
            f"/cautelares/{cautelar['id']}/recusar",
            json={"motivo": "Não há risco que justifique o bloqueio."},
        )
        assert resp.status_code == 200
        assert resp.json()["aprovacao"] == "recusada"

        with Sessao() as s:
            item = s.get(m.CaixaEntrada, ids["vencendo"])
            assert item.status_triagem == "cautelar_recusada"
            eventos = [e.tipo for e in s.query(m.EventoProcesso).all()]
            assert "cautelar_recusada" in eventos

    def test_recusa_exige_motivo(self, client):
        cautelar = _por_razao(client, "Clinica Trafego")
        resp = client.post(f"/cautelares/{cautelar['id']}/recusar", json={"motivo": "   "})
        assert resp.status_code == 422

    def test_negado_para_quem_nao_e_coordenador_geral(self, client, monkeypatch):
        """Aplicar, renovar e revogar são competência exclusiva (art. 62, § único)."""
        monkeypatch.setattr(security, "AUTH_ENABLED", True)
        app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
            email="analista@detran.sp.gov.br", nome="Analista", roles=[])
        try:
            cautelar = _por_razao(client, "Clinica Trafego")
            assert client.post(f"/cautelares/{cautelar['id']}/aprovar").status_code == 403
            assert client.post(
                f"/cautelares/{cautelar['id']}/revogar", json={"motivo": "x"}
            ).status_code == 403
        finally:
            app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
                email="dev@local", nome="Teste", roles=[])


class TestRenovacaoERevogacao:
    def test_renovar_cria_nova_a_partir_do_vencimento(self, client):
        original = _por_razao(client, "Autoescola Norte")
        resp = client.post(f"/cautelares/{original['id']}/renovar", json={"prazo_dias": 45})
        assert resp.status_code == 201
        nova = resp.json()
        assert nova["prazo_dias"] == 45
        assert nova["renovada_de_id"] == original["id"]
        # Renovação não volta para a fila de concordância.
        assert nova["aprovacao"] == "aprovada"

    def test_renovar_rejeita_prazo_fora_da_lista(self, client):
        original = _por_razao(client, "Autoescola Norte")
        resp = client.post(f"/cautelares/{original['id']}/renovar", json={"prazo_dias": 15})
        assert resp.status_code == 422

    def test_revogar_registra_fundamentacao_e_pede_certidao(self, client):
        cautelar = _por_razao(client, "ECV Ponto Certo")
        resp = client.post(
            f"/cautelares/{cautelar['id']}/revogar",
            json={"motivo": "Defesa comprovou a regularização."},
        )
        assert resp.status_code == 200
        dados = resp.json()
        assert dados["situacao"] == "revogada"
        assert dados["motivo_revogacao"] == "Defesa comprovou a regularização."
        assert dados["status_bloqueio"] == "revogado"
        assert dados["pendente_assinatura"] is True

    def test_nao_revoga_duas_vezes(self, client):
        cautelar = _por_razao(client, "ECV Ponto Certo")
        client.post(f"/cautelares/{cautelar['id']}/revogar", json={"motivo": "primeira"})
        resp = client.post(f"/cautelares/{cautelar['id']}/revogar", json={"motivo": "segunda"})
        assert resp.status_code == 409

    def test_revogada_nao_pode_ser_renovada(self, client):
        cautelar = _por_razao(client, "ECV Ponto Certo")
        client.post(f"/cautelares/{cautelar['id']}/revogar", json={"motivo": "revogada"})
        resp = client.post(f"/cautelares/{cautelar['id']}/renovar", json={"prazo_dias": 30})
        assert resp.status_code == 409


class TestCertidoes:
    def test_certidao_de_desbloqueio_exige_revogacao_previa(self, client):
        cautelar = _por_razao(client, "Autoescola Norte")
        resp = client.post(
            f"/cautelares/{cautelar['id']}/certidao-desbloqueio",
            files={"arquivo": ("evidencia.pdf", b"%PDF-1.4", "application/pdf")},
        )
        assert resp.status_code == 409

    def test_certidao_de_desbloqueio_depois_de_revogar(self, client):
        cautelar = _por_razao(client, "Autoescola Norte")
        client.post(f"/cautelares/{cautelar['id']}/revogar", json={"motivo": "ok"})
        resp = client.post(
            f"/cautelares/{cautelar['id']}/certidao-desbloqueio",
            files={"arquivo": ("evidencia.png", b"\x89PNG", "image/png")},
        )
        assert resp.status_code == 200
        assert resp.json()["sucesso"] is True

    def test_formato_de_evidencia_invalido(self, client):
        cautelar = _por_razao(client, "Autoescola Norte")
        resp = client.post(
            f"/cautelares/{cautelar['id']}/certidao",
            files={"arquivo": ("planilha.xlsx", b"PK", "application/vnd.ms-excel")},
        )
        assert resp.status_code == 422

    def test_assinatura_concluida_baixa_a_pendencia(self, client):
        cautelar = _por_razao(client, "Autoescola Norte")
        client.post(
            f"/cautelares/{cautelar['id']}/certidao",
            files={"arquivo": ("evidencia.pdf", b"%PDF-1.4", "application/pdf")},
        )
        resp = client.post(f"/cautelares/{cautelar['id']}/assinatura-concluida")
        assert resp.status_code == 200
        assert resp.json()["pendente_assinatura"] is False
