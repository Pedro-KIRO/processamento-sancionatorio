"""Rotas de controle de fases e prazos do processo administrativo."""
import json
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes.processos_andamento import _obter_item
from app.core.config import sei_settings
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.db.models import FASES_PROCESSO
from app.integrations.sei.client import SeiClient
from app.services import calculo_prazos

router = APIRouter(prefix="/processos-andamento", tags=["Fases do Processo"])

# Série usada para documento externo (PDF enviado pelo usuário).
ID_SERIE_ANEXO = "1917"  # Anexo


# ==============================================================================
# Schemas
# ==============================================================================

class FaseOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    fase: str
    data_entrada: datetime | None = None
    data_saida: datetime | None = None
    autor: str | None = None
    observacao: str | None = None


class PrazoOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    fase: str
    dias: int
    #: Início da contagem. Na defesa prévia, é a data da disponibilização do
    #: acesso externo (não a do clique no app).
    data_inicio: date
    data_vencimento: date
    #: True quando a visualização do acesso externo reiniciou a contagem.
    reiniciado: bool
    #: Data da visualização que reiniciou o prazo.
    data_reinicio: date | None = None
    status: str
    data_resposta: date | None = None
    registrado_sei: bool


class EventoOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    tipo: str
    descricao: str | None = None
    autor: str | None = None
    criado_em: datetime


class DefinirPrazoIn(BaseModel):
    dias: int | None = None  # ex.: 15
    data_vencimento: str | None = None  # dd/mm/yyyy


class AvancarFaseIn(BaseModel):
    observacao: str | None = None


# ==============================================================================
# Helpers
# ==============================================================================

def _fase_atual(caixa_entrada_id: int, db: Session) -> m.FaseProcessoAndamento | None:
    """Retorna a fase mais recente (atual) do processo."""
    stmt = (
        select(m.FaseProcessoAndamento)
        .where(m.FaseProcessoAndamento.caixa_entrada_id == caixa_entrada_id)
        .order_by(m.FaseProcessoAndamento.data_entrada.desc())
        .limit(1)
    )
    return db.scalars(stmt).first()


def _proxima_fase(fase_atual: str) -> str | None:
    """Retorna a próxima fase na sequência, ou None se já é a última."""
    try:
        idx = FASES_PROCESSO.index(fase_atual)
        if idx < len(FASES_PROCESSO) - 1:
            return FASES_PROCESSO[idx + 1]
    except ValueError:
        pass
    return None


def _registrar_evento(
    db: Session, caixa_entrada_id: int, tipo: str, descricao: str,
    autor: str | None = None, dados: dict | None = None,
):
    evento = m.EventoProcesso(
        caixa_entrada_id=caixa_entrada_id,
        tipo=tipo,
        descricao=descricao,
        autor=autor,
        dados_json=json.dumps(dados, ensure_ascii=False) if dados else None,
    )
    db.add(evento)


def _get_sei_client() -> SeiClient:
    """Cliente SEI compartilhado (reaproveita o token entre requests)."""
    from app.core.sei_shared import get_sei_client
    return get_sei_client(timeout=30)


def _unidade_padrao() -> str:
    """Unidade usada quando o item não tem unidade própria gravada."""
    import os

    return os.getenv("SEI_UNIDADE_PROCESSAMENTO_PADRAO", "")


def _sincronizar_prazo_com_sei(db: Session, item: m.CaixaEntrada, item_id: int, fase_atual: str):
    """Põe o prazo da fase de espera em dia com o que o SEI já registrou.

    Mesma regra da automação ``verificar_prazos`` (que vive em
    ``app/services/acesso_externo.py``), aplicada quando o usuário abre a tela:

    - defesa prévia sem prazo nenhum e com disponibilização já registrada no SEI
      → **abre o prazo na hora**, contado dessa data (não há botão a apertar);
    - tarefa 50 → corrige o início para a data da disponibilização e, se a
      descrição já traz "Visualizado em ...", reinicia por mais N dias;
    - tarefa 13 → manifestação juntada: fecha o prazo e avança a fase, avisando
      quando a juntada foi depois do vencimento.

    O decurso continua a cargo da automação, que é quem inclui a certidão no
    SEI — uma requisição GET de tela não gera documento.
    """
    from app.services.acesso_externo import (
        FASE_DEFESA,
        abrir_prazo_defesa,
        alinhar_inicio_com_disponibilizacao,
        datas_documentos_externos,
        extrair_acesso_externo,
        notificar_defesa_intempestiva,
        prazo_defesa_existe,
        reiniciar_por_visualizacao,
    )

    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    id_unidade = item.id_unidade_sei or "110053117"
    if not id_procedimento:
        return

    # Buscar prazo ativo da fase atual
    stmt = (
        select(m.PrazoProcesso)
        .where(
            m.PrazoProcesso.caixa_entrada_id == item_id,
            m.PrazoProcesso.fase == fase_atual,
            m.PrazoProcesso.status == "em_andamento",
        )
    )
    prazo = db.scalars(stmt).first()

    # Nenhum prazo ativo: só há o que fazer na defesa prévia, e só se o processo
    # ainda não teve prazo nenhum — abrir na hora, a partir da disponibilização
    # registrada no SEI. Nos outros casos (prazo já vencido, ou fase de
    # alegações) não há nada a sincronizar.
    abrir_agora = (
        prazo is None
        and fase_atual == FASE_DEFESA
        and not prazo_defesa_existe(db, item_id)
    )
    if prazo is None and not abrir_agora:
        return

    # Andamentos de documento externo (13) e de acesso externo (50)
    try:
        sei = _get_sei_client()
        resp = sei.listar_andamentos(
            id_procedimento, id_unidade,
            tipo_historico="T", tarefas="13,50",
            start=0, limit=30,
        )
    except Exception:
        return

    andamentos = resp.get("Andamentos", [])

    if abrir_agora:
        prazo = abrir_prazo_defesa(
            db, item, extrair_acesso_externo(andamentos),
            autor="Sistema (detecção em tempo real)",
            sei=sei, id_unidade=id_unidade, notificar=True,
        )
        if prazo is None:
            return  # Acesso externo ainda não disponibilizado no SEI
        db.commit()

    autor = "Sistema (detecção em tempo real)"
    alterou = False

    acesso = None
    if fase_atual == FASE_DEFESA:
        acesso = extrair_acesso_externo(andamentos)
        alterou = alinhar_inicio_com_disponibilizacao(db, prazo, acesso, autor) or alterou

    juntadas = [d for d in datas_documentos_externos(andamentos) if d >= prazo.data_inicio]

    if not juntadas:
        if acesso and reiniciar_por_visualizacao(db, prazo, acesso, item, autor):
            alterou = True
        if alterou:
            db.commit()
        return

    data_juntada = juntadas[0]
    prazo.status = "respondido"
    prazo.data_resposta = data_juntada

    if data_juntada > prazo.data_vencimento:
        notificar_defesa_intempestiva(db, prazo, item, data_juntada)

    # Avançar fase
    from app.db.models import _agora
    fase_reg = _fase_atual(item_id, db)
    if fase_reg and fase_reg.fase == fase_atual:
        fase_reg.data_saida = _agora()
        if fase_atual == FASE_DEFESA:
            nova_fase = "defesa_apresentada"
            obs = f"Defesa apresentada em {data_juntada}"
        else:
            nova_fase = "julgamento"
            obs = f"Alegações apresentadas em {data_juntada}"

        db.add(m.FaseProcessoAndamento(
            caixa_entrada_id=item_id, fase=nova_fase,
            autor=autor, observacao=obs,
        ))
        db.add(m.EventoProcesso(
            caixa_entrada_id=item_id, tipo="fase_avancada",
            descricao=f"Fase avançada: {fase_atual} → {nova_fase} ({obs})",
            autor="Sistema",
        ))

    db.commit()


def _verificar_documento_externo_notificar(db: Session, item: m.CaixaEntrada, item_id: int):
    """Verifica se há documento externo recente (tarefa 13) e cria notificação.

    Funciona em QUALQUER fase — não depende de prazo ativo.
    Evita duplicatas verificando se já existe notificação recente para o mesmo processo.
    """
    from datetime import date as date_type, timedelta

    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    id_unidade = item.id_unidade_sei or "110053117"
    if not id_procedimento:
        return

    # Consultar andamentos recentes (tarefa 13 = documento externo)
    try:
        sei = _get_sei_client()
        resp = sei.listar_andamentos(
            id_procedimento, id_unidade,
            tipo_historico="T", tarefas="13",
            start=0, limit=10,
        )
    except Exception:
        return

    andamentos = resp.get("Andamentos", [])
    if not andamentos:
        return

    # Pegar a data do andamento mais recente (tarefa 13)
    data_mais_recente = None
    descricao_andamento = ""
    for a in andamentos:
        data_str = a.get("data", "")
        try:
            partes = data_str.split("/")
            data_a = date_type(int(partes[2]), int(partes[1]), int(partes[0]))
        except (ValueError, IndexError):
            continue

        if data_mais_recente is None or data_a > data_mais_recente:
            data_mais_recente = data_a
            descricao_andamento = a.get("descricao", "Documento externo registrado")

    if not data_mais_recente:
        return

    # Só notificar se for dos últimos 30 dias
    hoje = date_type.today()
    if (hoje - data_mais_recente).days > 30:
        return

    # Verificar se já existe notificação de documento_externo para este processo com data recente
    stmt = (
        select(m.Notificacao)
        .where(
            m.Notificacao.caixa_entrada_id == item_id,
            m.Notificacao.tipo == "documento_externo",
        )
        .order_by(m.Notificacao.criado_em.desc())
        .limit(1)
    )
    notif_existente = db.scalars(stmt).first()

    if notif_existente:
        # Se a última notificação é do mesmo dia ou posterior ao doc externo, já notificou
        data_notif = notif_existente.criado_em.date() if notif_existente.criado_em else None
        if data_notif and data_notif >= data_mais_recente:
            return

    # Criar notificação
    numero = item.numero_processo_sei or item.numero_sei or ""
    db.add(m.Notificacao(
        caixa_entrada_id=item_id,
        tipo="documento_externo",
        titulo="Documento externo registrado",
        descricao=f"Novo documento externo juntado ao processo {numero} em {data_mais_recente.strftime('%d/%m/%Y')}. {descricao_andamento}",
    ))
    db.commit()


# ==============================================================================
# Rotas
# ==============================================================================

@router.get("/{item_id}/fases", response_model=list[FaseOut])
def listar_fases(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista todas as fases percorridas pelo processo (ordem cronológica)."""
    _obter_item(item_id, db)
    stmt = (
        select(m.FaseProcessoAndamento)
        .where(m.FaseProcessoAndamento.caixa_entrada_id == item_id)
        .order_by(m.FaseProcessoAndamento.data_entrada.asc())
    )
    return db.scalars(stmt).all()


@router.get("/{item_id}/fase-atual")
def obter_fase_atual(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Retorna a fase atual do processo e quais são as próximas.

    Também verifica em tempo real se houve documento externo (tarefa 13) no SEI
    que deveria ter avançado a fase automaticamente — caso a automação agendada
    ainda não tenha rodado.
    """
    item = _obter_item(item_id, db)
    fase = _fase_atual(item_id, db)

    # Verificação em tempo real: detectar documentos externos em qualquer fase
    if fase:
        # Fases de espera: abre o prazo da defesa se o SEI já registra o acesso
        # externo, reinicia na visualização e avança a fase se houve juntada
        # (síncrono — a tela precisa refletir isso na hora)
        if fase.fase in ("aguardando_defesa", "aguardando_alegacoes"):
            _sincronizar_prazo_com_sei(db, item, item_id, fase.fase)
            # Recarregar fase após possível avanço
            fase = _fase_atual(item_id, db)
        else:
            # Notificação de documento externo em background (não bloqueia)
            import threading
            from app.db.base import get_engine, get_sessionmaker
            _item_id = item_id
            _item_proc = item.id_procedimento_processo or item.id_procedimento
            _item_unidade = item.id_unidade_sei or "110053117"
            _item_numero = item.numero_processo_sei or item.numero_sei or ""
            _item_razao = item.razao_social or ""
            def _bg_notif():
                try:
                    engine = get_engine()
                    SessionLocal = get_sessionmaker(engine)
                    with SessionLocal() as bg_db:
                        bg_item = bg_db.get(m.CaixaEntrada, _item_id)
                        if bg_item:
                            _verificar_documento_externo_notificar(bg_db, bg_item, _item_id)
                except Exception:
                    pass
            threading.Thread(target=_bg_notif, daemon=True).start()

    if not fase:
        return {"fase_atual": None, "proxima_fase": FASES_PROCESSO[0], "todas": FASES_PROCESSO}

    from app.services.catalogo_fases import FASES_DE_ESPERA

    passo, ultimo, indice, total = _passo_atual(db, item_id, fase.fase)
    proxima = _proxima_fase(fase.fase)

    return {
        "fase_atual": fase.fase,
        "data_entrada": str(fase.data_entrada),
        "proxima_fase": proxima,
        "todas": FASES_PROCESSO,
        # Documento que a fase espera agora. A tela usa isso para rotular o
        # botão e mostrar "passo 2 de 3" nas fases com mais de um documento.
        "passo_atual": None if not passo else {
            "titulo": passo.titulo,
            "descricao": passo.descricao,
            "chave_documento": passo.chave_documento,
            "numero": indice + 1,
            "total": total,
            "ultimo": ultimo,
            "cargos_assinatura": list(passo.cargos_assinatura),
            "dias_prazo": passo.dias_prazo,
            # "documento" (o app gera do modelo) ou "anexo" (PDF do usuário)
            "tipo": passo.tipo,
            # Variantes do agente: os modelos oficiais têm uma versão por
            # motivo/situação, e é o analista quem escolhe.
            "modelos": passo.opcoes(db, item.agente_regulado),
        },
        "total_passos": total,
        "passos_concluidos": indice if passo else total,
        # Texto exibido nas fases em que o app não age (esperando o interessado)
        "aguardando": FASES_DE_ESPERA.get(fase.fase),
    }


@router.post("/{item_id}/avancar-fase", response_model=FaseOut)
def avancar_fase(
    item_id: int,
    dados: AvancarFaseIn = AvancarFaseIn(),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Avança o processo para a próxima fase na sequência.

    Não é permitido pular fases. Se o processo não tem fase ainda, inicia
    na primeira (instauracao).
    """
    _obter_item(item_id, db)
    fase_reg = _fase_atual(item_id, db)

    if not fase_reg:
        nova_fase = FASES_PROCESSO[0]
    else:
        # Fechar a fase atual
        from app.db.models import _agora
        fase_reg.data_saida = _agora()
        nova_fase = _proxima_fase(fase_reg.fase)
        if not nova_fase:
            raise HTTPException(400, "O processo já está na fase final (encerrado).")

    nome_autor = usuario.nome or usuario.email or "Sistema"
    observacao = dados.observacao

    nova = m.FaseProcessoAndamento(
        caixa_entrada_id=item_id,
        fase=nova_fase,
        autor=nome_autor,
        observacao=observacao,
    )
    db.add(nova)

    _registrar_evento(
        db, item_id, "fase_avancada",
        f"Processo avançou para fase: {nova_fase}",
        autor=nome_autor,
        dados={"fase": nova_fase, "observacao": observacao},
    )

    # Criar prazo automaticamente quando a fase exige
    if nova_fase == "aguardando_alegacoes":
        from datetime import timedelta
        hoje = date.today()
        dias = calculo_prazos.dias_do_tipo("alegacoes_finais", 7)
        vencimento = calculo_prazos.calcular_vencimento(hoje, dias, db)
        prazo = m.PrazoProcesso(
            caixa_entrada_id=item_id,
            fase="aguardando_alegacoes",
            dias=dias,
            data_inicio=hoje,
            data_vencimento=vencimento,
            status="em_andamento",
            registrado_sei=False,
        )
        db.add(prazo)
        _registrar_evento(
            db, item_id, "prazo_definido",
            f"Prazo de {dias} dias para alegações finais iniciado (vence em {vencimento.strftime('%d/%m/%Y')})",
            autor=nome_autor,
        )
    elif nova_fase == "recurso":
        hoje = date.today()
        dias = calculo_prazos.dias_do_tipo("recurso", 15)
        vencimento = calculo_prazos.calcular_vencimento(hoje, dias, db)
        prazo = m.PrazoProcesso(
            caixa_entrada_id=item_id,
            fase="recurso",
            dias=dias,
            data_inicio=hoje,
            data_vencimento=vencimento,
            status="em_andamento",
            registrado_sei=False,
        )
        db.add(prazo)
        _registrar_evento(
            db, item_id, "prazo_definido",
            f"Prazo de {dias} dias para interposição de recurso iniciado (vence em {vencimento.strftime('%d/%m/%Y')})",
            autor=nome_autor,
        )

    db.commit()
    db.refresh(nova)
    return nova


@router.post("/{item_id}/definir-prazo", response_model=PrazoOut)
def definir_prazo(
    item_id: int,
    dados: DefinirPrazoIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Define um prazo para o processo (15 dias defesa, 7 dias alegações, etc.).

    O prazo é registrado no nosso banco E na API do SEI (POST /processos/{numero}/prazo).
    O usuário pode informar `dias` (ex.: 15) ou `data_vencimento` (dd/mm/yyyy).
    """
    item = _obter_item(item_id, db)
    fase_reg = _fase_atual(item_id, db)

    if not fase_reg:
        raise HTTPException(400, "Processo ainda não tem fase definida. Avance a fase primeiro.")

    # Calcular datas
    hoje = date.today()
    if dados.data_vencimento:
        # Formato dd/mm/yyyy
        partes = dados.data_vencimento.split("/")
        data_venc = date(int(partes[2]), int(partes[1]), int(partes[0]))
        dias = (data_venc - hoje).days
    elif dados.dias:
        dias = dados.dias
        data_venc = calculo_prazos.calcular_vencimento(hoje, dias, db)
    else:
        raise HTTPException(400, "Informe 'dias' ou 'data_vencimento'.")

    if data_venc <= hoje:
        raise HTTPException(400, "A data de vencimento deve ser futura.")

    # Registrar no SEI
    numero_processo = item.numero_processo_sei or item.numero_sei
    id_unidade = item.id_unidade_sei or "110053117"
    registrado_sei = False

    if numero_processo:
        try:
            sei = _get_sei_client()
            data_formatada = data_venc.strftime("%d/%m/%Y")
            sei.definir_prazo(numero_processo, id_unidade, data_prazo=data_formatada)
            registrado_sei = True
        except Exception as e:
            # Não bloquear se o SEI falhar — registra localmente mesmo assim
            pass

    # Gravar no banco
    prazo = m.PrazoProcesso(
        caixa_entrada_id=item_id,
        fase=fase_reg.fase,
        dias=dias,
        data_inicio=hoje,
        data_vencimento=data_venc,
        status="em_andamento",
        registrado_sei=registrado_sei,
    )
    db.add(prazo)

    nome_autor = usuario.nome or usuario.email or "Sistema"
    _registrar_evento(
        db, item_id, "prazo_definido",
        f"Prazo de {dias} dias definido (vence em {data_venc.strftime('%d/%m/%Y')})",
        autor=nome_autor,
        dados={"dias": dias, "data_vencimento": str(data_venc), "registrado_sei": registrado_sei},
    )

    db.commit()
    db.refresh(prazo)
    return prazo


@router.get("/{item_id}/prazos", response_model=list[PrazoOut])
def listar_prazos(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista todos os prazos do processo."""
    _obter_item(item_id, db)
    stmt = (
        select(m.PrazoProcesso)
        .where(m.PrazoProcesso.caixa_entrada_id == item_id)
        .order_by(m.PrazoProcesso.criado_em.desc())
    )
    return db.scalars(stmt).all()


@router.get("/{item_id}/eventos", response_model=list[EventoOut])
def listar_eventos(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista todos os eventos do processo (para timeline e auditoria)."""
    _obter_item(item_id, db)
    stmt = (
        select(m.EventoProcesso)
        .where(m.EventoProcesso.caixa_entrada_id == item_id)
        .order_by(m.EventoProcesso.criado_em.desc())
    )
    return db.scalars(stmt).all()


# ==============================================================================
# Ações de fase com editor (template GET + execução POST com avanço automático)
# ==============================================================================

from pydantic import BaseModel as PydanticBaseModel


class ExecutarFaseIn(PydanticBaseModel):
    html: str
    # Modelo escolhido, quando o passo oferece mais de um. Define a série do
    # documento no SEI e é o que fica registrado como cumprido.
    modelo: str | None = None


class ResultadoFaseOut(PydanticBaseModel):
    sucesso: bool
    numero_sei: str | None = None
    documento_formatado: str | None = None
    fase_avancada_para: str | None = None
    mensagem: str


def _chaves_ja_geradas(db: Session, item_id: int, fase: str) -> set[str]:
    """Documentos desta fase que já foram incluídos no SEI.

    A fase de julgamento produz três documentos em sequência; é este conjunto
    que diz qual deles é o próximo. A informação sai dos eventos do processo,
    onde cada inclusão fica registrada com a chave do modelo usado.
    """
    eventos = db.scalars(
        select(m.EventoProcesso).where(
            m.EventoProcesso.caixa_entrada_id == item_id,
            m.EventoProcesso.tipo == "documento_gerado",
        )
    ).all()

    chaves: set[str] = set()
    for evento in eventos:
        if not evento.dados_json:
            continue
        try:
            dados = json.loads(evento.dados_json)
        except (ValueError, TypeError):
            continue
        if dados.get("fase") == fase and dados.get("chave_documento"):
            chaves.add(dados["chave_documento"])
    return chaves


def _passo_atual(db: Session, item_id: int, fase: str):
    """``(passo, e_ultimo, indice, total)`` da fase, conforme o já gerado."""
    from app.services.catalogo_fases import passo_pendente

    return passo_pendente(fase, _chaves_ja_geradas(db, item_id, fase))


@router.get("/{item_id}/fase-acao/template")
def obter_template_fase(
    item_id: int,
    modelo: str | None = Query(
        None,
        description="Modelo escolhido, quando o passo oferece mais de um "
                    "(ex.: decisao_743). Padrão: o primeiro do passo.",
    ),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Modelo do próximo documento da fase atual, pronto para o editor."""
    from app.services.catalogo_fases import montar_html

    item = _obter_item(item_id, db)
    fase = _fase_atual(item_id, db)

    if not fase:
        raise HTTPException(400, "Processo sem fase definida.")

    passo, ultimo, indice, total = _passo_atual(db, item_id, fase.fase)
    if not passo:
        raise HTTPException(
            400,
            f"A fase '{fase.fase}' não tem documento pendente para gerar."
            if total
            else f"A fase '{fase.fase}' não tem documento previsto.",
        )

    opcoes = passo.opcoes(db, item.agente_regulado)
    if not passo.aceita(modelo, db, item.agente_regulado):
        disponiveis = ", ".join(o["nome"] for o in opcoes) or "nenhuma"
        raise HTTPException(
            400,
            f"O modelo '{modelo}' não é uma opção deste passo. Disponíveis: {disponiveis}.",
        )

    if passo.tipo == "anexo":
        raise HTTPException(
            400,
            f"'{passo.titulo}' não é um documento gerado pelo app: envie o arquivo "
            "em POST /fase-acao/anexar.",
        )

    escolhido = modelo or (opcoes[0]["chave"] if opcoes else None)
    if not escolhido:
        raise HTTPException(
            424,
            f"Nenhum modelo de '{passo.titulo}' cadastrado para o agente "
            f"'{item.agente_regulado}'. Rode scripts/importar_textos_padroes.py, e se "
            "o modelo não existir, peça o texto-padrão à área.",
        )

    html = montar_html(db, escolhido, item, dias_prazo=passo.dias_prazo)
    if html is None:
        raise HTTPException(
            424,
            f"O modelo '{escolhido}' não está cadastrado. "
            "Rode scripts/importar_textos_padroes.py para carregar os textos-padrão.",
        )

    # Mesma fonte da URL usada pelos despachos, para o link do processo sair
    # igual nos dois caminhos.
    from app.api.routes.despachos import _sei_web_url
    from app.services import mala_direta

    return {
        "titulo": passo.titulo,
        "html": html,
        # Lacunas do modelo, para a tela pedir os valores antes de abrir o
        # editor — ver app/services/mala_direta.py.
        "marcadores": mala_direta.inventario(html, item, _sei_web_url()),
        "fase": fase.fase,
        "chave_documento": escolhido,
        "descricao": passo.descricao,
        "passo": indice + 1,
        "total_passos": total,
        "ultimo_passo": ultimo,
        "cargos_assinatura": list(passo.cargos_assinatura),
        "dias_prazo": passo.dias_prazo,
        "tipo": passo.tipo,
        "modelos": opcoes,
    }


@router.post("/{item_id}/fase-acao/anexar", response_model=ResultadoFaseOut)
async def anexar_documento_fase(
    item_id: int,
    arquivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Anexa um PDF no passo da fase que espera documento externo.

    Hoje o único passo assim é a manifestação da Consultoria Jurídica: ela chega
    como PDF pronto, não é redigida no app. O arquivo entra no processo como
    documento externo, e o passo conta como cumprido — se for o último da fase,
    a fase avança.
    """
    from app.services.catalogo_fases import avanco_da_fase

    item = _obter_item(item_id, db)
    fase = _fase_atual(item_id, db)
    if not fase:
        raise HTTPException(400, "Processo sem fase definida.")

    passo, ultimo, _indice, total = _passo_atual(db, item_id, fase.fase)
    if not passo:
        raise HTTPException(
            400,
            f"A fase '{fase.fase}' não tem documento pendente."
            if total
            else f"A fase '{fase.fase}' não tem documento previsto.",
        )
    if passo.tipo != "anexo":
        raise HTTPException(
            400,
            f"O passo atual é '{passo.titulo}', que o app gera a partir de modelo. "
            "Use POST /fase-acao/executar.",
        )

    conteudo = await arquivo.read()
    if not conteudo:
        raise HTTPException(400, "Arquivo vazio.")
    if len(conteudo) > 10 * 1024 * 1024:
        raise HTTPException(400, "Arquivo excede o limite de 10 MB.")

    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    id_unidade = item.id_unidade_sei or _unidade_padrao()
    if not id_procedimento:
        raise HTTPException(400, "Processo sem id_procedimento.")
    if not id_unidade:
        raise HTTPException(503, "Nenhuma unidade SEI definida para o item.")

    sei = _get_sei_client()
    nome_arquivo = arquivo.filename or f"{passo.chave_documento}.pdf"

    # Upload e inclusão precisam usar a mesma unidade — regra da API do SEI.
    try:
        id_arquivo = sei.upload_arquivo(id_unidade, nome_arquivo, conteudo)
    except Exception as e:
        raise HTTPException(502, f"Erro ao enviar o arquivo ao SEI: {e}")

    try:
        resultado = sei.incluir_documento_externo(
            id_procedimento=id_procedimento,
            id_unidade=id_unidade,
            id_arquivo=id_arquivo,
            nome_arvore=passo.nome_arvore,
            id_serie=ID_SERIE_ANEXO,
            descricao=passo.titulo,
        )
    except Exception as e:
        raise HTTPException(502, f"Erro ao incluir o documento no processo: {e}")

    documento_formatado = resultado.get("documentoFormatado", "")

    from app.services import cache_sei as _cache
    _cache.invalidar_processo(db, id_procedimento)

    nome_autor = usuario.nome or usuario.email or "Sistema"
    _registrar_evento(
        db, item_id, "documento_gerado",
        f"{passo.titulo} anexada: {documento_formatado} ({nome_arquivo})",
        autor=nome_autor,
        dados={
            "fase": fase.fase,
            "documento": documento_formatado,
            "chave_documento": passo.chave_documento,
        },
    )

    fase_destino = avanco_da_fase(fase.fase) if ultimo else None
    if fase_destino:
        from app.db.models import _agora
        fase.data_saida = _agora()
        db.add(m.FaseProcessoAndamento(
            caixa_entrada_id=item_id,
            fase=fase_destino,
            autor=nome_autor,
            observacao=f"Fase avançada após anexar: {passo.titulo}",
        ))
        _registrar_evento(
            db, item_id, "fase_avancada",
            f"Fase avançada: {fase.fase} → {fase_destino}",
            autor=nome_autor,
        )

    db.commit()

    mensagem = f"{passo.titulo} anexada ao processo ({documento_formatado})."
    if fase_destino:
        mensagem += f" Fase avançada para: {fase_destino}."

    return ResultadoFaseOut(
        sucesso=True,
        numero_sei=item.numero_processo_sei or item.numero_sei,
        documento_formatado=documento_formatado,
        fase_avancada_para=fase_destino,
        mensagem=mensagem,
    )


def _incluir_nos_blocos(
    sei: SeiClient,
    db: Session,
    item: m.CaixaEntrada,
    documento_formatado: str,
    cargos: tuple[str, ...],
    id_unidade: str,
) -> list[str]:
    """Inclui o documento nos blocos de assinatura dos cargos indicados.

    Devolve avisos: o documento já existe no SEI neste ponto, então falhar aqui
    não invalida o que foi feito — mas o usuário precisa saber que terá de
    incluir no bloco manualmente.
    """
    avisos: list[str] = []
    agente = item.agente_regulado or ""

    for cargo in cargos:
        config = db.query(m.ConfigBlocoAssinatura).filter_by(
            agente_regulado=agente, cargo=cargo,
        ).first()
        if not config:
            avisos.append(
                f"Nenhum bloco de assinatura cadastrado para '{agente}' / '{cargo}'. "
                f"Inclua o documento {documento_formatado} manualmente no bloco correto."
            )
            continue
        try:
            sei.incluir_documento_bloco(config.id_bloco, documento_formatado, id_unidade)
        except Exception as e:  # noqa: BLE001
            avisos.append(
                f"O documento {documento_formatado} foi criado, mas não entrou no bloco "
                f"de assinatura de '{cargo}' ({e}). Inclua manualmente no SEI."
            )
    return avisos


@router.post("/{item_id}/fase-acao/executar", response_model=ResultadoFaseOut)
def executar_acao_fase(
    item_id: int,
    dados: ExecutarFaseIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Inclui o documento do passo atual, abre prazo e avança a fase se acabou.

    A fase só avança quando o último documento previsto para ela é incluído —
    julgamento, por exemplo, exige encaminhamento à CJ, relatório opinativo e
    decisão antes de passar para recurso.
    """
    from app.services.catalogo_fases import avanco_da_fase

    item = _obter_item(item_id, db)
    fase = _fase_atual(item_id, db)

    if not fase:
        raise HTTPException(400, "Processo sem fase definida.")

    passo, ultimo, _indice, total = _passo_atual(db, item_id, fase.fase)
    if not passo:
        raise HTTPException(
            400,
            f"A fase '{fase.fase}' não tem documento pendente para gerar."
            if total
            else f"A fase '{fase.fase}' não tem documento previsto.",
        )

    opcoes = passo.opcoes(db, item.agente_regulado)
    if not passo.aceita(dados.modelo, db, item.agente_regulado):
        disponiveis = ", ".join(o["nome"] for o in opcoes) or "nenhuma"
        raise HTTPException(
            400,
            f"O modelo '{dados.modelo}' não é uma opção deste passo. Disponíveis: {disponiveis}.",
        )
    if passo.tipo == "anexo":
        raise HTTPException(
            400,
            f"'{passo.titulo}' é um anexo: use POST /fase-acao/anexar.",
        )
    modelo_escolhido = dados.modelo or (opcoes[0]["chave"] if opcoes else passo.funcao)

    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    id_unidade = item.id_unidade_sei or _unidade_padrao()
    if not id_procedimento:
        raise HTTPException(400, "Processo sem id_procedimento.")
    if not id_unidade:
        raise HTTPException(
            503,
            "Nenhuma unidade SEI definida para o item e SEI_UNIDADE_PROCESSAMENTO_PADRAO "
            "não está configurada.",
        )

    sei = _get_sei_client()
    nome_autor = usuario.nome or usuario.email or "Sistema"
    numero_processo = item.numero_processo_sei or item.numero_sei

    # 1. Inclui o documento no SEI, na série do modelo escolhido.
    try:
        doc = sei.incluir_documento(
            id_procedimento=id_procedimento,
            id_unidade=id_unidade,
            id_serie=passo.id_serie(modelo_escolhido),
            html=dados.html,
            nome_arvore=passo.nome_arvore,
            nivel_acesso="1",
        )
    except Exception as e:
        raise HTTPException(502, f"Erro ao incluir documento no SEI: {e}")

    documento_formatado = doc.get("documentoFormatado", "")

    # Acabamos de incluir um documento: a lista cacheada deste processo está
    # desatualizada. Invalidar para o usuário ver o documento novo na hora.
    from app.services import cache_sei as _cache
    _cache.invalidar_processo(db, id_procedimento)

    # 2. Bloco de assinatura de cada cargo responsável.
    avisos = _incluir_nos_blocos(
        sei, db, item, documento_formatado, passo.cargos_assinatura, id_unidade,
    )

    # 3. Prazo, quando o documento abre um (intimação: 7 dias; recurso: 15).
    if passo.dias_prazo and numero_processo:
        try:
            vencimento = calculo_prazos.calcular_vencimento(date.today(), passo.dias_prazo, db)
            sei.definir_prazo(
                numero_processo, id_unidade, data_prazo=vencimento.strftime("%d/%m/%Y"),
            )
            db.add(m.PrazoProcesso(
                caixa_entrada_id=item_id,
                fase=fase.fase,
                dias=passo.dias_prazo,
                data_inicio=date.today(),
                data_vencimento=vencimento,
                status="ativo",
                registrado_sei=True,
            ))
        except Exception as e:  # noqa: BLE001
            avisos.append(
                f"O documento foi incluído, mas o prazo de {passo.dias_prazo} dias não "
                f"pôde ser aberto no SEI ({e}). Abra o prazo manualmente."
            )

    # 4. Registra o evento com a chave do modelo — é o que permite saber, na
    #    próxima vez, qual passo da fase ainda falta.
    _registrar_evento(
        db, item_id, "documento_gerado",
        f"{passo.titulo} gerado: {documento_formatado}",
        autor=nome_autor,
        dados={
            "fase": fase.fase,
            "documento": documento_formatado,
            "chave_documento": modelo_escolhido,
        },
    )

    # 5. Avança a fase somente depois do último documento previsto.
    fase_destino = avanco_da_fase(fase.fase) if ultimo else None
    if fase_destino:
        from app.db.models import _agora
        fase.data_saida = _agora()
        db.add(m.FaseProcessoAndamento(
            caixa_entrada_id=item_id,
            fase=fase_destino,
            autor=nome_autor,
            observacao=f"Fase avançada após geração de: {passo.titulo}",
        ))
        _registrar_evento(
            db, item_id, "fase_avancada",
            f"Fase avançada: {fase.fase} → {fase_destino}",
            autor=nome_autor,
        )

    db.commit()

    mensagem = f"{passo.titulo} incluído no SEI ({documento_formatado})."
    if fase_destino:
        mensagem += f" Fase avançada para: {fase_destino}."
    elif total > 1:
        restantes = total - (_indice + 1)
        if restantes > 0:
            mensagem += f" Faltam {restantes} documento(s) nesta fase."
    if avisos:
        mensagem += " " + " ".join(avisos)

    return ResultadoFaseOut(
        sucesso=True,
        numero_sei=numero_processo,
        documento_formatado=documento_formatado,
        fase_avancada_para=fase_destino,
        mensagem=mensagem,
    )
