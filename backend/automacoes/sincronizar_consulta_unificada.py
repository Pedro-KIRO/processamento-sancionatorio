"""Automação: alimenta a tabela da tela "Consulta Unificada".

Três etapas, da mais barata para a mais cara:

1. **Relatórios** (Graph, sem SEI): lê a ``listaDesignacao`` inteira e faz
   upsert de uma linha por fiscalização. Traz número SEI, agente, razão social,
   CNPJ, município e a situação (``statusAndamento``).
2. **Processos** (só banco local): uma linha para cada item da caixa de entrada
   cuja triagem criou processo sancionatório, já com a fase atual.
3. **Datas do SEI**: ``data_criacao_sei`` e ``data_ultima_acao`` saem de
   ``GET /processos/{numero}?sinRetornarUltimoAndamento=true`` — **uma chamada
   por linha**, que já devolve a data de autuação (a criação no SEI), o
   ``idProcedimento`` e o último andamento. Como toda linha tem número SEI,
   toda linha consegue data: basta o número, não é preciso conhecer o
   ``idProcedimento`` de antemão.

Uso::

    cd backend/
    python -m automacoes.sincronizar_consulta_unificada --dry-run
    python -m automacoes.sincronizar_consulta_unificada
    python -m automacoes.sincronizar_consulta_unificada --desde-ano 2026 --max-datas 200
    python -m automacoes.sincronizar_consulta_unificada --so-datas
    python -m automacoes.sincronizar_consulta_unificada --so-datas --todas-datas

A carga inicial (~19 mil linhas) é a única execução longa; use
``--todas-datas``, que percorre tudo em paralelo e grava em lotes, então pode
ser interrompida e retomada sem perder o que já foi feito. Depois disso, o dia
a dia é uma execução diária das três etapas.
"""
from __future__ import annotations

import argparse
import logging
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from sqlalchemy import or_, select

from app.db import models as m
from app.db.base import Base, get_engine, get_sessionmaker
from app.services.agentes_regulados import normalizar as normalizar_agente

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

SITE_DCAN_PATH = "/teams/DETRAN-DCAN"
LISTA_DESIGNACAO_ID = "2855ddc6-c7e4-4b1a-a972-5bb939f378d3"

# Unidades do processamento, usadas para consultar andamentos quando não
# sabemos de antemão qual unidade detém o processo.
UNIDADES_CONSULTA = ["110051045", "110051042", "110053117", "110051044", "110051043", "110053119"]

# Agente regulado → unidade provável, por palavra-chave.
#
# Por que heurística e não a tabela ``config_unidade``: aquela tabela usa o
# vocabulário do CPSAR (Peritos, ECV, EPIV, Desmontes...), enquanto a
# listaDesignacao usa o da fiscalização ("Empresas credenciadas de vistoria –
# Remota", "Centros de formação de condutores – CFC B", "Renave"...). Os dois
# quase não se cruzam, então a correspondência é por palavra-chave.
#
# Acertar a unidade na primeira tentativa é o que torna a carga viável: sem
# isso, cada linha testava até seis unidades e levava ~3s em vez de ~1s. Errar
# não quebra nada — as demais unidades continuam sendo tentadas em seguida.
UNIDADE_POR_PALAVRA: list[tuple[tuple[str, ...], str]] = [
    (("despachante",), "110053119"),
    (("pátio", "patio"), "110053119"),
    (("vistoria", "ecv"), "110053117"),
    (("estampadora", "piv", "placa"), "110053117"),
    (("desmonte", "desmanche", "renave", "peças", "pecas"), "110051044"),
    (("médico", "medico", "psicólog", "psicolog", "perito", "clínica", "clinica"), "110051045"),
    (("instituiç", "instituic", "poupatempo"), "110051043"),
    (("autoescola", "formação de condutores", "formacao de condutores", "cfc"), "110051042"),
]


def _unidade_provavel(agente: str | None) -> str | None:
    """Unidade que provavelmente detém o processo daquele agente regulado."""
    texto = (agente or "").lower()
    if not texto:
        return None
    for palavras, unidade in UNIDADE_POR_PALAVRA:
        if any(p in texto for p in palavras):
            return unidade
    return None

# Situações que não interessam na consulta (fiscalização descartada).
SITUACOES_IGNORADAS = {"excluido", "excluído"}

# Quantas linhas têm as datas buscadas no SEI por execução. Cada linha custa
# uma chamada à API, então o limite mantém o ciclo com duração previsível.
MAX_DATAS_POR_CICLO = 500

# Consultas simultâneas ao SEI. Medido em produção: com 8 a taxa de erro
# temporário ficou em ~5%, com 16 subiu para ~16%. Seis é o ponto em que a carga
# anda rápido sem o SEI começar a devolver 500 por concorrência.
CONSULTAS_SIMULTANEAS = 6

# Linhas gravadas por commit. Lotes pequenos deixam a execução retomável: o que
# já foi consultado fica no banco mesmo se a automação for interrompida.
TAMANHO_LOTE = 200

# Repescagem das linhas que não obtiveram data (ver docstring de
# sincronizar_datas: o SEI usa 500 tanto para "não é desta unidade" quanto para
# instabilidade).
MAX_PASSADAS_DATAS = 3
PAUSA_ENTRE_PASSADAS_S = 20


def _so_digitos(valor: str | None) -> str:
    return re.sub(r"\D", "", str(valor or ""))


def _agora_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _data_br(valor: str | None) -> date | None:
    """Converte data do SEI para ``date``.

    Aceita ``dd/mm/aaaa`` e ``dd/mm/aaaa hh:mm:ss`` — a primeira forma vem de
    ``dataAutuacao``, a segunda de ``ultimoAndamento.dataHora``.
    """
    if not valor:
        return None
    try:
        partes = str(valor).strip().split(" ")[0].split("/")
        return date(int(partes[2]), int(partes[1]), int(partes[0]))
    except (ValueError, IndexError):
        return None


# ==============================================================================
# Etapa 1 — relatórios da listaDesignacao
# ==============================================================================
def sincronizar_relatorios(Session, desde_ano: int | None, dry_run: bool = False) -> int:
    """Faz upsert de uma linha por fiscalização da listaDesignacao."""
    from app.core.sei_shared import get_graph_client

    try:
        graph, site_id = get_graph_client(SITE_DCAN_PATH)
    except Exception as e:  # noqa: BLE001
        logger.error("Graph indisponível (%s). Etapa de relatórios abortada.", e)
        return 0

    logger.info("=== Etapa 1: relatórios da listaDesignacao ===")

    vistos = 0
    gravados = 0
    ignorados = 0

    with Session() as s:
        # Índice das linhas de relatório já existentes, por id_relatorio
        existentes = {
            r.id_relatorio: r
            for r in s.scalars(
                select(m.ConsultaUnificada).where(m.ConsultaUnificada.tipo == "relatorio")
            ).all()
            if r.id_relatorio
        }
        logger.info("Relatórios já na tabela: %d", len(existentes))

        for campos in graph.iter_itens(site_id, LISTA_DESIGNACAO_ID, page_size=200):
            vistos += 1
            if vistos % 2000 == 0:
                logger.info("  ... %d itens lidos", vistos)

            id_relatorio = (campos.get("ID_Relatorio") or "").strip()
            numero_sei = (campos.get("numeroSei") or "").strip()
            situacao = (campos.get("statusAndamento") or "").strip()
            ano = (campos.get("Ano") or "").strip()

            # Sem número SEI não há o que consultar; excluídos não interessam.
            if not id_relatorio or not numero_sei:
                ignorados += 1
                continue
            if situacao.lower() in SITUACOES_IGNORADAS:
                ignorados += 1
                continue
            if desde_ano and ano.isdigit() and int(ano) < desde_ano:
                ignorados += 1
                continue

            # Consolida a classe do agente e descarta o que não é objeto de
            # processo sancionatório aqui (pátios, Renave, instituições de
            # ensino). Ver app/services/agentes_regulados.py.
            agente = normalizar_agente(campos.get("agenteRegulado"))
            if not agente:
                ignorados += 1
                continue

            dados = {
                "numero_sei": numero_sei,
                "numero_limpo": _so_digitos(numero_sei),
                "razao_social": (campos.get("razaoSocial") or "").strip() or None,
                "cnpj_cpf": (campos.get("cnpj") or "").strip() or None,
                "agente_regulado": agente,
                "municipio": (campos.get("cidade") or "").strip() or None,
                "ano": ano or None,
                "situacao": situacao or None,
            }

            registro = existentes.get(id_relatorio)
            if registro is None:
                if not dry_run:
                    s.add(m.ConsultaUnificada(
                        tipo="relatorio", id_relatorio=id_relatorio, **dados,
                    ))
                gravados += 1
            else:
                # Atualiza só se algo mudou, para não inflar o commit
                mudou = any(getattr(registro, campo) != valor for campo, valor in dados.items())
                if mudou:
                    if not dry_run:
                        for campo, valor in dados.items():
                            setattr(registro, campo, valor)
                    gravados += 1

        if not dry_run:
            s.commit()

    logger.info(
        "Etapa 1 concluída. Lidos: %d | gravados/atualizados: %d | ignorados: %d",
        vistos, gravados, ignorados,
    )
    return gravados


# ==============================================================================
# Etapa 2 — processos sancionatórios da nossa base
# ==============================================================================
def normalizar_agentes(Session, dry_run: bool = False) -> tuple[int, int]:
    """Consolida os nomes de agente já gravados e remove os fora do app.

    Necessário porque a tabela foi carregada antes da consolidação existir: sem
    isto, o filtro de agente continuaria mostrando "Centros de formação de
    condutores – CFC B" ao lado de "Autoescola", que são a mesma coisa.

    Devolve ``(renomeados, removidos)``.
    """
    logger.info("=== Etapa 1b: consolidação dos nomes de agente regulado ===")

    renomeados = 0
    removidos = 0

    with Session() as s:
        linhas = s.scalars(select(m.ConsultaUnificada)).all()
        for linha in linhas:
            canonico = normalizar_agente(linha.agente_regulado)
            if canonico is None:
                # Classe fora do app (ou sem agente): o registro sai da tabela.
                if not dry_run:
                    s.delete(linha)
                removidos += 1
            elif canonico != linha.agente_regulado:
                if not dry_run:
                    linha.agente_regulado = canonico
                renomeados += 1

        if not dry_run:
            s.commit()

    logger.info(
        "Etapa 1b concluída. Nomes consolidados: %d | registros removidos: %d",
        renomeados, removidos,
    )
    return renomeados, removidos


def vincular_relatorios_tramitados(Session, dry_run: bool = False) -> int:
    """Marca as linhas de relatório que já foram tramitadas ao processamento.

    O vínculo é o ``caixa_entrada_id``: preenchido, significa que aquele
    relatório chegou à nossa caixa de entrada; vazio, que ele só existe no app
    de fiscalização. É isso que o filtro "Fonte dos dados" usa na tela, e é
    mais amplo do que "tem processo instaurado" — um item pode estar na caixa
    aguardando triagem, ou ter sido arquivado, sem nunca virar processo.
    """
    logger.info("=== Etapa 2b: vínculo dos relatórios com a caixa de entrada ===")

    vinculados = 0
    with Session() as s:
        itens = s.scalars(select(m.CaixaEntrada)).all()
        por_relatorio = {i.id_relatorio: i.id for i in itens if i.id_relatorio}
        por_numero = {i.protocolo_limpo: i.id for i in itens if i.protocolo_limpo}

        linhas = s.scalars(
            select(m.ConsultaUnificada).where(m.ConsultaUnificada.tipo == "relatorio")
        ).all()

        for linha in linhas:
            alvo = por_relatorio.get(linha.id_relatorio) or por_numero.get(linha.numero_limpo)
            if alvo and linha.caixa_entrada_id != alvo:
                if not dry_run:
                    linha.caixa_entrada_id = alvo
                vinculados += 1

        if not dry_run:
            s.commit()

    logger.info("Etapa 2b concluída. Relatórios vinculados: %d", vinculados)
    return vinculados


def sincronizar_processos(Session, dry_run: bool = False) -> int:
    """Faz upsert de uma linha por processo sancionatório criado na triagem."""
    logger.info("=== Etapa 2: processos da caixa de entrada ===")

    gravados = 0

    with Session() as s:
        itens = s.scalars(
            select(m.CaixaEntrada).where(
                m.CaixaEntrada.numero_processo_sei.is_not(None),
                m.CaixaEntrada.numero_processo_sei != "",
            )
        ).all()

        existentes = {
            r.numero_limpo: r
            for r in s.scalars(
                select(m.ConsultaUnificada).where(m.ConsultaUnificada.tipo == "processo")
            ).all()
            if r.numero_limpo
        }

        for item in itens:
            numero = item.numero_processo_sei or ""
            limpo = _so_digitos(numero)
            if not limpo:
                continue

            # Fase atual = a mais recente registrada para o item
            fase = s.scalars(
                select(m.FaseProcessoAndamento)
                .where(m.FaseProcessoAndamento.caixa_entrada_id == item.id)
                .order_by(m.FaseProcessoAndamento.data_entrada.desc())
                .limit(1)
            ).first()

            dados = {
                "numero_sei": numero,
                "numero_limpo": limpo,
                "id_procedimento": item.id_procedimento_processo,
                "id_relatorio": item.id_relatorio,
                "razao_social": item.razao_social,
                "cnpj_cpf": item.cnpj_cpf,
                # Mesma consolidação aplicada aos relatórios, para as duas
                # origens usarem um vocabulário só nesta tela. A CaixaEntrada
                # continua com o nome do CPSAR ("Peritos", "EPIV"...), que é a
                # chave de config_unidade, config_bloco_assinatura e dos
                # modelos de documento — mexer nela quebraria essas buscas.
                "agente_regulado": normalizar_agente(item.agente_regulado) or item.agente_regulado,
                "municipio": item.municipio,
                "situacao": "Processo instaurado" if item.status_triagem == "instaurado" else (item.status_triagem or None),
                "fase_atual": fase.fase if fase else None,
                "caixa_entrada_id": item.id,
            }

            registro = existentes.get(limpo)
            if registro is None:
                if not dry_run:
                    s.add(m.ConsultaUnificada(tipo="processo", **dados))
                gravados += 1
            else:
                mudou = any(getattr(registro, campo) != valor for campo, valor in dados.items())
                if mudou:
                    if not dry_run:
                        for campo, valor in dados.items():
                            setattr(registro, campo, valor)
                    gravados += 1

        if not dry_run:
            s.commit()

    logger.info("Etapa 2 concluída. Processos gravados/atualizados: %d", gravados)
    return gravados


# ==============================================================================
# Etapa 3 — datas vindas dos andamentos do SEI (em rotação)
# ==============================================================================
def _ampliar_pool_http(sei, simultaneas: int) -> None:
    """Deixa o pool de conexões acompanhar o número de threads.

    A sessão padrão do ``requests`` mantém 10 conexões. Com mais threads que
    isso, ela passa a descartar e reabrir conexão a cada chamada ("Connection
    pool is full"), pagando handshake TLS toda vez. Ajuste local da automação —
    o cliente que o app web usa continua com o padrão.
    """
    import requests.adapters

    adaptador = requests.adapters.HTTPAdapter(
        pool_connections=max(10, simultaneas), pool_maxsize=max(10, simultaneas),
    )
    sei.session.mount("https://", adaptador)
    sei.session.mount("http://", adaptador)


def _candidatas(preferida: str | None) -> list[str]:
    """Unidades a tentar, com a mais provável na frente."""
    ordem = list(UNIDADES_CONSULTA)
    if preferida:
        if preferida in ordem:
            ordem.remove(preferida)
        ordem.insert(0, preferida)
    return ordem


def _buscar_dados_no_sei(
    sei, numero: str, unidades: list[str],
) -> tuple[str | None, date | None, date | None, str | None]:
    """Devolve ``(id_procedimento, data_criacao, data_ultima_acao, unidade)``.

    Uma única chamada por linha: ``GET /processos/{numero}`` com
    ``sinRetornarUltimoAndamento`` já traz ``dataAutuacao`` (a criação no SEI),
    o ``idProcedimento`` e o último andamento. Por isso não é preciso conhecer o
    ``idProcedimento`` antes — só o número, que toda linha tem.
    """
    for unidade in unidades:
        try:
            dados = sei.consultar_processo(numero, unidade, ultimo_andamento=True)
        except Exception:  # noqa: BLE001
            continue
        if not dados:
            continue
        ultimo = dados.get("ultimoAndamento") or {}
        return (
            str(dados.get("idProcedimento") or "") or None,
            _data_br(dados.get("dataAutuacao")),
            _data_br(ultimo.get("dataHora")),
            unidade,
        )
    return None, None, None, None


def _rodada_datas(
    Session,
    sei,
    max_itens: int,
    dry_run: bool,
    todas: bool,
    simultaneas: int,
) -> tuple[int, int]:
    """Uma passada pelas linhas pendentes. Devolve ``(com_data, sem_retorno)``."""
    with Session() as s:
        stmt = (
            select(m.ConsultaUnificada)
            .where(
                m.ConsultaUnificada.numero_sei.is_not(None),
                m.ConsultaUnificada.numero_sei != "",
            )
            # Sem data de criação primeiro (é o que a tela cobra), depois quem
            # nunca foi sincronizado e por fim os mais antigos.
            .order_by(
                m.ConsultaUnificada.data_criacao_sei.is_(None).desc(),
                m.ConsultaUnificada.datas_sincronizadas_em.is_(None).desc(),
                m.ConsultaUnificada.datas_sincronizadas_em.asc(),
            )
        )
        if todas:
            # Carga completa: só o que falta. A data de autuação não muda, então
            # reconsultar quem já tem data seria desperdício — e é isso que
            # permite repescar as falhas sem repetir as ~19 mil linhas.
            stmt = stmt.where(m.ConsultaUnificada.data_criacao_sei.is_(None))
        else:
            stmt = stmt.limit(max_itens)
        alvos = s.scalars(stmt).all()
        unidade_por_item = {
            i.id: i.id_unidade_sei
            for i in s.scalars(select(m.CaixaEntrada)).all()
            if i.id_unidade_sei
        }
        pendentes = [
            (
                r.id,
                r.numero_sei,
                # Unidade da nossa caixa quando conhecida; senão, a provável
                # pelo agente regulado.
                unidade_por_item.get(r.caixa_entrada_id) or _unidade_provavel(r.agente_regulado),
                r.data_criacao_sei is None,
            )
            for r in alvos
        ]

    if not pendentes:
        return 0, 0

    sem_data = sum(1 for p in pendentes if p[3])
    logger.info(
        "  %d linhas nesta passada (%d ainda sem data), %d consultas simultâneas",
        len(pendentes), sem_data, simultaneas,
    )

    preenchidos = 0
    falhas = 0
    processados = 0
    inicio_ciclo = time.time()

    def consultar(pendente: tuple[int, str, str | None, bool]) -> tuple:
        reg_id, numero, preferida, _ = pendente
        id_proc, criacao, ultima, _unidade = _buscar_dados_no_sei(
            sei, numero, _candidatas(preferida),
        )
        return reg_id, numero, id_proc, criacao, ultima

    for inicio in range(0, len(pendentes), TAMANHO_LOTE):
        lote = pendentes[inicio:inicio + TAMANHO_LOTE]

        with ThreadPoolExecutor(max_workers=simultaneas) as pool:
            resultados = list(pool.map(consultar, lote))

        with Session() as s:
            for reg_id, numero, id_proc, criacao, ultima in resultados:
                registro = s.get(m.ConsultaUnificada, reg_id)
                if registro and not dry_run:
                    if id_proc and not registro.id_procedimento:
                        registro.id_procedimento = id_proc
                    if criacao:
                        registro.data_criacao_sei = criacao
                    if ultima:
                        registro.data_ultima_acao = ultima
                    # Marcado mesmo sem resultado, para a rotação seguir adiante
                    registro.datas_sincronizadas_em = _agora_naive()

                if criacao:
                    preenchidos += 1
                else:
                    falhas += 1

            if not dry_run:
                s.commit()

        processados += len(lote)
        decorrido = time.time() - inicio_ciclo
        por_linha = decorrido / processados if processados else 0
        restante_min = (len(pendentes) - processados) * por_linha / 60
        logger.info(
            "  progresso: %d/%d | com data: %d | sem retorno: %d | %.1fs/linha | restam ~%.0f min",
            processados, len(pendentes), preenchidos, falhas, por_linha, restante_min,
        )

    return preenchidos, falhas


def sincronizar_datas(
    Session,
    max_itens: int = MAX_DATAS_POR_CICLO,
    dry_run: bool = False,
    todas: bool = False,
    simultaneas: int = CONSULTAS_SIMULTANEAS,
) -> int:
    """Preenche a data de criação no SEI e a data da última ação.

    Processa qualquer linha que tenha número SEI — inclusive as que vêm só da
    listaDesignacao, que não têm ``id_procedimento``. Prioriza quem ainda está
    sem data de criação, depois quem foi sincronizado há mais tempo.

    Faz mais de uma passada quando sobra linha sem data. Isso não é capricho: o
    SEI responde **HTTP 500** tanto para "este processo não é desta unidade"
    como para instabilidade momentânea, e sob concorrência alta o segundo caso
    aumenta. Repescar o que sobrou separa um do outro — o que insiste em falhar
    depois de três passadas realmente não está acessível às nossas unidades.
    """
    from app.core.sei_shared import get_sei_client

    logger.info("=== Etapa 3: datas de criação e última ação no SEI ===")

    sei = get_sei_client(timeout=30)
    _ampliar_pool_http(sei, simultaneas)

    total_com_data = 0
    passadas = MAX_PASSADAS_DATAS if todas else 1

    for passada in range(1, passadas + 1):
        if passadas > 1:
            logger.info("--- passada %d de %d ---", passada, passadas)
        com_data, sem_retorno = _rodada_datas(
            Session, sei, max_itens, dry_run, todas, simultaneas,
        )
        total_com_data += com_data

        if com_data == 0 and sem_retorno == 0:
            break  # nada pendente
        if sem_retorno == 0:
            break  # todas resolvidas
        if dry_run:
            break
        if passada < passadas:
            logger.info(
                "  %d linhas sem retorno; nova passada só com elas em %ds",
                sem_retorno, PAUSA_ENTRE_PASSADAS_S,
            )
            time.sleep(PAUSA_ENTRE_PASSADAS_S)

    logger.info("Etapa 3 concluída. Datas obtidas nesta execução: %d", total_com_data)
    return total_com_data


def sincronizar(
    desde_ano: int | None = None,
    max_datas: int = MAX_DATAS_POR_CICLO,
    dry_run: bool = False,
    so_datas: bool = False,
    todas_datas: bool = False,
    simultaneas: int = CONSULTAS_SIMULTANEAS,
    so_vinculo: bool = False,
    so_agentes: bool = False,
) -> None:
    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    inicio = time.time()

    if so_agentes:
        normalizar_agentes(Session, dry_run=dry_run)
        return

    if so_vinculo:
        vincular_relatorios_tramitados(Session, dry_run=dry_run)
        return

    if not so_datas:
        sincronizar_relatorios(Session, desde_ano=desde_ano, dry_run=dry_run)
        normalizar_agentes(Session, dry_run=dry_run)
        sincronizar_processos(Session, dry_run=dry_run)
        vincular_relatorios_tramitados(Session, dry_run=dry_run)

    if max_datas > 0 or todas_datas:
        sincronizar_datas(
            Session,
            max_itens=max_datas,
            dry_run=dry_run,
            todas=todas_datas,
            simultaneas=simultaneas,
        )

    with Session() as s:
        from sqlalchemy import func as sa_func
        total = s.scalar(select(sa_func.count()).select_from(m.ConsultaUnificada)) or 0
        com_datas = s.scalar(
            select(sa_func.count()).select_from(m.ConsultaUnificada)
            .where(m.ConsultaUnificada.data_criacao_sei.is_not(None))
        ) or 0

    logger.info(
        "=== Sincronização concluída em %.1fs. Linhas: %d (com data de criação: %d) ===",
        time.time() - inicio, total, com_datas,
    )
    if dry_run:
        logger.info("[DRY-RUN] Nada foi gravado.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sincroniza a tabela da Consulta Unificada.")
    parser.add_argument("--dry-run", action="store_true", help="Mostra o que faria, sem gravar.")
    parser.add_argument(
        "--desde-ano", type=int, default=None,
        help="Considera apenas relatórios deste ano em diante (ex.: 2026). Padrão: todos.",
    )
    parser.add_argument(
        "--max-datas", type=int, default=MAX_DATAS_POR_CICLO,
        help=f"Quantas linhas terão as datas buscadas no SEI nesta execução (padrão {MAX_DATAS_POR_CICLO}; 0 desliga).",
    )
    parser.add_argument(
        "--so-datas", action="store_true",
        help="Pula as etapas 1 e 2 e só preenche datas (para execuções frequentes).",
    )
    parser.add_argument(
        "--todas-datas", action="store_true",
        help="Ignora o limite e percorre todas as linhas (carga inicial; pode ser interrompida e retomada).",
    )
    parser.add_argument(
        "--simultaneas", type=int, default=CONSULTAS_SIMULTANEAS,
        help=f"Consultas simultâneas ao SEI (padrão {CONSULTAS_SIMULTANEAS}).",
    )
    parser.add_argument(
        "--so-vinculo", action="store_true",
        help="Só refaz o vínculo dos relatórios com a caixa de entrada (filtro Fonte dos dados). "
             "Não fala com SEI nem SharePoint.",
    )
    parser.add_argument(
        "--so-agentes", action="store_true",
        help="Só consolida os nomes de agente regulado e remove as classes fora do app. "
             "Não fala com SEI nem SharePoint.",
    )
    args = parser.parse_args()
    sincronizar(
        desde_ano=args.desde_ano,
        max_datas=args.max_datas,
        dry_run=args.dry_run,
        so_datas=args.so_datas,
        todas_datas=args.todas_datas,
        simultaneas=args.simultaneas,
        so_vinculo=args.so_vinculo,
        so_agentes=args.so_agentes,
    )


if __name__ == "__main__":
    main()
