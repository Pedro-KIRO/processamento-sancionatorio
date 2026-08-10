"""Adota o vocabulário único de agente regulado em todas as tabelas.

O app nasceu com dois vocabulários: o do app de fiscalização ("Empresas
credenciadas de vistoria – Remota", "Médicos") e o do CPSAR ("ECV", "Peritos").
As tabelas de configuração usam o segundo, no plural, e a Consulta Unificada
passou a usar as seis classes canônicas de ``app/services/agentes_regulados.py``.
Este script leva todas as tabelas para essas seis classes.

**Colisão tratada:** ``config_tipo_procedimento`` tem um ``idTipoProcedimento``
diferente para Clínicas, Médicos e Psicólogos, e os três viram Perito. Como
``GET /processos/tipos`` confirmou que o SEI não tem tipo único de "Perito",
esses três registros viram ``Perito | Clínica``, ``Perito | Médico`` e
``Perito | Psicólogo`` — a chave que ``_buscar_id_tipo_procedimento`` monta a
partir de ``CaixaEntrada.agente_origem``.

Vale registrar que essa distinção **já estava perdida** antes: a varredura
gravava só a classe consolidada, e não existia linha correspondente em
``config_tipo_procedimento`` — a busca nunca achava e caía no fallback. A coluna
``agente_origem`` (ver ``scripts/migrar_agente_origem.py``) é o que a recupera.

Uso::

    cd backend/
    python scripts/renomear_agentes.py --dry-run
    python scripts/renomear_agentes.py
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

BASE_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_BACKEND, ".env"))

from sqlalchemy import select

from app.db import models as m
from app.db.base import get_engine, get_sessionmaker
from app.services.agentes_regulados import normalizar

# Tabelas com a coluna agente_regulado. A ordem é só para o relatório.
TABELAS = [
    ("caixa_entrada", m.CaixaEntrada),
    ("consulta_unificada", m.ConsultaUnificada),
    ("config_unidade", m.ConfigUnidade),
    ("config_bloco_assinatura", m.ConfigBlocoAssinatura),
    ("config_template_despacho", m.ConfigTemplateDespacho),
    ("config_tipo_procedimento", m.ConfigTipoProcedimento),
]

# Valor usado pelos templates genéricos: não é agente, não deve ser tocado.
CORINGA = "Qualquer"

# Chaves de subclasse: o SEI tem um tipo de procedimento para Clínica, outro
# para Médico e outro para Psicólogo, e nenhum tipo único de "Perito" (conferido
# em GET /processos/tipos). Consolidar os três em "Perito" faria a instauração
# escolher um ao acaso, então eles viram "Perito | <subclasse>", que é a chave
# montada por _buscar_id_tipo_procedimento a partir de CaixaEntrada.agente_origem.
SEPARADOR_SUBCLASSE = " | "

RENOMEAR_PARA_SUBCLASSE = {
    ("config_tipo_procedimento", "Clínicas"): f"Perito{SEPARADOR_SUBCLASSE}Clínica",
    ("config_tipo_procedimento", "Médicos"): f"Perito{SEPARADOR_SUBCLASSE}Médico",
    ("config_tipo_procedimento", "Psicólogos"): f"Perito{SEPARADOR_SUBCLASSE}Psicólogo",
}

# Registros que ficariam ambíguos se renomeados. Ver docstring.
NAO_RENOMEAR = {
    # Dois termos de instauração distintos para desmonte (lei estadual e
    # federal). A importação dos textos-padrão já separa por chave de documento
    # (termo_instauracao_lei_estadual / _lei_federal); estas duas linhas vieram
    # do SharePoint e colidiriam sob a mesma descricao_doc.
    ("config_template_despacho", "Desmontes Lei Estadual"),
    ("config_template_despacho", "Desmontes Lei Federal"),
}


def renomear(dry_run: bool = False) -> None:
    Session = get_sessionmaker(get_engine())

    total_renomeados = 0
    total_mantidos = 0
    pendencias: list[str] = []

    with Session() as s:
        for nome_tabela, modelo in TABELAS:
            print("=" * 74)
            print(nome_tabela)
            print("=" * 74)

            registros = s.scalars(select(modelo)).all()
            mudancas: dict[tuple[str, str], int] = defaultdict(int)
            mantidos: dict[str, int] = defaultdict(int)

            for registro in registros:
                atual = registro.agente_regulado
                if not atual or atual == CORINGA:
                    continue

                if (nome_tabela, atual) in NAO_RENOMEAR:
                    mantidos[atual] += 1
                    continue

                subclasse = RENOMEAR_PARA_SUBCLASSE.get((nome_tabela, atual))
                if subclasse:
                    if not dry_run:
                        registro.agente_regulado = subclasse
                    mudancas[(atual, subclasse)] += 1
                    continue

                # Chave de subclasse já aplicada: normalizar devolveria "Perito"
                # e desfaria a distinção. O script precisa ser idempotente.
                if SEPARADOR_SUBCLASSE in atual:
                    mantidos[atual] += 1
                    continue

                destino = normalizar(atual)
                if destino is None:
                    # Classe fora do app: o registro de configuração fica onde
                    # está, apenas deixa de ser usado. Apagar removeria o
                    # histórico de para onde aquela unidade apontava.
                    mantidos[atual] += 1
                    continue

                if destino != atual:
                    if not dry_run:
                        registro.agente_regulado = destino
                    mudancas[(atual, destino)] += 1

            for (origem, destino), n in sorted(mudancas.items()):
                print(f"  {n:6}  {origem:26} -> {destino}")
                total_renomeados += n

            for valor, n in sorted(mantidos.items()):
                if (nome_tabela, valor) in NAO_RENOMEAR:
                    motivo = "ambíguo, decisão pendente"
                    pendencias.append(f"{nome_tabela}.{valor}")
                elif SEPARADOR_SUBCLASSE in valor:
                    motivo = "chave de subclasse, já correta"
                else:
                    motivo = "fora do app, não usado"
                print(f"  {n:6}  {valor:26} (mantido: {motivo})")
                total_mantidos += n

            if not mudancas and not mantidos:
                print("  (nada a fazer)")
            print()

        if not dry_run:
            s.commit()

    print("=" * 74)
    print(f"Renomeados: {total_renomeados} | mantidos: {total_mantidos}")
    if pendencias:
        print("\nDecisão pendente da área (registros ambíguos, não renomeados):")
        for p in pendencias:
            print(f"  - {p}")
        print(
            "\n  config_template_despacho: há dois termos de instauração para desmonte\n"
            "  (lei estadual e lei federal). A importação dos textos-padrão já separa\n"
            "  por chave de documento; estas linhas antigas do SharePoint seguem como\n"
            "  estão até a área confirmar qual delas continua valendo."
        )
    if dry_run:
        print("\n[DRY-RUN] Nada foi gravado.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Adota o vocabulário único de agente regulado nas tabelas.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que faria, sem gravar.")
    args = parser.parse_args()
    renomear(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
