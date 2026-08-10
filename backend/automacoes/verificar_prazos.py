"""Automação: abre prazos, verifica vencimentos e detecta visualizações/respostas.

Fluxo:
0. Abre o prazo de quem ainda não tem: processo em ``aguardando_defesa`` sem
   prazo da defesa, com disponibilização de acesso externo já registrada no SEI,
   ganha o prazo contado dessa data — sem depender de clique na tela
1. Busca os prazos "em_andamento" e os já em "decurso" (estes só para detectar
   manifestação fora do prazo)
2. Para cada um, consulta os andamentos do processo no SEI (tarefas 13 e 50)
3. Acesso externo (tarefa 50) — só na defesa prévia:
   - A data do andamento é a **disponibilização**: é dela que o prazo conta. Se
     o prazo foi aberto depois (analista disponibilizou direto no SEI), o
     início é corrigido para a data real
   - Se a descrição do andamento traz "Visualizado em ...", o prazo **reinicia**
     uma vez, contado da data da visualização
4. Se detectar tarefa 13 (documento externo registrado = defesa juntada):
   - Marca o prazo como "respondido"; se a juntada foi após o vencimento,
     notifica que a manifestação é intempestiva
5. Se a data de vencimento passou sem resposta:
   - Defesa prévia **sem visualização** e sem edital ainda: fica em "decurso"
     na própria fase, com notificação para gerar o **edital de citação** (a
     fase não avança; o edital abre a segunda rodada de 15 dias)
   - Nos demais casos: certidão de decurso + avanço de fase

A regra de negócio dos prazos da defesa prévia mora em
``app/services/acesso_externo.py``, para valer também na verificação em tempo
real feita pela tela (``GET /fase-atual``).

Uso:
    cd backend/
    python -m automacoes.verificar_prazos

Agendar a cada 30 minutos (ou mais frequente se necessário).
"""
import logging
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

from sqlalchemy import and_, or_, select

from app.db.base import Base, get_engine, get_sessionmaker
from app.db import models as m
from app.integrations.sei.client import SeiClient, SeiSettings
from app.services.acesso_externo import (
    FASE_DEFESA,
    TAREFA_ACESSO_EXTERNO,
    TAREFA_DOCUMENTO_EXTERNO,
    abrir_prazo_defesa,
    alinhar_inicio_com_disponibilizacao,
    buscar_acesso_externo,
    datas_documentos_externos,
    edital_citacao_gerado,
    extrair_acesso_externo,
    notificar_defesa_intempestiva,
    notificar_falta_de_visualizacao,
    prazo_defesa_existe,
    reiniciar_por_visualizacao,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

AUTOR_AUTOMACAO = "Sistema (automação)"


def _sei_client() -> SeiClient:
    settings = SeiSettings(
        token_url=os.environ.get("SEI_TOKEN_URL", ""),
        client_id=os.environ.get("SEI_CLIENT_ID", os.environ.get("CLIENT_ID", "")),
        client_secret=os.environ.get("SEI_CLIENT_SECRET", os.environ.get("CLIENT_SECRET", "")),
        api_base=os.environ.get("SEI_API_BASE", ""),
        sigla_sistema=os.environ.get("SEI_SIGLA_SISTEMA", "CSDR_PROCESSAMENTO"),
        identificacao_servico=os.environ.get("SEI_IDENTIFICACAO_SERVICO", ""),
        trace_id=os.environ.get("SEI_TRACE_ID", ""),
    )
    return SeiClient(settings, timeout=30, max_tentativas=1)


def _avancar_fase_se_aguardando_defesa(db, caixa_entrada_id: int, observacao: str):
    """Avança a fase de 'aguardando_defesa' para 'defesa_apresentada' se aplicável."""
    _avancar_fase_se_aguardando(db, caixa_entrada_id, "aguardando_defesa", "defesa_apresentada", observacao)


def _avancar_fase_se_aguardando(db, caixa_entrada_id: int, fase_atual: str, fase_destino: str, observacao: str):
    """Avança a fase de uma fase específica para outra se a fase atual corresponder.

    Só avança se a fase mais recente do processo for `fase_atual`. Se já estiver
    em outra fase (ex.: fase já foi avançada manualmente), não faz nada.
    """
    from app.db.models import _agora

    # Buscar fase atual (mais recente)
    stmt = (
        select(m.FaseProcessoAndamento)
        .where(m.FaseProcessoAndamento.caixa_entrada_id == caixa_entrada_id)
        .order_by(m.FaseProcessoAndamento.data_entrada.desc())
        .limit(1)
    )
    fase_reg = db.scalars(stmt).first()

    if not fase_reg or fase_reg.fase != fase_atual:
        return  # Fase já avançou ou não está na fase esperada

    # Fechar fase atual
    fase_reg.data_saida = _agora()

    # Criar nova fase
    nova = m.FaseProcessoAndamento(
        caixa_entrada_id=caixa_entrada_id,
        fase=fase_destino,
        autor="Sistema (automação)",
        observacao=observacao,
    )
    db.add(nova)

    db.add(m.EventoProcesso(
        caixa_entrada_id=caixa_entrada_id,
        tipo="fase_avancada",
        descricao=f"Fase avançada automaticamente: {fase_atual} → {fase_destino} ({observacao})",
        autor="Sistema (automação)",
    ))

    logger.info("    ⇒ Fase avançada para '%s'", fase_destino)


def _buscar_andamentos(sei: SeiClient, id_procedimento: str, id_unidade: str):
    """Andamentos de acesso externo (50) e documento externo (13).

    Devolve ``None`` quando a consulta ao SEI falha — o prazo é pulado nesta
    rodada em vez de ser tratado como "nada aconteceu".
    """
    try:
        resp = sei.listar_andamentos(
            id_procedimento, id_unidade,
            tipo_historico="T",
            tarefas=f"{TAREFA_ACESSO_EXTERNO},{TAREFA_DOCUMENTO_EXTERNO}",
            start=0, limit=50,
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("    Erro ao consultar andamentos: %s", e)
        return None
    return resp.get("Andamentos", [])


def _registrar_resposta(db, sei, prazo, item, data_juntada: date, id_unidade: str):
    """Manifestação juntada: fecha o prazo, certifica e avança a fase."""
    numero = item.numero_processo_sei or item.numero_sei
    prazo.status = "respondido"
    prazo.data_resposta = data_juntada
    intempestiva = data_juntada > prazo.data_vencimento
    logger.info(
        "    ✓ Documento juntado em %s%s",
        data_juntada, " (fora do prazo)" if intempestiva else "",
    )

    if prazo.fase == "recurso":
        tipo_evento = "recurso_interposto"
        titulo_notif = "Recurso interposto"
        desc_notif = (
            f"O interessado interpôs recurso no processo {numero} em "
            f"{data_juntada.strftime('%d/%m/%Y')}."
        )
    elif prazo.fase == "aguardando_alegacoes":
        tipo_evento = "alegacoes_apresentadas"
        titulo_notif = "Alegações finais apresentadas"
        desc_notif = (
            f"O interessado apresentou alegações finais no processo {numero} em "
            f"{data_juntada.strftime('%d/%m/%Y')}."
        )
    else:
        tipo_evento = "defesa_juntada"
        titulo_notif = "Defesa prévia apresentada"
        desc_notif = (
            f"O interessado juntou documento no processo {numero} em "
            f"{data_juntada.strftime('%d/%m/%Y')}."
        )

    db.add(m.EventoProcesso(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo=tipo_evento,
        descricao=f"Documento externo registrado em {data_juntada} ({tipo_evento})",
        autor=AUTOR_AUTOMACAO,
    ))
    db.add(m.Notificacao(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo=tipo_evento,
        titulo=titulo_notif,
        descricao=desc_notif,
    ))

    # Juntada depois do vencimento: o analista precisa avaliar a tempestividade.
    if intempestiva:
        notificar_defesa_intempestiva(db, prazo, item, data_juntada)

    # Certidão de juntada no SEI
    tipo_juntada = "alegacoes" if prazo.fase == "aguardando_alegacoes" else "defesa"
    try:
        from app.services.documentos_automaticos import gerar_certidao_juntada
        gerar_certidao_juntada(sei, item, data_juntada, id_unidade, tipo=tipo_juntada)
    except Exception as e:  # noqa: BLE001
        logger.warning("    Erro ao gerar certidão de juntada: %s", e)

    if prazo.fase == "aguardando_defesa":
        _avancar_fase_se_aguardando_defesa(
            db, prazo.caixa_entrada_id,
            observacao=f"Defesa apresentada em {data_juntada}",
        )
    elif prazo.fase == "aguardando_alegacoes":
        _avancar_fase_se_aguardando(
            db, prazo.caixa_entrada_id,
            fase_atual="aguardando_alegacoes",
            fase_destino="julgamento",
            observacao=f"Alegações finais apresentadas em {data_juntada}",
        )
    # Recurso: NÃO avança automaticamente — o analista analisa o recurso,
    # elabora parecer e avança manualmente para encerramento (ou remete para
    # consultoria jurídica).


def _certificar_decurso(db, sei, prazo, item, id_unidade: str):
    """Decurso com certidão no SEI e avanço de fase (comportamento padrão)."""
    numero = item.numero_processo_sei or item.numero_sei
    vencimento_fmt = prazo.data_vencimento.strftime("%d/%m/%Y")
    prazo.status = "decurso"
    logger.info("    ✗ Prazo vencido sem resposta — certidão de decurso.")

    db.add(m.EventoProcesso(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo="prazo_vencido",
        descricao=f"Prazo venceu em {vencimento_fmt} sem resposta (decurso de prazo)",
        autor=AUTOR_AUTOMACAO,
    ))
    db.add(m.Notificacao(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo="prazo_vencido",
        titulo="Prazo vencido (decurso)",
        descricao=(
            f"O prazo do processo {numero} venceu em {vencimento_fmt} sem resposta. "
            "Certidão de decurso de prazo gerada."
        ),
    ))

    tipo_prazo = "alegacoes" if prazo.fase == "aguardando_alegacoes" else "defesa"
    try:
        if prazo.fase == "recurso":
            from app.services.documentos_automaticos import gerar_certidao_decurso_recurso
            resultado_cert = gerar_certidao_decurso_recurso(
                sei, item, prazo.data_vencimento, id_unidade,
            )
        else:
            from app.services.documentos_automaticos import gerar_certidao_decurso
            resultado_cert = gerar_certidao_decurso(
                sei, item, prazo.data_vencimento, id_unidade, tipo_prazo=tipo_prazo,
            )
        if resultado_cert:
            db.add(m.EventoProcesso(
                caixa_entrada_id=prazo.caixa_entrada_id,
                tipo="certidao_gerada",
                descricao=(
                    "Certidão de decurso de prazo gerada automaticamente: "
                    f"{resultado_cert.get('documentoFormatado', '')}"
                ),
                autor=AUTOR_AUTOMACAO,
            ))
    except Exception as e:  # noqa: BLE001
        logger.warning("    Erro ao gerar certidão de decurso: %s", e)

    if prazo.fase == "aguardando_defesa":
        _avancar_fase_se_aguardando_defesa(
            db, prazo.caixa_entrada_id,
            observacao=f"Decurso de prazo em {vencimento_fmt} — defesa não apresentada",
        )
    elif prazo.fase == "aguardando_alegacoes":
        _avancar_fase_se_aguardando(
            db, prazo.caixa_entrada_id,
            fase_atual="aguardando_alegacoes",
            fase_destino="julgamento",
            observacao=f"Decurso de prazo de alegações em {vencimento_fmt}",
        )
    elif prazo.fase == "recurso":
        _avancar_fase_se_aguardando(
            db, prazo.caixa_entrada_id,
            fase_atual="recurso",
            fase_destino="encerramento",
            observacao=(
                f"Decurso de prazo de recurso em {vencimento_fmt} — recurso não "
                "interposto. Decisão transitou em julgado."
            ),
        )
        db.add(m.Notificacao(
            caixa_entrada_id=prazo.caixa_entrada_id,
            tipo="prazo_vencido",
            titulo="Prazo de recurso vencido — processo para encerramento",
            descricao=(
                f"O prazo de recurso do processo {numero} venceu sem manifestação. "
                "Decisão transitou em julgado."
            ),
        ))


def _tratar_decurso(db, sei, prazo, item, id_unidade: str):
    """Aplica a regra do vencimento conforme houve ou não visualização.

    Defesa prévia vencida **sem** o interessado ter visualizado o acesso
    externo não gera certidão de decurso nem avança a fase: o caminho é
    publicar edital de citação, que abre a segunda rodada de 15 dias. Só
    quando houve visualização (ou quando o edital já foi publicado e também
    passou em branco) é que entra a certidão de decurso.
    """
    if (
        prazo.fase == "aguardando_defesa"
        and not prazo.reiniciado
        and not edital_citacao_gerado(db, prazo.caixa_entrada_id)
    ):
        prazo.status = "decurso"
        notificar_falta_de_visualizacao(db, prazo, item)
        logger.info(
            "    ✗ Prazo vencido sem visualização — cabe edital de citação "
            "(fase mantida em aguardando_defesa)."
        )
        return

    _certificar_decurso(db, sei, prazo, item, id_unidade)


def _juntada_intempestiva(db, prazo, item, andamentos: list[dict]) -> bool:
    """Detecta manifestação juntada depois do decurso e notifica uma vez."""
    if prazo.data_resposta:
        return False

    posteriores = [
        d for d in datas_documentos_externos(andamentos) if d > prazo.data_vencimento
    ]
    if not posteriores:
        return False

    data_juntada = posteriores[0]
    prazo.data_resposta = data_juntada
    notificar_defesa_intempestiva(db, prazo, item, data_juntada)
    logger.info("    ! Documento juntado em %s, após o vencimento", data_juntada)
    return True


def abrir_prazos_pendentes(db, sei: SeiClient, limite: int = 100) -> int:
    """Abre sozinho o prazo dos processos que já têm acesso externo no SEI.

    Roda antes da verificação: processo em ``aguardando_defesa`` sem nenhum
    prazo da defesa é candidato. Se o SEI já registra a disponibilização
    (tarefa 50), o prazo nasce contado dela — ninguém precisa clicar em nada na
    tela. Enquanto o acesso não for disponibilizado, o processo simplesmente
    aparece como pendente na rodada seguinte.
    """
    fases_abertas = db.scalars(
        select(m.FaseProcessoAndamento).where(
            m.FaseProcessoAndamento.fase == FASE_DEFESA,
            m.FaseProcessoAndamento.data_saida.is_(None),
        )
    ).all()

    candidatos = [
        f.caixa_entrada_id
        for f in fases_abertas
        if not prazo_defesa_existe(db, f.caixa_entrada_id)
    ]
    if not candidatos:
        return 0

    logger.info(
        "Processos aguardando defesa sem prazo aberto: %d (verificando até %d)",
        len(candidatos), limite,
    )

    abertos = 0
    for caixa_entrada_id in candidatos[:limite]:
        item = db.get(m.CaixaEntrada, caixa_entrada_id)
        if not item:
            continue

        id_unidade = item.id_unidade_sei or "110053117"
        acesso = buscar_acesso_externo(sei, item, id_unidade)
        prazo = abrir_prazo_defesa(
            db, item, acesso, AUTOR_AUTOMACAO,
            sei=sei, id_unidade=id_unidade, notificar=True,
        )
        if prazo is None:
            logger.info(
                "  Processo %s: acesso externo ainda não disponibilizado no SEI.",
                item.numero_processo_sei or item.numero_sei,
            )
            continue

        db.commit()
        abertos += 1
        logger.info(
            "  Processo %s: prazo aberto de %s a %s%s",
            item.numero_processo_sei or item.numero_sei,
            prazo.data_inicio, prazo.data_vencimento,
            " (já visualizado, contando da visualização)" if prazo.reiniciado else "",
        )

    return abertos


def verificar():
    engine = get_engine()
    Base.metadata.create_all(engine)
    Session = get_sessionmaker(engine)

    sei = _sei_client()
    hoje = date.today()

    with Session() as db:
        # Antes de verificar: abrir o prazo de quem já tem acesso externo
        # disponibilizado no SEI e ainda não tinha prazo no app.
        abrir_prazos_pendentes(db, sei)

        # Prazos correndo + os já vencidos que ainda podem receber manifestação
        # fora do prazo (limitado aos últimos 60 dias para não varrer histórico
        # antigo em toda rodada).
        limite_intempestiva = hoje - timedelta(days=60)
        stmt = select(m.PrazoProcesso).where(
            or_(
                m.PrazoProcesso.status == "em_andamento",
                and_(
                    m.PrazoProcesso.status == "decurso",
                    m.PrazoProcesso.data_resposta.is_(None),
                    m.PrazoProcesso.data_vencimento >= limite_intempestiva,
                ),
            )
        )
        prazos = db.scalars(stmt).all()

        if not prazos:
            logger.info("Nenhum prazo a verificar.")
            return

        logger.info("Verificando %d prazo(s)...", len(prazos))

        for prazo in prazos:
            item = db.get(m.CaixaEntrada, prazo.caixa_entrada_id)
            if not item:
                continue

            id_procedimento = item.id_procedimento_processo or item.id_procedimento
            id_unidade = item.id_unidade_sei or "110053117"

            if not id_procedimento:
                continue

            logger.info(
                "  Processo %s (fase %s, prazo vence %s, status %s)...",
                item.numero_processo_sei or item.numero_sei,
                prazo.fase, prazo.data_vencimento, prazo.status,
            )

            andamentos = _buscar_andamentos(sei, id_procedimento, id_unidade)
            if andamentos is None:
                continue

            # Prazo já vencido: só interessa saber se o interessado se
            # manifestou depois, para avisar o analista.
            if prazo.status == "decurso":
                if _juntada_intempestiva(db, prazo, item, andamentos):
                    db.commit()
                continue

            # A defesa prévia conta da disponibilização do acesso externo e
            # reinicia na visualização — as duas datas saem da tarefa 50.
            acesso = None
            if prazo.fase == "aguardando_defesa":
                acesso = extrair_acesso_externo(andamentos)
                if alinhar_inicio_com_disponibilizacao(db, prazo, acesso, AUTOR_AUTOMACAO):
                    logger.info(
                        "    ⇢ Início ajustado para a disponibilização (%s) → vence %s",
                        prazo.data_inicio, prazo.data_vencimento,
                    )

            # Manifestação juntada dentro do período do prazo
            juntadas = [
                d for d in datas_documentos_externos(andamentos) if d >= prazo.data_inicio
            ]
            if juntadas:
                _registrar_resposta(db, sei, prazo, item, juntadas[0], id_unidade)
                db.commit()
                continue

            if acesso and reiniciar_por_visualizacao(
                db, prazo, acesso, item, AUTOR_AUTOMACAO, hoje=hoje,
            ):
                logger.info(
                    "    ↻ Visualizado em %s — prazo reiniciado, vence em %s",
                    prazo.data_reinicio, prazo.data_vencimento,
                )

            if hoje > prazo.data_vencimento:
                _tratar_decurso(db, sei, prazo, item, id_unidade)
                db.commit()
                continue

            db.commit()
            dias_restantes = (prazo.data_vencimento - hoje).days
            logger.info("    → %d dia(s) restante(s)", dias_restantes)

    logger.info("=== Verificação concluída ===")


if __name__ == "__main__":
    verificar()
