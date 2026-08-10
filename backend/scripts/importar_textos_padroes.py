"""Importa os textos-padrão do SEI para a tabela de templates do app.

Lê ``textos_padroes/*.txt`` (páginas HTML dos documentos, baixadas por
``scripts/baixar_textos_padroes_sei.py``), remove cabeçalho e rodapé — a API do
SEI aplica os seus ao criar o documento — e grava cada modelo em
``config_template_despacho``.

Cada registro é identificado por ``descricao_doc`` = ``<função>|<rótulo>`` e pelo
agente regulado. A **função** é o papel do documento no fluxo (``saneador``,
``arquivamento_relatorio``...) e o **rótulo** é o que diferencia as variantes
("COM DEFESA", "Sem irregular"). Ver ``app/services/classificacao_modelos.py``.

**Edição pelo coordenador.** O texto do SEI vai sempre para ``html_original``.
O texto em uso (``template_html``) só é atualizado enquanto ninguém tiver
editado o modelo na tela "Textos-padrão" — ``editado_em`` preenchido faz a
importação preservar o que está lá, e o final da execução lista os casos em que
o texto oficial mudou depois da edição, para o coordenador decidir. Modelos
editados também não são removidos quando o arquivo correspondente desaparece.

Modelos marcados como "ECV-EPIV" atendem duas classes e geram dois registros.
Modelos sem agente no nome entram como ``Qualquer``, e a busca no app tenta
primeiro o agente do processo e depois esse curinga.

Uso::

    cd backend/
    python scripts/importar_textos_padroes.py --listar
    python scripts/importar_textos_padroes.py --dry-run
    python scripts/importar_textos_padroes.py
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

BASE_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJETO = os.path.dirname(BASE_BACKEND)
load_dotenv(os.path.join(BASE_BACKEND, ".env"))

from sqlalchemy import select

from app.db import models as m
from app.db.base import Base, get_engine, get_sessionmaker
from app.services import classificacao_modelos as cm
from app.services.textos_padroes import extrair_corpo

PASTA_TEXTOS = os.path.join(PROJETO, "textos_padroes")

CORINGA = "Qualquer"

# Nome que o documento terá na árvore do SEI, por função. Sem entrada aqui,
# usa-se o título da função.
NOME_ARVORE: dict[str, str] = {
    "termo_instauracao": "Termo de instauração",
    "instauracao_aditamento": "Termo de instauração",
    "citacao": "Citação",
    "citacao_edital": "Citação por edital",
    "arquivamento_relatorio": "Despacho",
    "saneador": "Despacho saneador",
    "cautelar_manutencao": "Despacho",
    "cautelar_revogacao": "Despacho",
    "intimacao": "Intimação",
    "intimacao_alegacoes": "Intimação",
    "intimacao_alegacoes_edital": "Edital",
    "retorno_autos": "Despacho",
    "relatorio_opinativo": "Relatório opinativo",
    "despacho_opinativo": "Despacho",
    "parecer_merito": "Parecer",
    "encaminhamento_externo": "Despacho",
    "sei_externo": "Despacho",
    "decisao": "Decisão",
    "decisao_recurso": "Decisão",
    "portaria": "Portaria",
    "notificacao_recurso": "Notificação",
    "notificacao_decisao": "Notificação",
    "cobranca": "Notificação",
    "certidao": "Certidão",
    "certidao_decurso": "Certidão",
    "certidao_juntada": "Certidão",
    "certidao_acesso": "Certidão",
    "certidao_regularidade": "Certidão",
    "certidao_bloqueio": "Certidão",
    "certidao_atos": "Certidão",
    "termo_encerramento": "Termo de encerramento",
    "arquivamento_processo": "Despacho",
    "tac": "Termo de ajustamento de conduta",
    "oficio": "Ofício",
}


def importar(dry_run: bool = False, listar: bool = False) -> None:
    if not os.path.isdir(PASTA_TEXTOS):
        raise SystemExit(f"Pasta não encontrada: {PASTA_TEXTOS}")

    arquivos = sorted(f for f in os.listdir(PASTA_TEXTOS) if f.lower().endswith(".txt"))
    if not arquivos:
        raise SystemExit(f"Nenhum .txt em {PASTA_TEXTOS}")

    print(f"{len(arquivos)} arquivos em {PASTA_TEXTOS}\n")

    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    novos = atualizados = inalterados = removidos = preservados = 0
    nao_reconhecidos: list[str] = []
    # Modelos editados no app cujo texto oficial mudou no SEI: o coordenador
    # precisa decidir se incorpora a mudança.
    divergentes: list[str] = []
    # Editados no app que não têm mais arquivo correspondente.
    orfaos_editados: list[str] = []
    por_funcao: dict[str, list[str]] = defaultdict(list)
    esperados: set[tuple[str, str]] = set()

    with Session() as s:
        for arquivo in arquivos:
            nome_modelo = os.path.splitext(arquivo)[0]
            classificacao = cm.classificar(nome_modelo)
            if not classificacao:
                nao_reconhecidos.append(arquivo)
                continue

            funcao, classes, rotulo = classificacao
            chave = cm.chave(funcao, rotulo)
            nome_arvore = NOME_ARVORE.get(funcao, cm.titulo_da_funcao(funcao))
            destinos = classes or (CORINGA,)

            with open(os.path.join(PASTA_TEXTOS, arquivo), encoding="utf-8") as fh:
                corpo = extrair_corpo(fh.read())
            if not corpo:
                nao_reconhecidos.append(f"{arquivo} (corpo vazio após limpeza)")
                continue

            for agente in destinos:
                esperados.add((chave, agente))
                por_funcao[funcao].append(f"{agente:12} {rotulo}")

                if listar:
                    continue

                registro = s.query(m.ConfigTemplateDespacho).filter_by(
                    agente_regulado=agente, descricao_doc=chave,
                ).first()

                if registro is None:
                    if not dry_run:
                        s.add(m.ConfigTemplateDespacho(
                            agente_regulado=agente,
                            descricao_doc=chave,
                            template_html=corpo,
                            html_original=corpo,
                            nome_arvore=nome_arvore,
                        ))
                    novos += 1
                    continue

                # O texto do SEI entra sempre em html_original: é a referência
                # para o coordenador comparar e restaurar.
                mudou_original = registro.html_original != corpo
                if not dry_run:
                    registro.html_original = corpo
                    registro.nome_arvore = nome_arvore

                if registro.editado_em is not None:
                    # Editado no app: o texto em uso é do coordenador e fica.
                    # Sobrescrever aqui apagaria o ajuste sem aviso.
                    preservados += 1
                    if mudou_original:
                        divergentes.append(
                            f"{chave} [{agente}] editado por "
                            f"{registro.editado_por or 'desconhecido'}"
                        )
                elif registro.template_html != corpo or mudou_original:
                    if not dry_run:
                        registro.template_html = corpo
                    atualizados += 1
                else:
                    inalterados += 1

        if listar:
            for funcao in sorted(por_funcao):
                print(f"=== {funcao}  ({cm.titulo_da_funcao(funcao)}) ===")
                for linha in sorted(por_funcao[funcao]):
                    print(f"    {linha}")
                print()
            print(f"Funções distintas: {len(por_funcao)}")
            if nao_reconhecidos:
                print("\nNão reconhecidos:")
                for nome in nao_reconhecidos:
                    print(f"  ! {nome}")
            return

        # Remove o que não corresponde mais a nenhum arquivo. Sem isso, os
        # modelos da coleta anterior ficariam no banco competindo com os novos.
        # Exceção: o que o coordenador editou no app fica, com aviso — apagar
        # aqui destruiria um texto que só existe no banco.
        for registro in s.scalars(select(m.ConfigTemplateDespacho)).all():
            if (registro.descricao_doc, registro.agente_regulado) in esperados:
                continue
            rotulo = f"{registro.descricao_doc:<46} {registro.agente_regulado:<12}"
            if registro.editado_em is not None:
                print(f"  ! {rotulo} (sem arquivo, MANTIDO: editado no app)")
                orfaos_editados.append(
                    f"{registro.descricao_doc} [{registro.agente_regulado}]"
                )
                continue
            print(f"  - {rotulo} (sem arquivo)")
            if not dry_run:
                s.delete(registro)
            removidos += 1

        if not dry_run:
            s.commit()

    print(
        f"\nnovos: {novos} | atualizados: {atualizados} | sem mudança: {inalterados}"
        f" | removidos: {removidos} | preservados (editados no app): {preservados}"
    )
    print(f"funções distintas: {len(por_funcao)}")
    if divergentes:
        print(
            "\nEditados no app, mas o texto oficial mudou no SEI. O texto em uso "
            "continua sendo o do coordenador; a tela mostra a diferença e permite "
            "restaurar o original:"
        )
        for nome in divergentes:
            print(f"  ~ {nome}")
    if orfaos_editados:
        print(
            "\nEditados no app e sem arquivo correspondente (mantidos, não "
            "removidos):"
        )
        for nome in orfaos_editados:
            print(f"  ! {nome}")
    if nao_reconhecidos:
        print("\nNão importados (nome não reconhecido — confira classificacao_modelos.py):")
        for nome in nao_reconhecidos:
            print(f"  ! {nome}")
    if dry_run:
        print("\n[DRY-RUN] Nada foi gravado.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa os textos-padrão do SEI para o banco.")
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que faria, sem gravar.")
    parser.add_argument(
        "--listar", action="store_true",
        help="Só mostra a classificação por função, sem tocar no banco.",
    )
    args = parser.parse_args()
    importar(dry_run=args.dry_run, listar=args.listar)


if __name__ == "__main__":
    main()
