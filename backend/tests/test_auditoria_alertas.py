"""Trilha de auditoria e alertas internos (Documentação de Negócio v3.0).

O ponto mais delicado aqui é o alerta não apontar processo que já saiu do app:
a automação de limpeza remove itens da caixa de entrada e deixa prazos órfãos,
e um alerta sobre eles seria pendência que ninguém consegue resolver.
"""
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.db.base import Base
from app.main import app
from app.services import auditoria as trilha

HOJE = date.today()


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
            razao_social="Autoescola Alerta", agente_regulado="Autoescola",
            status_triagem="instaurado",
        )
        s.add(item)
        s.flush()

        s.add_all([
            # Vencido, com processo existente: deve alertar.
            m.PrazoProcesso(
                caixa_entrada_id=item.id, fase="aguardando_defesa", dias=15,
                data_inicio=HOJE - timedelta(days=20), data_vencimento=HOJE - timedelta(days=5),
                status="em_andamento",
            ),
            # Órfão: a caixa de entrada 9999 não existe. NÃO deve alertar.
            m.PrazoProcesso(
                caixa_entrada_id=9999, fase="aguardando_defesa", dias=15,
                data_inicio=HOJE - timedelta(days=30), data_vencimento=HOJE - timedelta(days=10),
                status="em_andamento",
            ),
            # Vence em 2 dias: entra no alerta de "a vencer".
            m.PrazoProcesso(
                caixa_entrada_id=item.id, fase="recurso", dias=15,
                data_inicio=HOJE, data_vencimento=HOJE + timedelta(days=2),
                status="em_andamento",
            ),
        ])
        # Evento recente evita que o item caia no alerta de morosidade.
        s.add(m.EventoProcesso(
            caixa_entrada_id=item.id, tipo="fase_avancada", descricao="teste",
        ))
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


def _alertas(client) -> dict:
    return {a["chave"]: a for a in client.get("/alertas").json()}


class TestAlertas:
    def test_traz_os_oito_gatilhos(self, client):
        assert len(client.get("/alertas").json()) == 8

    def test_prazo_vencido_alerta(self, client, sessao):
        _, item_id = sessao
        alerta = _alertas(client)["prazos_vencidos"]
        assert alerta["total"] == 1
        assert alerta["itens"] == [item_id]
        assert alerta["severidade"] == "alta"

    def test_prazo_orfao_nao_alerta(self, client):
        """Prazo cuja caixa de entrada foi removida pela limpeza não é pendência."""
        assert 9999 not in _alertas(client)["prazos_vencidos"]["itens"]

    def test_prazo_a_vencer_alerta(self, client, sessao):
        _, item_id = sessao
        assert _alertas(client)["prazos_a_vencer"]["itens"] == [item_id]

    def test_processo_com_evento_recente_nao_e_moroso(self, client):
        assert _alertas(client)["sem_movimentacao"]["total"] == 0

    def test_processo_sem_evento_recente_alerta_morosidade(self, client, sessao):
        Sessao, item_id = sessao
        with Sessao() as s:
            for e in s.scalars(select(m.EventoProcesso)).all():
                e.criado_em = datetime.now() - timedelta(days=40)
            s.commit()
        assert _alertas(client)["sem_movimentacao"]["itens"] == [item_id]

    def test_cautelar_vencida_alerta(self, client, sessao):
        Sessao, item_id = sessao
        with Sessao() as s:
            s.add(m.Cautelar(
                caixa_entrada_id=item_id, tipo="Bloqueio", prazo_dias=30,
                data_inicio=HOJE - timedelta(days=40), data_fim=HOJE - timedelta(days=10),
                situacao="vigente",
            ))
            s.commit()
        assert _alertas(client)["cautelares_vencidas"]["itens"] == [item_id]

    def test_cautelar_revogada_nao_alerta(self, client, sessao):
        Sessao, item_id = sessao
        with Sessao() as s:
            s.add(m.Cautelar(
                caixa_entrada_id=item_id, tipo="Bloqueio", prazo_dias=30,
                data_inicio=HOJE - timedelta(days=40), data_fim=HOJE - timedelta(days=10),
                situacao="revogada",
            ))
            s.commit()
        assert _alertas(client)["cautelares_vencidas"]["total"] == 0

    def test_recurso_sem_decisao_alerta(self, client, sessao):
        Sessao, item_id = sessao
        with Sessao() as s:
            s.add(m.RecursoProcesso(
                caixa_entrada_id=item_id, interposto=True, data_interposicao=HOJE,
            ))
            s.commit()
        assert _alertas(client)["recursos_pendentes"]["itens"] == [item_id]

    def test_pendente_de_assinatura_alerta(self, client, sessao):
        Sessao, item_id = sessao
        with Sessao() as s:
            s.add(m.Cautelar(
                caixa_entrada_id=item_id, tipo="Bloqueio", prazo_dias=30,
                data_inicio=HOJE, data_fim=HOJE + timedelta(days=30),
                situacao="vigente", pendente_assinatura=True,
            ))
            s.commit()
        assert _alertas(client)["aguardando_assinatura"]["itens"] == [item_id]

    def test_encerramento_parado_alerta(self, client, sessao):
        Sessao, item_id = sessao
        with Sessao() as s:
            s.add(m.FaseProcessoAndamento(
                caixa_entrada_id=item_id, fase="encerramento", autor="Sistema",
                data_entrada=datetime.now() - timedelta(days=5),
            ))
            s.commit()
        assert _alertas(client)["encerramento_sem_conclusao"]["itens"] == [item_id]


class TestTrilhaDeAuditoria:
    def test_operacao_que_altera_dados_entra_na_trilha(self, client, sessao):
        Sessao, item_id = sessao
        client.put(
            f"/processos-andamento/{item_id}/prioridade",
            json={"prioritario": True, "justificativa": "Reincidência"},
        )
        registros = client.get("/auditoria").json()
        assert registros["total"] >= 1
        alvo = registros["registros"][0]
        assert alvo["metodo"] == "PUT"
        assert alvo["entidade"] == "processos-andamento"
        assert alvo["registro_id"] == item_id
        assert alvo["usuario"] == "dev@local"
        assert alvo["momento"] is not None

    def test_leitura_nao_entra_na_trilha(self, client):
        client.get("/alertas")
        client.get("/prazos")
        assert client.get("/auditoria").json()["total"] == 0

    def test_filtro_por_entidade(self, client, sessao):
        Sessao, item_id = sessao
        client.put(
            f"/processos-andamento/{item_id}/prioridade",
            json={"prioritario": True, "justificativa": "x"},
        )
        assert client.get("/auditoria", params={"entidade": "cautelares"}).json()["total"] == 0
        assert client.get(
            "/auditoria", params={"entidade": "processos-andamento"}
        ).json()["total"] >= 1


class TestHelpersDaTrilha:
    def test_extrai_entidade_e_id_do_caminho(self):
        assert trilha.entidade_do_caminho("/cautelares/12/revogar") == "cautelares"
        assert trilha.id_do_caminho("/cautelares/12/revogar") == 12
        assert trilha.id_do_caminho("/cautelares") is None

    def test_so_audita_metodos_que_alteram(self):
        assert trilha.deve_auditar("POST", "/cautelares")
        assert trilha.deve_auditar("DELETE", "/usuarios/3")
        assert not trilha.deve_auditar("GET", "/cautelares")

    def test_ignora_documentacao_e_health(self):
        assert not trilha.deve_auditar("POST", "/health")
        assert not trilha.deve_auditar("POST", "/docs")
