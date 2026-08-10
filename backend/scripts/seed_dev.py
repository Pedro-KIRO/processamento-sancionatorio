"""Popula o banco local com itens de exemplo na Caixa de Entrada (desenvolvimento).

Uso (a partir de backend/):
    python scripts/seed_dev.py
Assim a tela da Caixa de Entrada já mostra dados sem precisar da migração real.
Idempotente: limpa a tabela e recria o conjunto de exemplos.
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.base import Base, get_engine, get_sessionmaker  # noqa: E402
from app.db import models as m  # noqa: E402


EXEMPLOS = [
    dict(numero_sei="140.00286276/2026-27", protocolo_limpo="14000286276202627", id_procedimento="98765001", cnpj_cpf="12.345.678/0001-99", razao_social="Auto Escola Modelo Ltda", agente_regulado="Autoescola", segmento="Educacao", tipo_documento="Relatorio de Fiscalizacao", data_recebimento=date(2026, 1, 10)),
    dict(numero_sei="140.00299001/2026-08", protocolo_limpo="14000299001202608", id_procedimento="98765002", cnpj_cpf="98.765.432/0001-10", razao_social="Vistorias Sao Paulo S.A.", agente_regulado="ECV", segmento="Veiculos", tipo_documento="Relatorio de Fiscalizacao", data_recebimento=date(2026, 1, 15)),
    dict(numero_sei="140.00301122/2026-55", protocolo_limpo="14000301122202655", id_procedimento="98765003", cnpj_cpf="123.456.789-09", razao_social="Dra. Maria Souza - Medicina do Trafego", agente_regulado="Peritos", segmento="Condutores", tipo_documento="Relatorio de Fiscalizacao", data_recebimento=date(2026, 2, 3)),
    dict(numero_sei="140.00312233/2026-71", protocolo_limpo="14000312233202671", id_procedimento="98765004", cnpj_cpf="11.222.333/0001-44", razao_social="Estampadora Placa Forte Ltda", agente_regulado="EPIV", segmento="Veiculos", tipo_documento="Relatorio de Fiscalizacao", data_recebimento=date(2026, 2, 18)),
    dict(numero_sei="140.00325544/2026-90", protocolo_limpo="14000325544202690", id_procedimento="98765005", cnpj_cpf="22.333.444/0001-55", razao_social="Desmonte Central de Pecas Ltda", agente_regulado="Desmontes", segmento="Veiculos", tipo_documento="Relatorio de Fiscalizacao", data_recebimento=date(2026, 3, 1)),
]


def main() -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)
    with Session() as s:
        s.query(m.CaixaEntrada).delete()
        s.query(m.Anotacao).delete()
        for dados in EXEMPLOS:
            s.add(m.CaixaEntrada(status_triagem="pendente", **dados))
        s.commit()

        # Adicionar anotações de exemplo no primeiro item
        primeiro = s.query(m.CaixaEntrada).first()
        if primeiro:
            s.add(m.Anotacao(
                caixa_entrada_id=primeiro.id,
                autor="Supervisor Almeida",
                texto="Favor verificar se o agente regulado possui outros processos ativos.",
            ))
            s.add(m.Anotacao(
                caixa_entrada_id=primeiro.id,
                autor="Desenvolvimento",
                texto="Já verifiquei no sistema. Não constam outros processos ativos para este CNPJ.",
            ))
            s.commit()

        total = s.query(m.CaixaEntrada).count()
        total_anot = s.query(m.Anotacao).count()
    print(f"Seed concluido. Itens na caixa_entrada: {total}, anotacoes: {total_anot}")


if __name__ == "__main__":
    main()
