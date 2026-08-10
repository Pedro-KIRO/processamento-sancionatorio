"""Prepara ``config_template_despacho`` para a edição pelo coordenador.

Acrescenta quatro colunas e preenche ``html_original`` com o texto atual:

- ``padrao``: marca a variante escolhida como padrão do app para aquela função e
  agente. Há mais de uma variante por função (quatro saneadores de autoescola,
  nove arquivamentos de relatório de perito), e é essa marca que diz qual vem
  selecionada na tela do analista.
- ``html_original``: o texto como veio do SEI, para permitir desfazer a edição.
  É também o campo que a reimportação atualiza.
- ``editado_em`` / ``editado_por``: registram a edição feita no app. Enquanto
  estiverem preenchidos, ``scripts/importar_textos_padroes.py`` não sobrescreve
  ``template_html``.

O `create_all` do SQLAlchemy só cria tabelas novas, então as colunas são
adicionadas aqui por ``ALTER TABLE``. É uma operação aditiva: nenhum dado
existente é alterado ou removido. Rodar duas vezes não faz efeito (só cria o
que falta e só preenche ``html_original`` de quem está sem).

Uso::

    cd backend/
    python scripts/migrar_edicao_textos_padroes.py --dry-run
    python scripts/migrar_edicao_textos_padroes.py
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

BASE_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_BACKEND, ".env"))

from sqlalchemy import inspect, select, text

from app.db import models as m
from app.db.base import get_engine, get_sessionmaker

TABELA = "config_template_despacho"

# Uma entrada por coluna: (nome, tipo SQL). Os tipos valem para SQLite e para
# SQL Server, que é o destino em produção.
COLUNAS = (
    ("padrao", "BOOLEAN DEFAULT 0"),
    ("html_original", "TEXT"),
    ("editado_em", "DATETIME"),
    ("editado_por", "VARCHAR(255)"),
)


def colunas_existentes(engine) -> set[str]:
    return {c["name"] for c in inspect(engine).get_columns(TABELA)}


def adicionar_colunas(engine, dry_run: bool) -> int:
    presentes = colunas_existentes(engine)
    criadas = 0
    for nome, tipo in COLUNAS:
        if nome in presentes:
            print(f"  = {nome:<16} já existe")
            continue
        print(f"  + {nome:<16} ausente: adicionando ({tipo})")
        if not dry_run:
            with engine.begin() as conexao:
                conexao.execute(text(f"ALTER TABLE {TABELA} ADD COLUMN {nome} {tipo}"))
        criadas += 1
    return criadas


def preencher_original(Session, dry_run: bool) -> int:
    """Copia o texto em uso para html_original em quem ainda não tem.

    Sem isso o botão "restaurar o original" não teria com o que comparar nos
    modelos já importados.
    """
    with Session() as s:
        pendentes = s.scalars(
            select(m.ConfigTemplateDespacho).where(
                m.ConfigTemplateDespacho.html_original.is_(None)
            )
        ).all()

        print(f"\nRegistros sem html_original: {len(pendentes)}")
        for registro in pendentes:
            if not dry_run:
                registro.html_original = registro.template_html
        if not dry_run:
            s.commit()
        return len(pendentes)


def normalizar_padrao(Session, dry_run: bool) -> None:
    """Deixa `padrao` como falso onde ficou nulo (linhas anteriores ao ALTER)."""
    with Session() as s:
        nulos = s.scalars(
            select(m.ConfigTemplateDespacho).where(
                m.ConfigTemplateDespacho.padrao.is_(None)
            )
        ).all()
        if nulos:
            print(f"Registros com padrao nulo: {len(nulos)} — ajustando para falso.")
            for registro in nulos:
                if not dry_run:
                    registro.padrao = False
            if not dry_run:
                s.commit()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Adiciona as colunas de edição em config_template_despacho."
    )
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que faria.")
    args = parser.parse_args()

    engine = get_engine()
    if TABELA not in inspect(engine).get_table_names():
        raise SystemExit(
            f"Tabela {TABELA} não existe. Rode primeiro "
            "scripts/importar_textos_padroes.py."
        )

    print(f"Tabela {TABELA}: verificando colunas")
    criadas = adicionar_colunas(engine, args.dry_run)

    Session = get_sessionmaker(engine)
    if args.dry_run and criadas:
        print("\n[DRY-RUN] Colunas não criadas, então não há como preencher.")
    else:
        preenchidos = preencher_original(Session, args.dry_run)
        normalizar_padrao(Session, args.dry_run)
        print(f"\ncolunas criadas: {criadas} | html_original preenchido: {preenchidos}")

    if args.dry_run:
        print("\n[DRY-RUN] Nada foi gravado.")


if __name__ == "__main__":
    main()
