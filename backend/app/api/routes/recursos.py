"""Painel de recurso e Decisão II (Documentação de Negócio v3.0).

Depois da Decisão I o painel registra se houve interposição (Sim/Não) e conduz o
trâmite:

    (1) interposição → (2) encaminhamento à Consultoria Jurídica →
    (3) emissão de parecer → (4) Decisão II pela autoridade competente

Prazos aplicáveis (todos na matriz de ``services/calculo_prazos.py``):
interposição 15 dias (art. 44), reconsideração pela própria autoridade 7 dias
(art. 47, VI), julgamento pela autoridade recursal 30 dias (art. 47, VII) e
prazo máximo para decisão do recurso 120 dias (art. 50).

A Decisão II considera obrigatoriamente o parecer da Consultoria Jurídica e
pode **manter**, **reformar** ou **determinar o retorno do processo a uma fase
específica** — neste último caso o processo reentra no fluxo no ponto indicado,
e não segue direto para o encerramento.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes.processos_andamento import _obter_item
from app.core.security import (
    PERFIL_CONSULTORIA_JURIDICA,
    UsuarioAutenticado,
    e_coordenacao,
    get_current_user,
    perfil_do_usuario,
)
from app.db import models as m
from app.db.models import FASES_PROCESSO
from app.services import calculo_prazos as cp

router = APIRouter(prefix="/processos-andamento", tags=["Recurso e Decisão II"])

RESULTADO_MANTIDA = "mantida"
RESULTADO_REFORMADA = "reformada"
RESULTADO_RETORNO = "retorno_fase"
RESULTADOS = (RESULTADO_MANTIDA, RESULTADO_REFORMADA, RESULTADO_RETORNO)

#: Prazos abertos quando o recurso é interposto, na ordem do rito.
PRAZOS_DO_RECURSO = ("reconsideracao", "julgamento_recurso", "maximo_recurso")


# ==============================================================================
# Schemas
# ==============================================================================


class InterposicaoIn(BaseModel):
    interposto: bool
    #: Data do protocolo. Ausente, usa hoje — é dela que correm os prazos.
    data_interposicao: date | None = None


class ParecerIn(BaseModel):
    numero_sei: str | None = None
    resumo: str | None = None


class DecisaoIIIn(BaseModel):
    #: mantida | reformada | retorno_fase
    resultado: str
    #: Obrigatória quando o resultado é ``retorno_fase``.
    fase_retorno: str | None = None
    fundamentacao: str | None = None


class PrazoRecursoOut(BaseModel):
    chave: str
    rotulo: str
    dias: int
    base_legal: str
    data_vencimento: date | None = None
    dias_restantes: int | None = None
    semaforo: str | None = None


class RecursoOut(BaseModel):
    caixa_entrada_id: int
    existe: bool = False
    interposto: bool | None = None
    data_interposicao: date | None = None
    registrado_por: str | None = None

    parecer_numero_sei: str | None = None
    parecer_em: date | None = None
    parecer_por: str | None = None
    parecer_resumo: str | None = None

    decisao_resultado: str | None = None
    decisao_fase_retorno: str | None = None
    decisao_fundamentacao: str | None = None
    decisao_em: date | None = None
    decisao_por: str | None = None

    #: Prazos do recurso com semáforo, para o painel mostrar a urgência.
    prazos: list[PrazoRecursoOut] = []
    #: Fases para as quais a Decisão II pode devolver o processo.
    fases_disponiveis: list[str] = []

    # Permissões já resolvidas, para a tela não deduzir regra.
    pode_registrar_interposicao: bool = False
    pode_emitir_parecer: bool = False
    pode_decidir: bool = False


# ==============================================================================
# Helpers
# ==============================================================================


def _obter_recurso(db: Session, item_id: int) -> m.RecursoProcesso | None:
    """Recurso mais recente do processo (pode haver mais de um após retorno de fase)."""
    return db.scalars(
        select(m.RecursoProcesso)
        .where(m.RecursoProcesso.caixa_entrada_id == item_id)
        .order_by(m.RecursoProcesso.criado_em.desc(), m.RecursoProcesso.id.desc())
    ).first()


def _fases_para_retorno() -> list[str]:
    """Fases que fazem sentido como destino de retorno.

    Só as anteriores ao recurso: devolver para "encerrado" ou para o próprio
    recurso não é retorno, é outra coisa.
    """
    return [f for f in FASES_PROCESSO if f not in ("recurso", "encerramento", "encerrado")]


def _prazos_do_recurso(db: Session, item_id: int) -> list[PrazoRecursoOut]:
    """Prazos gravados da fase de recurso, casados com a matriz."""
    hoje = date.today()
    gravados = db.scalars(
        select(m.PrazoProcesso).where(
            m.PrazoProcesso.caixa_entrada_id == item_id,
            m.PrazoProcesso.fase == "recurso",
        )
    ).all()

    saida: list[PrazoRecursoOut] = []
    for prazo in gravados:
        tipo = next((t for t in cp.MATRIZ_PRAZOS if t.fase == "recurso" and t.dias == prazo.dias), None)
        restantes = cp.dias_restantes(prazo.data_vencimento, hoje)
        saida.append(PrazoRecursoOut(
            chave=tipo.chave if tipo else "recurso",
            rotulo=tipo.rotulo if tipo else "Prazo do recurso",
            dias=prazo.dias,
            base_legal=tipo.base_legal if tipo else "Art. 44",
            data_vencimento=prazo.data_vencimento,
            dias_restantes=restantes,
            semaforo=cp.semaforo(restantes),
        ))
    saida.sort(key=lambda p: p.dias)
    return saida


def _montar_saida(
    db: Session, item_id: int, recurso: m.RecursoProcesso | None,
    usuario: UsuarioAutenticado,
) -> RecursoOut:
    perfil = perfil_do_usuario(usuario, db)
    coordenacao = e_coordenacao(usuario, db)
    base = RecursoOut(
        caixa_entrada_id=item_id,
        existe=recurso is not None,
        prazos=_prazos_do_recurso(db, item_id),
        fases_disponiveis=_fases_para_retorno(),
        # Registrar a interposição é ato de instrução: qualquer perfil da unidade
        # faz. Emitir parecer é da Consultoria Jurídica; decidir, da Coordenação.
        pode_registrar_interposicao=True,
        pode_emitir_parecer=perfil == PERFIL_CONSULTORIA_JURIDICA or coordenacao,
        pode_decidir=coordenacao,
    )
    if not recurso:
        return base

    return base.model_copy(update={
        "interposto": recurso.interposto,
        "data_interposicao": recurso.data_interposicao,
        "registrado_por": recurso.registrado_por,
        "parecer_numero_sei": recurso.parecer_numero_sei,
        "parecer_em": recurso.parecer_em,
        "parecer_por": recurso.parecer_por,
        "parecer_resumo": recurso.parecer_resumo,
        "decisao_resultado": recurso.decisao_resultado,
        "decisao_fase_retorno": recurso.decisao_fase_retorno,
        "decisao_fundamentacao": recurso.decisao_fundamentacao,
        "decisao_em": recurso.decisao_em,
        "decisao_por": recurso.decisao_por,
    })


def _abrir_prazos_do_recurso(db: Session, item_id: int, inicio: date, autor: str) -> None:
    """Abre reconsideração (7d), julgamento (30d) e prazo máximo (120d).

    Os três correm da interposição, conforme a matriz — o de 120 dias é teto de
    decisão (art. 50), e os outros dois são etapas internas do trâmite.
    """
    existentes = {
        p.dias for p in db.scalars(
            select(m.PrazoProcesso).where(
                m.PrazoProcesso.caixa_entrada_id == item_id,
                m.PrazoProcesso.fase == "recurso",
            )
        ).all()
    }
    feriados = cp.carregar_feriados(db)
    for chave in PRAZOS_DO_RECURSO:
        tipo = cp.tipo_por_chave(chave)
        if not tipo or tipo.dias in existentes:
            continue
        db.add(m.PrazoProcesso(
            caixa_entrada_id=item_id,
            fase="recurso",
            dias=tipo.dias,
            data_inicio=inicio,
            data_vencimento=cp.calcular_vencimento(inicio, tipo.dias, feriados=feriados),
            status="em_andamento",
            registrado_sei=False,
        ))
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id,
        tipo="prazo_definido",
        descricao=(
            "Prazos do recurso abertos: reconsideração (7 dias, art. 47, VI), "
            "julgamento (30 dias, art. 47, VII) e prazo máximo de decisão "
            "(120 dias, art. 50)."
        ),
        autor=autor,
    ))


# ==============================================================================
# Rotas
# ==============================================================================


@router.get("/{item_id}/recurso", response_model=RecursoOut)
def obter_recurso(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Estado do painel de recurso do processo."""
    _obter_item(item_id, db)
    return _montar_saida(db, item_id, _obter_recurso(db, item_id), usuario)


@router.post("/{item_id}/recurso/interposicao", response_model=RecursoOut)
def registrar_interposicao(
    item_id: int,
    dados: InterposicaoIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Registra se houve interposição de recurso (Sim/Não).

    **Sim** abre os prazos do trâmite recursal. **Não** significa trânsito
    administrativo: o processo segue para o encerramento, e é por isso que a
    resposta negativa também precisa ser registrada, não apenas a positiva.
    """
    _obter_item(item_id, db)
    autor = usuario.nome or usuario.email or "Sistema"

    recurso = _obter_recurso(db, item_id)
    # Recurso já decidido não é reaberto: um novo só nasce depois de retorno de
    # fase, quando o processo volta a percorrer o rito.
    if recurso is None or recurso.decisao_resultado:
        recurso = m.RecursoProcesso(caixa_entrada_id=item_id)
        db.add(recurso)

    inicio = dados.data_interposicao or date.today()
    recurso.interposto = dados.interposto
    recurso.data_interposicao = inicio if dados.interposto else None
    recurso.registrado_por = autor

    if dados.interposto:
        db.add(m.EventoProcesso(
            caixa_entrada_id=item_id,
            tipo="recurso_interposto",
            descricao=f"Recurso interposto em {inicio.strftime('%d/%m/%Y')} (art. 44).",
            autor=autor,
        ))
        db.flush()
        _abrir_prazos_do_recurso(db, item_id, inicio, autor)
    else:
        db.add(m.EventoProcesso(
            caixa_entrada_id=item_id,
            tipo="transito_administrativo",
            descricao=(
                "Sem interposição de recurso: trânsito administrativo. "
                "O processo segue para encerramento."
            ),
            autor=autor,
        ))

    db.commit()
    return _montar_saida(db, item_id, recurso, usuario)


@router.post("/{item_id}/recurso/parecer", response_model=RecursoOut)
def registrar_parecer(
    item_id: int,
    dados: ParecerIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Registra o parecer da Consultoria Jurídica sobre o recurso."""
    _obter_item(item_id, db)
    perfil = perfil_do_usuario(usuario, db)
    if perfil != PERFIL_CONSULTORIA_JURIDICA and not e_coordenacao(usuario, db):
        raise HTTPException(
            403, "Somente a Consultoria Jurídica pode registrar o parecer do recurso."
        )

    recurso = _obter_recurso(db, item_id)
    if not recurso or not recurso.interposto:
        raise HTTPException(
            409, "Não há recurso interposto neste processo para receber parecer."
        )

    autor = usuario.nome or usuario.email or "Sistema"
    recurso.parecer_numero_sei = (dados.numero_sei or "").strip() or None
    recurso.parecer_resumo = (dados.resumo or "").strip() or None
    recurso.parecer_em = date.today()
    recurso.parecer_por = autor

    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id,
        tipo="parecer_juridico",
        descricao=(
            "Parecer da Consultoria Jurídica registrado"
            + (f" ({recurso.parecer_numero_sei})" if recurso.parecer_numero_sei else "")
            + "."
        ),
        autor=autor,
    ))
    db.commit()
    return _montar_saida(db, item_id, recurso, usuario)


@router.post("/{item_id}/recurso/decisao-ii", response_model=RecursoOut)
def registrar_decisao_ii(
    item_id: int,
    dados: DecisaoIIIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Registra a Decisão II: mantém, reforma ou devolve o processo a uma fase.

    O parecer da Consultoria Jurídica é obrigatório — o documento diz que a
    Decisão II "deve considerar obrigatoriamente" o parecer, então decidir antes
    dele é recusado.

    No ``retorno_fase`` o processo reentra no fluxo na fase indicada: a fase
    atual é fechada e uma nova é aberta ali, em vez de seguir para encerramento.
    """
    item = _obter_item(item_id, db)
    if not e_coordenacao(usuario, db):
        raise HTTPException(
            403, "A Decisão II é proferida pela Coordenação (ou Coordenador Geral)."
        )
    if dados.resultado not in RESULTADOS:
        raise HTTPException(422, f"Resultado inválido. Use um de: {', '.join(RESULTADOS)}.")

    recurso = _obter_recurso(db, item_id)
    if not recurso or not recurso.interposto:
        raise HTTPException(409, "Não há recurso interposto neste processo.")
    if not recurso.parecer_em:
        raise HTTPException(
            409,
            "A Decisão II deve considerar o parecer da Consultoria Jurídica. "
            "Registre o parecer antes de decidir.",
        )

    fase_retorno = (dados.fase_retorno or "").strip() or None
    if dados.resultado == RESULTADO_RETORNO:
        if not fase_retorno:
            raise HTTPException(422, "Informe a fase para a qual o processo retorna.")
        if fase_retorno not in _fases_para_retorno():
            raise HTTPException(422, f"Fase inválida para retorno: {fase_retorno}.")

    autor = usuario.nome or usuario.email or "Sistema"
    recurso.decisao_resultado = dados.resultado
    recurso.decisao_fase_retorno = fase_retorno if dados.resultado == RESULTADO_RETORNO else None
    recurso.decisao_fundamentacao = (dados.fundamentacao or "").strip() or None
    recurso.decisao_em = date.today()
    recurso.decisao_por = autor

    # Prazos do recurso deixam de correr quando a decisão sai.
    for prazo in db.scalars(
        select(m.PrazoProcesso).where(
            m.PrazoProcesso.caixa_entrada_id == item_id,
            m.PrazoProcesso.fase == "recurso",
            m.PrazoProcesso.status == "em_andamento",
        )
    ).all():
        prazo.status = "respondido"
        prazo.data_resposta = date.today()

    rotulos = {
        RESULTADO_MANTIDA: "Decisão I mantida",
        RESULTADO_REFORMADA: "Decisão I reformada",
        RESULTADO_RETORNO: f"Retorno do processo à fase {fase_retorno}",
    }
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id,
        tipo="decisao_proferida",
        descricao=(
            f"Decisão II: {rotulos[dados.resultado]}."
            + (f" {recurso.decisao_fundamentacao}" if recurso.decisao_fundamentacao else "")
        ),
        autor=autor,
    ))

    if dados.resultado == RESULTADO_RETORNO and fase_retorno:
        from app.db.models import _agora

        atual = db.scalars(
            select(m.FaseProcessoAndamento)
            .where(
                m.FaseProcessoAndamento.caixa_entrada_id == item_id,
                m.FaseProcessoAndamento.data_saida.is_(None),
            )
            .order_by(m.FaseProcessoAndamento.data_entrada.desc())
        ).first()
        if atual:
            atual.data_saida = _agora()
        db.add(m.FaseProcessoAndamento(
            caixa_entrada_id=item_id,
            fase=fase_retorno,
            autor=autor,
            observacao="Retorno determinado pela Decisão II",
        ))
        db.add(m.EventoProcesso(
            caixa_entrada_id=item_id,
            tipo="fase_avancada",
            descricao=f"Processo retornou à fase {fase_retorno} por determinação da Decisão II.",
            autor=autor,
        ))

    # Notificação para a unidade acompanhar o desfecho.
    db.add(m.Notificacao(
        caixa_entrada_id=item_id,
        tipo="decisao_ii",
        titulo="Decisão II proferida",
        descricao=(
            f"Processo {item.numero_processo_sei or item.numero_sei or item_id}: "
            f"{rotulos[dados.resultado]}."
        ),
    ))

    db.commit()
    return _montar_saida(db, item_id, recurso, usuario)
