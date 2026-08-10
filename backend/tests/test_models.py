"""Testes do modelo de dados (SQLite em memória)."""
from datetime import date

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.db import models as m


def make_session():
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, future=True)()


def test_cria_processo_com_agente_fase_e_prazo():
    s = make_session()
    agente = m.AgenteRegulado(
        tipo="Autoescola", segmento="Educacao",
        razao_social="CFC Exemplo", cnpj_cpf="12345678000199",
    )
    proc = m.Processo(
        numero_sei="0001123456202600",
        data_instauracao=date(2026, 1, 10),
        agente=agente,
    )
    proc.fases.append(m.FaseProcesso(fase="Instaurado", data_fase=date(2026, 1, 10)))
    proc.prazos.append(m.Prazo(tipo="Defesa", data_limite=date(2026, 2, 10), situacao="aberto"))
    s.add(proc)
    s.commit()

    out = s.scalars(select(m.Processo)).all()
    assert len(out) == 1
    assert out[0].agente.razao_social == "CFC Exemplo"
    assert out[0].fases[0].fase == "Instaurado"
    assert out[0].prazos[0].tipo == "Defesa"


def test_tabelas_principais_existem():
    make_session()
    nomes = set(Base.metadata.tables.keys())
    esperado = {
        "agente_regulado", "relatorio", "caixa_entrada", "processo",
        "fase_processo", "prazo", "cautelar", "feriado", "usuario",
        "historico_despacho",
    }
    assert esperado <= nomes
