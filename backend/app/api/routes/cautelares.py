"""Painel de medidas cautelares (Documentação de Negócio v3.0).

Competência: Coordenadoria Geral de Gestão de Agentes e Atividades Reguladas.
Fundamento: art. 62, parágrafo único, da Lei Estadual nº 10.177/1998.

Tela de acompanhamento prioritário: os agentes com cautelar estão bloqueados e
impedidos de operar. Se apresentam defesa, é preciso analisar de imediato se a
medida se mantém ou é revogada — a demora aqui recai sobre o agente.

Ciclo de vida implementado, conforme o documento:

1. Instauração com cautelar coloca o processo nesta fila (``aprovacao`` =
   ``pendente``).
2. O Coordenador Geral **concorda** (segue para assinatura, com o link do bloco
   no SEI) ou **recusa** (o processo volta à caixa de entrada marcado com
   cautelar recusada, para o texto ser reeditado sem a parte da cautelar).
3. Assinada, entra a certidão de bloqueio com evidência de tela do sistema
   legado.
4. A medida é acompanhada pelo prazo (30/45/60/90 dias), podendo ser renovada
   antes do vencimento ou revogada — e a revogação gera certidão de desbloqueio.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_db
from app.core.security import (
    UsuarioAutenticado,
    e_coordenador_geral,
    get_current_user,
)
from app.db import models as m
from app.schemas.cautelares import (
    CautelarCreate,
    CautelarOut,
    CautelarRecusar,
    CautelarRenovar,
    CautelarResumo,
    CautelarRevogar,
)
from app.services import calculo_prazos as cp

router = APIRouter(prefix="/cautelares", tags=["cautelares"])

PRAZOS_PERMITIDOS = cp.PRAZOS_CAUTELAR

#: Situações em que a medida ainda produz efeito (agente bloqueado).
SITUACOES_ATIVAS = ("vigente", "vencendo", "vencida")


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _calcular_data_fim(data_inicio: date, prazo_dias: int, db: Session | None = None) -> date:
    """Vencimento da cautelar pela mesma regra legal dos demais prazos."""
    return cp.calcular_vencimento(data_inicio, prazo_dias, db)


def _situacao(cautelar: m.Cautelar, hoje: date | None = None) -> str:
    """Situação computada: vigente, vencendo (≤3 dias), vencida, renovada, revogada.

    O limiar de "vencendo" era 7 dias e passou a 3, para casar com o semáforo
    de prazos — o documento manda usar o mesmo código de cores nas duas telas.
    """
    hoje = hoje or date.today()
    if cautelar.situacao in ("renovada", "revogada"):
        return cautelar.situacao
    if not cautelar.data_fim:
        return "vigente"
    if cautelar.data_fim < hoje:
        return "vencida"
    if (cautelar.data_fim - hoje).days <= cp.DIAS_VERDE - 1:
        return "vencendo"
    return "vigente"


def _dias_restantes(cautelar: m.Cautelar, hoje: date | None = None) -> int | None:
    """Dias até o vencimento, negativo quando vencida.

    Antes o valor era truncado em zero, o que apagava o "há quantos dias
    venceu" — justamente o dado que mede o atraso.
    """
    return cp.dias_restantes(cautelar.data_fim, hoje)


def _ids_com_defesa(db: Session, ids_caixa: list[int]) -> set[int]:
    """Quais processos com cautelar já tiveram defesa juntada.

    Dois sinais, porque a defesa pode ser detectada pela automação (que fecha o
    prazo como respondido) ou registrada como evento pela verificação em tempo
    real: prazo de defesa com status ``respondido`` ou evento
    ``defesa_juntada``.
    """
    if not ids_caixa:
        return set()

    por_prazo = select(m.PrazoProcesso.caixa_entrada_id).where(
        m.PrazoProcesso.caixa_entrada_id.in_(ids_caixa),
        m.PrazoProcesso.fase == "aguardando_defesa",
        m.PrazoProcesso.status == "respondido",
    )
    por_evento = select(m.EventoProcesso.caixa_entrada_id).where(
        m.EventoProcesso.caixa_entrada_id.in_(ids_caixa),
        m.EventoProcesso.tipo.in_(("defesa_juntada", "defesa_intempestiva")),
    )
    achados = set(db.scalars(por_prazo).all())
    achados |= set(db.scalars(por_evento).all())
    return achados


def _status_bloqueio(cautelar: m.Cautelar, situacao: str, com_defesa: bool) -> str:
    """Estado do bloqueio para a coluna da tela.

    ``revisar`` cobre os dois casos que pedem decisão: defesa apresentada por
    agente bloqueado e cautelar vencida sem renovação — nos dois, manter o
    bloqueio como "ativo" esconderia uma pendência.
    """
    if situacao == "revogada" or cautelar.data_revogacao:
        return "revogado"
    if com_defesa or situacao == "vencida":
        return "revisar"
    return "ativo"


def _to_out(c: m.Cautelar, com_defesa: bool = False, hoje: date | None = None) -> CautelarOut:
    situacao = _situacao(c, hoje)
    restantes = _dias_restantes(c, hoje)
    item = c.caixa_entrada
    return CautelarOut(
        id=c.id,
        processo_id=c.processo_id,
        caixa_entrada_id=c.caixa_entrada_id,
        agente_id=c.agente_id,
        tipo=c.tipo,
        data_inicio=c.data_inicio,
        data_fim=c.data_fim,
        prazo_dias=c.prazo_dias,
        situacao=situacao,
        fundamentacao=c.fundamentacao,
        unidade_responsavel=c.unidade_responsavel,
        numero_sei_certidao=c.numero_sei_certidao,
        renovada_de_id=c.renovada_de_id,
        criado_em=c.criado_em,
        aprovacao=c.aprovacao,
        aprovada_por=c.aprovada_por,
        motivo_recusa=c.motivo_recusa,
        pendente_assinatura=bool(c.pendente_assinatura),
        link_bloco_sei=c.link_bloco_sei,
        data_revogacao=c.data_revogacao,
        revogada_por=c.revogada_por,
        motivo_revogacao=c.motivo_revogacao,
        numero_sei_certidao_desbloqueio=c.numero_sei_certidao_desbloqueio,
        dias_restantes=restantes,
        semaforo=cp.semaforo(restantes) if situacao in SITUACOES_ATIVAS else None,
        status_bloqueio=_status_bloqueio(c, situacao, com_defesa),
        defesa_apresentada=com_defesa,
        # O item da caixa de entrada é a fonte preferida: é o que o fluxo real
        # preenche. A tabela `processo`/`agente_regulado` cobre a base migrada.
        numero_sei_processo=(
            (item.numero_processo_sei or item.numero_sei) if item
            else (c.processo.numero_sei if c.processo else None)
        ),
        razao_social=item.razao_social if item else (c.agente.razao_social if c.agente else None),
        cnpj_cpf=item.cnpj_cpf if item else (c.agente.cnpj_cpf if c.agente else None),
        agente_regulado=item.agente_regulado if item else (c.agente.segmento if c.agente else None),
        prioritario=bool(item.prioritario) if item else False,
    )


def _carregar(db: Session, cautelar_id: int) -> m.Cautelar:
    c = db.get(m.Cautelar, cautelar_id)
    if not c:
        raise HTTPException(404, "Cautelar não encontrada.")
    return c


def _registrar_evento(db: Session, cautelar: m.Cautelar, tipo: str, descricao: str, autor: str) -> None:
    """Evento no processo, quando a cautelar está ligada a um item da caixa."""
    if cautelar.caixa_entrada_id:
        db.add(m.EventoProcesso(
            caixa_entrada_id=cautelar.caixa_entrada_id,
            tipo=tipo,
            descricao=descricao,
            autor=autor,
        ))


# --------------------------------------------------------------------------
# Consulta
# --------------------------------------------------------------------------


@router.get("/resumo", response_model=CautelarResumo)
def obter_resumo(
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Cartões do painel: vigentes, vencendo (≤3 dias), vencidas, ⚑ defesa e fila do Coordenador."""
    hoje = date.today()
    cautelares = db.scalars(
        select(m.Cautelar).options(joinedload(m.Cautelar.caixa_entrada))
    ).unique().all()

    ids = [c.caixa_entrada_id for c in cautelares if c.caixa_entrada_id]
    com_defesa = _ids_com_defesa(db, ids)

    resumo = CautelarResumo()
    for c in cautelares:
        situacao = _situacao(c, hoje)
        if situacao == "vigente":
            resumo.vigentes += 1
        elif situacao == "vencendo":
            resumo.vencendo += 1
        elif situacao == "vencida":
            resumo.vencidas += 1
        if situacao in SITUACOES_ATIVAS and c.caixa_entrada_id in com_defesa:
            resumo.defesa_apresentada += 1
        if (c.aprovacao or "pendente") == "pendente" and situacao in SITUACOES_ATIVAS:
            resumo.aguardando_aprovacao += 1

    return resumo


@router.get("", response_model=list[CautelarOut])
def listar_cautelares(
    situacao: str | None = Query(None, description="vigente | vencendo | vencida | renovada | revogada"),
    unidade: str | None = Query(None),
    aprovacao: str | None = Query(None, description="pendente | aprovada | recusada"),
    somente_com_defesa: bool = Query(False, description="Só as que exigem revisão por defesa apresentada"),
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista as cautelares. As que exigem revisão sobem ao topo da fila.

    A ordem segue a urgência operacional descrita no documento: defesa
    apresentada primeiro (o agente está impedido de trabalhar e há decisão
    pendente), depois pelo vencimento mais próximo.
    """
    hoje = date.today()
    stmt = (
        select(m.Cautelar)
        .options(
            joinedload(m.Cautelar.caixa_entrada),
            joinedload(m.Cautelar.processo),
            joinedload(m.Cautelar.agente),
        )
        .order_by(m.Cautelar.data_fim.asc())
    )
    if unidade:
        stmt = stmt.where(m.Cautelar.unidade_responsavel.ilike(f"%{unidade}%"))
    if aprovacao:
        if aprovacao == "pendente":
            stmt = stmt.where(
                or_(m.Cautelar.aprovacao.is_(None), m.Cautelar.aprovacao == "pendente")
            )
        else:
            stmt = stmt.where(m.Cautelar.aprovacao == aprovacao)

    cautelares = db.scalars(stmt).unique().all()
    ids = [c.caixa_entrada_id for c in cautelares if c.caixa_entrada_id]
    com_defesa = _ids_com_defesa(db, ids)

    resultado = [
        _to_out(c, com_defesa=c.caixa_entrada_id in com_defesa, hoje=hoje)
        for c in cautelares
    ]

    # Situação é computada, por isso o filtro é aplicado em memória.
    if situacao:
        resultado = [r for r in resultado if r.situacao == situacao]
    if somente_com_defesa:
        resultado = [r for r in resultado if r.defesa_apresentada]

    resultado.sort(key=lambda r: (not r.defesa_apresentada, r.data_fim or date.max))
    return resultado


@router.get("/{cautelar_id}", response_model=CautelarOut)
def obter_cautelar(
    cautelar_id: int,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Detalhe de uma cautelar."""
    c = _carregar(db, cautelar_id)
    com_defesa = bool(c.caixa_entrada_id) and c.caixa_entrada_id in _ids_com_defesa(
        db, [c.caixa_entrada_id]
    )
    return _to_out(c, com_defesa=com_defesa)


# --------------------------------------------------------------------------
# Aplicação, concordância e recusa
# --------------------------------------------------------------------------


@router.post("", response_model=CautelarOut, status_code=201)
def criar_cautelar(
    dados: CautelarCreate,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Aplica medida cautelar e a coloca na fila do Coordenador Geral.

    Nasce com ``aprovacao = pendente``: quem instaura indica a medida, mas a
    aplicação é de competência do Coordenador Geral.
    """
    if dados.prazo_dias not in PRAZOS_PERMITIDOS:
        raise HTTPException(422, f"Prazo inválido. Permitidos: {PRAZOS_PERMITIDOS} dias.")
    if not dados.processo_id and not dados.caixa_entrada_id:
        raise HTTPException(422, "Informe 'caixa_entrada_id' ou 'processo_id'.")

    agente_id = dados.agente_id
    if dados.processo_id:
        processo = db.get(m.Processo, dados.processo_id)
        if not processo:
            raise HTTPException(404, "Processo não encontrado.")
        agente_id = agente_id or processo.agente_id
    if dados.caixa_entrada_id and not db.get(m.CaixaEntrada, dados.caixa_entrada_id):
        raise HTTPException(404, "Item da caixa de entrada não encontrado.")

    cautelar = m.Cautelar(
        processo_id=dados.processo_id,
        caixa_entrada_id=dados.caixa_entrada_id,
        agente_id=agente_id,
        tipo=dados.tipo,
        data_inicio=dados.data_inicio,
        data_fim=_calcular_data_fim(dados.data_inicio, dados.prazo_dias, db),
        prazo_dias=dados.prazo_dias,
        situacao="vigente",
        fundamentacao=dados.fundamentacao,
        unidade_responsavel=dados.unidade_responsavel,
        aprovacao="pendente",
    )
    db.add(cautelar)
    db.flush()
    _registrar_evento(
        db, cautelar, "cautelar_aplicada",
        f"Medida cautelar de {dados.prazo_dias} dias indicada, aguardando concordância "
        "do Coordenador Geral.",
        usuario.nome or usuario.email or "Sistema",
    )
    db.commit()
    db.refresh(cautelar)
    return _to_out(cautelar)


@router.post("/{cautelar_id}/aprovar", response_model=CautelarOut)
def aprovar_cautelar(
    cautelar_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Coordenador Geral concorda com a medida: segue para assinatura."""
    if not e_coordenador_geral(usuario, db):
        raise HTTPException(
            403,
            "A concordância com a medida cautelar é de competência exclusiva do "
            "Coordenador Geral (art. 62, parágrafo único, da Lei 10.177/1998).",
        )
    c = _carregar(db, cautelar_id)
    autor = usuario.nome or usuario.email or "Sistema"
    c.aprovacao = "aprovada"
    c.aprovada_por = autor
    c.aprovada_em = m._agora()
    c.motivo_recusa = None
    # A certidão de bloqueio nasce pendente de assinatura no SEI.
    c.pendente_assinatura = True
    _registrar_evento(
        db, c, "cautelar_aprovada",
        "Coordenador Geral concordou com a medida cautelar; documento segue para assinatura.",
        autor,
    )
    db.commit()
    db.refresh(c)
    return _to_out(c)


@router.post("/{cautelar_id}/recusar", response_model=CautelarOut)
def recusar_cautelar(
    cautelar_id: int,
    dados: CautelarRecusar,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Coordenador Geral recusa a medida: o processo volta à caixa de entrada.

    O item volta para triagem marcado com cautelar recusada, para o analista
    reeditar o texto-padrão da instauração removendo a parte da cautelar,
    aproveitando os dados de qualificação já preenchidos.
    """
    if not e_coordenador_geral(usuario, db):
        raise HTTPException(
            403,
            "A recusa da medida cautelar é de competência exclusiva do Coordenador Geral.",
        )
    motivo = (dados.motivo or "").strip()
    if not motivo:
        raise HTTPException(422, "Informe o motivo da recusa.")

    c = _carregar(db, cautelar_id)
    autor = usuario.nome or usuario.email or "Sistema"
    c.aprovacao = "recusada"
    c.aprovada_por = autor
    c.aprovada_em = m._agora()
    c.motivo_recusa = motivo
    c.situacao = "revogada"
    c.pendente_assinatura = False

    item = c.caixa_entrada or (
        db.get(m.CaixaEntrada, c.caixa_entrada_id) if c.caixa_entrada_id else None
    )
    if item:
        item.status_triagem = "cautelar_recusada"
        _registrar_evento(
            db, c, "cautelar_recusada",
            f"Coordenador Geral recusou a medida cautelar: {motivo}. "
            "Processo devolvido à caixa de entrada para reedição do termo sem a cautelar.",
            autor,
        )
    db.commit()
    db.refresh(c)
    return _to_out(c)


# --------------------------------------------------------------------------
# Renovação e revogação
# --------------------------------------------------------------------------


@router.post("/{cautelar_id}/renovar", response_model=CautelarOut, status_code=201)
def renovar_cautelar(
    cautelar_id: int,
    dados: CautelarRenovar,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Renova a cautelar, criando outra com referência à anterior.

    A original fica como ``renovada`` e a nova começa no dia seguinte ao
    vencimento (ou hoje, se já passou).
    """
    if not e_coordenador_geral(usuario, db):
        raise HTTPException(
            403, "A renovação da medida cautelar é de competência exclusiva do Coordenador Geral."
        )
    if dados.prazo_dias not in PRAZOS_PERMITIDOS:
        raise HTTPException(422, f"Prazo inválido. Permitidos: {PRAZOS_PERMITIDOS} dias.")

    original = _carregar(db, cautelar_id)
    if original.data_revogacao:
        raise HTTPException(409, "Cautelar revogada não pode ser renovada.")

    original.situacao = "renovada"

    hoje = date.today()
    inicio = max(
        (original.data_fim + timedelta(days=1)) if original.data_fim else hoje,
        hoje,
    )
    nova = m.Cautelar(
        processo_id=original.processo_id,
        caixa_entrada_id=original.caixa_entrada_id,
        agente_id=original.agente_id,
        tipo=original.tipo,
        data_inicio=inicio,
        data_fim=_calcular_data_fim(inicio, dados.prazo_dias, db),
        prazo_dias=dados.prazo_dias,
        situacao="vigente",
        fundamentacao=original.fundamentacao,
        unidade_responsavel=original.unidade_responsavel,
        renovada_de_id=original.id,
        # Renovação parte de medida já concordada: não volta para a fila.
        aprovacao="aprovada",
        aprovada_por=usuario.nome or usuario.email or "Sistema",
        aprovada_em=m._agora(),
    )
    db.add(nova)
    db.flush()
    _registrar_evento(
        db, nova, "cautelar_renovada",
        f"Medida cautelar renovada por {dados.prazo_dias} dias "
        f"(vence em {nova.data_fim.strftime('%d/%m/%Y') if nova.data_fim else '-'}).",
        usuario.nome or usuario.email or "Sistema",
    )
    db.commit()
    db.refresh(nova)
    return _to_out(nova)


@router.post("/{cautelar_id}/revogar", response_model=CautelarOut)
def revogar_cautelar(
    cautelar_id: int,
    dados: CautelarRevogar,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Revoga a medida: o agente volta a operar e cabe certidão de desbloqueio.

    Caminho típico depois de o agente bloqueado apresentar defesa: a revisão
    conclui que a medida não se sustenta. A revogação exige fundamentação, e a
    certidão de desbloqueio segue a mesma lógica de assinatura e evidência da
    de bloqueio.
    """
    if not e_coordenador_geral(usuario, db):
        raise HTTPException(
            403, "A revogação da medida cautelar é de competência exclusiva do Coordenador Geral."
        )
    motivo = (dados.motivo or "").strip()
    if not motivo:
        raise HTTPException(422, "Informe a fundamentação da revogação.")

    c = _carregar(db, cautelar_id)
    if c.data_revogacao:
        raise HTTPException(409, "Esta cautelar já foi revogada.")

    autor = usuario.nome or usuario.email or "Sistema"
    c.situacao = "revogada"
    c.data_revogacao = date.today()
    c.revogada_por = autor
    c.motivo_revogacao = motivo
    # A certidão de desbloqueio entra na fila de assinatura, como a de bloqueio.
    c.pendente_assinatura = True
    _registrar_evento(
        db, c, "cautelar_revogada",
        f"Medida cautelar revogada: {motivo}. Pendente certidão de desbloqueio.",
        autor,
    )
    db.commit()
    db.refresh(c)
    return _to_out(c)


# --------------------------------------------------------------------------
# Certidões (bloqueio e desbloqueio)
# --------------------------------------------------------------------------

EXTENSOES_PERMITIDAS = (".pdf", ".png", ".jpg", ".jpeg", ".tiff")


def _validar_evidencia(arquivo: UploadFile) -> None:
    if not arquivo.filename:
        raise HTTPException(422, "Arquivo obrigatório.")
    ext = "." + arquivo.filename.rsplit(".", 1)[-1].lower() if "." in arquivo.filename else ""
    if ext not in EXTENSOES_PERMITIDAS:
        raise HTTPException(
            422, f"Formato não permitido. Use: {', '.join(EXTENSOES_PERMITIDAS)}"
        )


@router.post("/{cautelar_id}/certidao")
def juntar_certidao(
    cautelar_id: int,
    arquivo: UploadFile = File(..., description="PDF ou imagem da certidão com evidência"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Junta a certidão de bloqueio com evidência de tela do sistema legado.

    A evidência é obrigatória: a certidão atesta que o bloqueio foi efetivado
    no sistema legado, e sem a tela não há como comprovar.

    Pendente de integração: a inclusão do documento no SEI depende da API de
    upload já usada em ``processos_andamento`` — hoje o número fica marcado
    como pendente.
    """
    c = _carregar(db, cautelar_id)
    _validar_evidencia(arquivo)

    c.numero_sei_certidao = f"PENDENTE_SEI_{cautelar_id}"
    c.pendente_assinatura = True
    _registrar_evento(
        db, c, "certidao_bloqueio",
        f"Certidão de bloqueio juntada com evidência ({arquivo.filename}).",
        usuario.nome or usuario.email or "Sistema",
    )
    db.commit()
    return {
        "sucesso": True,
        "mensagem": "Certidão de bloqueio recebida. Inclusão no SEI será processada.",
        "cautelar_id": cautelar_id,
    }


@router.post("/{cautelar_id}/certidao-desbloqueio")
def juntar_certidao_desbloqueio(
    cautelar_id: int,
    arquivo: UploadFile = File(..., description="PDF ou imagem da certidão de desbloqueio"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Junta a certidão de desbloqueio, exigida quando a medida é revogada."""
    c = _carregar(db, cautelar_id)
    if not c.data_revogacao:
        raise HTTPException(
            409, "A certidão de desbloqueio só cabe depois da revogação da medida."
        )
    _validar_evidencia(arquivo)

    c.numero_sei_certidao_desbloqueio = f"PENDENTE_SEI_DESB_{cautelar_id}"
    c.pendente_assinatura = True
    _registrar_evento(
        db, c, "certidao_desbloqueio",
        f"Certidão de desbloqueio juntada com evidência ({arquivo.filename}).",
        usuario.nome or usuario.email or "Sistema",
    )
    db.commit()
    return {
        "sucesso": True,
        "mensagem": "Certidão de desbloqueio recebida. Inclusão no SEI será processada.",
        "cautelar_id": cautelar_id,
    }


@router.post("/{cautelar_id}/assinatura-concluida", response_model=CautelarOut)
def marcar_assinatura_concluida(
    cautelar_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Baixa a marca de "pendente de assinatura" depois de assinar no SEI.

    A assinatura acontece no SEI, então o app não consegue detectá-la sozinho
    sem consulta ao bloco; este endpoint permite fechar a pendência a partir da
    tela, pelo botão de ação.
    """
    c = _carregar(db, cautelar_id)
    c.pendente_assinatura = False
    _registrar_evento(
        db, c, "cautelar_assinada",
        "Documento da cautelar assinado no SEI.",
        usuario.nome or usuario.email or "Sistema",
    )
    db.commit()
    db.refresh(c)
    return _to_out(c)
