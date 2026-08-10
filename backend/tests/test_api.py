"""Testes da API (FastAPI TestClient, banco SQLite em memória)."""
from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.db.base import Base
from app.main import app

_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    future=True,
)
Base.metadata.create_all(_engine)
_TestSession = sessionmaker(bind=_engine, future=True)

with _TestSession() as _s:
    _s.add_all([
        m.CaixaEntrada(numero_sei="140.00286276/2026-27", cnpj_cpf="12.345.678/0001-99",
                       razao_social="Auto Escola Modelo", agente_regulado="Autoescola",
                       segmento="Educacao", data_recebimento=date(2026, 1, 10)),
        m.CaixaEntrada(numero_sei="140.00299001/2026-08", cnpj_cpf="98.765.432/0001-10",
                       razao_social="Vistorias SP", agente_regulado="ECV",
                       segmento="Veiculos", data_recebimento=date(2026, 1, 15)),
    ])
    _s.commit()


def _override_db():
    db = _TestSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_db
app.dependency_overrides[get_current_user] = lambda: UsuarioAutenticado(
    email="teste@local", nome="Teste", roles=[])

# base_url com /api: as rotas da API vivem sob esse prefixo (ver app/main.py e
# tests/test_prefixo_api.py). Dar a base ao cliente evita reescrever cada uma das
# chamadas espalhadas pelos testes.
client = TestClient(app, base_url="http://testserver/api")


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_me():
    r = client.get("/me")
    assert r.status_code == 200
    assert r.json()["email"] == "teste@local"


def test_listar_tudo():
    dados = client.get("/caixa-entrada").json()
    assert {d["numero_sei"] for d in dados} >= {"140.00286276/2026-27", "140.00299001/2026-08"}


def test_busca_com_mascara():
    dados = client.get("/caixa-entrada", params={"busca": "140.00286276/2026-27"}).json()
    assert len(dados) == 1
    assert dados[0]["agente_regulado"] == "Autoescola"


def test_busca_sem_mascara_por_fragmento():
    dados = client.get("/caixa-entrada", params={"busca": "00286276"}).json()
    assert len(dados) == 1
    assert dados[0]["numero_sei"] == "140.00286276/2026-27"


def test_busca_por_cnpj_sem_mascara():
    dados = client.get("/caixa-entrada", params={"busca": "98765432000110"}).json()
    assert len(dados) == 1
    assert dados[0]["agente_regulado"] == "ECV"


def test_filtra_por_agente():
    dados = client.get("/caixa-entrada", params={"agente": "ECV"}).json()
    assert len(dados) == 1 and dados[0]["segmento"] == "Veiculos"


def test_filtra_por_data_inicio():
    dados = client.get("/caixa-entrada", params={"data_inicio": "2026-01-12"}).json()
    assert len(dados) == 1 and dados[0]["numero_sei"] == "140.00299001/2026-08"


def test_lista_agentes():
    agentes = client.get("/caixa-entrada/agentes").json()
    assert "Autoescola" in agentes and "ECV" in agentes


# --- Ordenação da listagem -------------------------------------------------
# A ordem é resolvida no banco porque a rota devolve no máximo `limit` itens:
# ordenando só o que já chegou na tela, "mais antigo primeiro" mostraria o mais
# antigo da página, não do conjunto. Os dois itens semeados no topo do arquivo
# servem de referência: Auto Escola Modelo (10/01) e Vistorias SP (15/01).
_MAIS_ANTIGO = "140.00286276/2026-27"   # Auto Escola Modelo
_MAIS_RECENTE = "140.00299001/2026-08"  # Vistorias SP


def _ordem(**params) -> list[str]:
    """Números SEI na ordem devolvida, restritos aos dois itens conhecidos."""
    dados = client.get("/caixa-entrada", params=params).json()
    conhecidos = {_MAIS_ANTIGO, _MAIS_RECENTE}
    return [d["numero_sei"] for d in dados if d["numero_sei"] in conhecidos]


def test_ordem_padrao_e_data_decrescente():
    assert _ordem() == [_MAIS_RECENTE, _MAIS_ANTIGO]


def test_ordena_por_data_crescente():
    assert _ordem(ordenar_por="data_recebimento", ordem="asc") == [_MAIS_ANTIGO, _MAIS_RECENTE]


def test_ordena_por_data_decrescente():
    assert _ordem(ordenar_por="data_recebimento", ordem="desc") == [_MAIS_RECENTE, _MAIS_ANTIGO]


def test_ordena_por_razao_social_crescente():
    # "Auto Escola Modelo" antes de "Vistorias SP"
    assert _ordem(ordenar_por="razao_social", ordem="asc") == [_MAIS_ANTIGO, _MAIS_RECENTE]


def test_ordena_por_razao_social_decrescente():
    assert _ordem(ordenar_por="razao_social", ordem="desc") == [_MAIS_RECENTE, _MAIS_ANTIGO]


def test_coluna_de_ordenacao_desconhecida_cai_no_padrao():
    """Coluna inválida não pode virar erro: a tela ficaria vazia sem explicação."""
    r = client.get("/caixa-entrada", params={"ordenar_por": "coluna_que_nao_existe"})
    assert r.status_code == 200
    assert _ordem(ordenar_por="coluna_que_nao_existe") == [_MAIS_RECENTE, _MAIS_ANTIGO]


def test_ordenacao_preserva_os_filtros():
    dados = client.get(
        "/caixa-entrada",
        params={"busca": "00286276", "ordenar_por": "razao_social", "ordem": "asc"},
    ).json()
    assert [d["numero_sei"] for d in dados] == [_MAIS_ANTIGO]
