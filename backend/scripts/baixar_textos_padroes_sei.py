"""Baixa os textos-padrão do processo SEI onde a área os cadastrou.

A área montou um processo com todos os modelos de documento, um documento por
modelo. Este script lê esse processo, baixa o conteúdo de cada documento e grava
em ``textos_padroes/`` — substituindo a coleta manual anterior.

Só interessam os documentos **a partir de um marco**: os anteriores são versões
que a área descartou. O marco padrão é o despacho 47 ("PERITOS - Relatório -
Arqui - Sem irregular").

**Nome do modelo:** a listagem de documentos devolve apenas série e número
("DETRAN - Despacho 47"). O que identifica o modelo é o ``nomeArvore``
("PERITOS - Relatório - Arqui - Sem irregular"), que só vem em
``consultarDocumento`` — por isso o script consulta cada documento antes de
baixar, e guarda o resultado em cache para não repetir as chamadas.

Uso::

    cd backend/
    python scripts/baixar_textos_padroes_sei.py --listar
    python scripts/baixar_textos_padroes_sei.py --dry-run
    python scripts/baixar_textos_padroes_sei.py --limpar
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import unicodedata
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

BASE_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJETO = os.path.dirname(BASE_BACKEND)
load_dotenv(os.path.join(BASE_BACKEND, ".env"))

PASTA_DESTINO = os.path.join(PROJETO, "textos_padroes")
CACHE_METADADOS = os.path.join(BASE_BACKEND, ".cache_textos_padroes.json")

PROCESSO_PADRAO = "140.00146432/2026-18"
UNIDADE_PADRAO = "110053117"  # ECV / Estampadora
# Documento a partir do qual os modelos valem (o "DETRAN - Despacho 47").
MARCO_PADRAO = "0115729809"

# Consultas simultâneas ao SEI. Seis é o limite prático medido em produção:
# acima disso a API começa a responder 500 por concorrência.
SIMULTANEAS = 6


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    ).lower()


def _nome_de_arquivo(nome: str) -> str:
    """Nome de arquivo seguro, preservando o nome do modelo no SEI."""
    limpo = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", nome).strip(" .")
    limpo = re.sub(r"\s+", " ", limpo)
    return (limpo or "documento")[:180] + ".txt"


def _extrair_base64(resposta: dict) -> str:
    """Acha o base64 do conteúdo na resposta do app.

    A rota devolve ``{"numero", "nome", "tipo", "conteudo": {"idDocumento",
    "conteudo": "<base64>"}}`` para documentos internos — o base64 está um nível
    abaixo. Documentos externos usam ``arquivo``.
    """
    for chave in ("conteudo", "arquivo"):
        valor = resposta.get(chave)
        if isinstance(valor, str) and valor:
            return valor
        if isinstance(valor, dict):
            for interna in ("conteudo", "arquivo"):
                aninhado = valor.get(interna)
                if isinstance(aninhado, str) and aninhado:
                    return aninhado
    return ""


def _nome_completo(meta: dict, alternativo: str = "", numero_doc: str = "") -> str:
    """Nome como aparece na árvore do SEI: série + número + nomeArvore.

    Sem metadados, cai para o nome da listagem (só série e número, sem o
    complemento) com o número do documento anexado — vários documentos
    compartilham esse nome curto e sobrescreveriam o mesmo arquivo.
    """
    serie = ((meta.get("serie") or {}).get("nome") or "").strip()
    numero = str(meta.get("numero") or "").strip()
    arvore = (meta.get("nomeArvore") or "").strip()
    partes = [p for p in (serie, numero, arvore) if p]
    if partes:
        return " ".join(partes)

    base = (alternativo or "").strip() or "documento"
    return f"{base} ({numero_doc})" if numero_doc else base


def carregar_metadados(sei, documentos, unidade: str, usar_cache: bool = True) -> dict[str, dict]:
    """Metadados de cada documento, com cache em disco."""
    cache: dict[str, dict] = {}
    if usar_cache and os.path.exists(CACHE_METADADOS):
        try:
            with open(CACHE_METADADOS, encoding="utf-8") as fh:
                cache = json.load(fh)
        except Exception:  # noqa: BLE001
            cache = {}

    faltando = [d.numero for d in documentos if d.numero not in cache]
    if faltando:
        print(f"Consultando metadados de {len(faltando)} documentos...")

        def consultar(numero: str) -> tuple[str, dict | None]:
            try:
                return numero, sei.consultar_documento(numero, unidade)
            except Exception:  # noqa: BLE001
                return numero, None

        with ThreadPoolExecutor(max_workers=SIMULTANEAS) as pool:
            for numero, meta in pool.map(consultar, faltando):
                if meta:
                    cache[numero] = meta

        with open(CACHE_METADADOS, "w", encoding="utf-8") as fh:
            json.dump(cache, fh, ensure_ascii=False)

    return cache


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Baixa os textos-padrão do processo SEI de modelos.",
    )
    parser.add_argument("--processo", default=PROCESSO_PADRAO)
    parser.add_argument("--unidade", default=UNIDADE_PADRAO)
    parser.add_argument(
        "--marco", default=MARCO_PADRAO,
        help="Número do documento (ou trecho do nome) a partir do qual baixar.",
    )
    parser.add_argument("--listar", action="store_true", help="Só lista os documentos.")
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que baixaria.")
    parser.add_argument(
        "--limpar", action="store_true",
        help="Apaga os .txt existentes na pasta antes de gravar os novos.",
    )
    parser.add_argument("--sem-cache", action="store_true", help="Ignora o cache de metadados.")
    parser.add_argument(
        "--refazer", action="store_true",
        help="Rebaixa também os documentos que já estão na pasta. Por padrão só "
             "busca os que faltam, para retomar depois de instabilidade do SEI.",
    )
    args = parser.parse_args()

    from app.api.routes.documentos import (
        listar_documentos_por_procedimento,
        obter_conteudo_documento_por_numero,
    )
    from app.core.sei_shared import get_sei_client

    sei = get_sei_client(timeout=60)

    print(f"Consultando {args.processo} pela unidade {args.unidade}...")
    detalhes = sei.consultar_processo(args.processo, args.unidade)
    id_procedimento = str(detalhes.get("idProcedimento") or "")
    if not id_procedimento:
        raise SystemExit("Processo não localizado nessa unidade.")
    print(f"idProcedimento: {id_procedimento}")

    documentos = listar_documentos_por_procedimento(
        id_procedimento, id_unidade_hint=args.unidade,
    )
    print(f"Documentos no processo: {len(documentos)}")

    metadados = carregar_metadados(
        sei, documentos, args.unidade, usar_cache=not args.sem_cache,
    )
    print(f"Metadados obtidos: {len(metadados)}\n")

    nomes = {
        d.numero: _nome_completo(metadados.get(d.numero, {}), d.nome or "", d.numero)
        for d in documentos
    }

    alvo = _sem_acento(args.marco)
    indice_marco = next(
        (
            i for i, d in enumerate(documentos)
            if alvo == _sem_acento(d.numero) or alvo in _sem_acento(nomes[d.numero])
        ),
        None,
    )

    if args.listar or indice_marco is None:
        for i, d in enumerate(documentos):
            marca = " <== MARCO" if i == indice_marco else ""
            print(f"  {i:3} {d.numero:12} {nomes[d.numero]}{marca}")
        if indice_marco is None:
            print(f"\nMarco '{args.marco}' não encontrado.")
        if args.listar:
            return
        raise SystemExit(1)

    selecionados = documentos[indice_marco:]
    print(f"Marco na posição {indice_marco}: {nomes[documentos[indice_marco].numero]}")
    print(f"Documentos a baixar (do marco em diante): {len(selecionados)}\n")

    if args.dry_run:
        for d in selecionados:
            print(f"  {d.numero:12} {nomes[d.numero]}")
        print("\n[DRY-RUN] Nada foi baixado.")
        return

    os.makedirs(PASTA_DESTINO, exist_ok=True)

    if args.limpar:
        antigos = [f for f in os.listdir(PASTA_DESTINO) if f.lower().endswith(".txt")]
        for nome in antigos:
            os.remove(os.path.join(PASTA_DESTINO, nome))
        print(f"Removidos {len(antigos)} arquivos anteriores.\n")

    # Retomada: o SEI responde 500 de forma intermitente, então rodar de novo só
    # para o que faltou é o caminho normal.
    if not args.refazer:
        ja_baixados = {
            f for f in os.listdir(PASTA_DESTINO) if f.lower().endswith(".txt")
        }
        pendentes = [
            d for d in selecionados
            if _nome_de_arquivo(nomes[d.numero]) not in ja_baixados
        ]
        if len(pendentes) != len(selecionados):
            print(
                f"Já na pasta: {len(selecionados) - len(pendentes)} | "
                f"a buscar: {len(pendentes)}\n"
            )
        selecionados = pendentes

    if not selecionados:
        print("Nada a baixar: todos os documentos do marco em diante já estão na pasta.")
        return

    def baixar(documento) -> tuple[str, str | None, str | None]:
        """Devolve ``(numero, texto, erro)``."""
        try:
            resposta = obter_conteudo_documento_por_numero(
                documento.numero, tipo_doc=documento.tipo, id_unidade_hint=args.unidade,
            )
        except Exception as exc:  # noqa: BLE001
            return documento.numero, None, f"{type(exc).__name__}: {str(exc)[:90]}"

        conteudo_b64 = _extrair_base64(resposta)
        if not conteudo_b64:
            return documento.numero, None, "sem conteúdo na resposta"

        try:
            bruto = base64.b64decode(conteudo_b64)
        except Exception:  # noqa: BLE001
            return documento.numero, None, "conteúdo não é base64 válido"

        # O SEI devolve HTML em ISO-8859-1 na maioria dos documentos internos.
        for codificacao in ("utf-8", "iso-8859-1", "cp1252"):
            try:
                return documento.numero, bruto.decode(codificacao), None
            except UnicodeDecodeError:
                continue
        return documento.numero, None, "não foi possível decodificar"

    baixados = 0
    falhas: list[str] = []
    usados: set[str] = set()
    with ThreadPoolExecutor(max_workers=SIMULTANEAS) as pool:
        for numero, texto, erro in pool.map(baixar, selecionados):
            nome = nomes.get(numero, numero)
            if erro or texto is None:
                falhas.append(f"{numero} {nome}: {erro}")
                continue

            arquivo = _nome_de_arquivo(nome)
            # Dois modelos podem ter o mesmo nome na árvore; sem isto o segundo
            # sobrescreveria o primeiro em silêncio.
            if arquivo in usados:
                arquivo = _nome_de_arquivo(f"{nome} ({numero})")
            usados.add(arquivo)

            caminho = os.path.join(PASTA_DESTINO, arquivo)
            with open(caminho, "w", encoding="utf-8") as fh:
                fh.write(texto)
            baixados += 1
            print(f"  + {arquivo} ({len(texto)} caracteres)")

    print(f"\nBaixados: {baixados} | falhas: {len(falhas)}")
    for f in falhas:
        print(f"  ! {f}")


if __name__ == "__main__":
    main()
