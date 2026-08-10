"""Tela de Controle de Prazos (Documentação de Negócio v3.0).

Concentra num só lugar todos os prazos em curso da unidade, com a urgência
sinalizada por cor, para a equipe agir antes do vencimento e a chefia
acompanhar carga de trabalho e morosidade.

A tela tem três modos de visualização (lista, calendário do mês e semana) e
todos consomem este mesmo endpoint: a diferença é a janela de vencimento
pedida. Por isso ``venc_de``/``venc_ate`` existem — o calendário busca o mês
inteiro de uma vez em vez de um dia por requisição.

O semáforo e a contagem regressiva vêm de ``services/calculo_prazos.py``, o
mesmo módulo usado para criar os prazos, para a tela não reimplementar a regra
com risco de divergir.
"""
from datetime import date

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user, pode_priorizar
from app.db import models as m
from app.services import calculo_prazos as cp

router = APIRouter(prefix="/prazos", tags=["Prazos"])

#: Status de prazo que continuam pedindo ação. `decurso` entra porque o prazo
#: venceu e ainda há o que fazer (certidão, edital) — sumir da tela esconderia
#: justamente o caso mais urgente.
STATUS_ATIVOS = ("em_andamento", "decurso")


# ==============================================================================
# Schemas
# ==============================================================================


class PrazoLinha(BaseModel):
    id: int
    caixa_entrada_id: int
    #: ★ Priorização da Coordenação.
    prioritario: bool = False
    prioridade_justificativa: str | None = None
    numero_sei: str | None = None
    id_procedimento: str | None = None
    interessado: str | None = None
    cnpj_cpf: str | None = None
    agente_regulado: str | None = None
    fase: str | None = None
    tipo_prazo: str | None = None
    base_legal: str | None = None
    dias: int | None = None
    data_inicio: date | None = None
    data_vencimento: date | None = None
    dias_restantes: int | None = None
    restante_rotulo: str | None = None
    #: verde | amarelo | vermelho
    semaforo: str | None = None
    situacao_rotulo: str | None = None
    responsavel: str | None = None
    status: str | None = None


class ResumoPrazos(BaseModel):
    vencidos: int = 0
    vence_em_3_dias: int = 0
    no_prazo: int = 0
    priorizados: int = 0


class RespostaPrazos(BaseModel):
    resumo: ResumoPrazos
    prazos: list[PrazoLinha]
    total: int = 0
    #: Se o usuário pode marcar/desmarcar a estrela de priorização.
    pode_priorizar: bool = False


# ==============================================================================
# Helpers
# ==============================================================================


def _sem_mascara(coluna):
    """Coluna sem pontuação, para casar busca digitada com ou sem máscara."""
    limpa = func.replace(coluna, ".", "")
    limpa = func.replace(limpa, "-", "")
    limpa = func.replace(limpa, "/", "")
    return func.replace(limpa, " ", "")


def _restringir_por_unidade(stmt, usuario: UsuarioAutenticado, db: Session):
    """Analista vê só a própria unidade; coordenação vê tudo.

    Mesma regra da tela de Processos em Andamento — o documento repete em
    "Acesso por perfil e unidade".
    """
    from app.core.security import e_coordenacao

    if not usuario.email or usuario.email == "dev@local":
        return stmt
    if e_coordenacao(usuario, db):
        return stmt
    registro = db.query(m.Usuario).filter(m.Usuario.email.ilike(usuario.email)).first()
    if registro and registro.id_unidade:
        return stmt.where(m.CaixaEntrada.id_unidade_sei == registro.id_unidade)
    return stmt


def _montar_linha(prazo: m.PrazoProcesso, item: m.CaixaEntrada, responsavel: str | None,
                  hoje: date) -> PrazoLinha:
    restantes = cp.dias_restantes(prazo.data_vencimento, hoje)
    cor = cp.semaforo(restantes)
    tipo = cp.tipo_por_fase(prazo.fase)
    return PrazoLinha(
        id=prazo.id,
        caixa_entrada_id=item.id,
        prioritario=bool(item.prioritario),
        prioridade_justificativa=item.prioridade_justificativa,
        # O número do processo sancionatório é o que importa aqui; o do
        # relatório de fiscalização entra como reserva para quem foi arquivado
        # ou virou TAC (que não criam processo novo).
        numero_sei=item.numero_processo_sei or item.numero_sei,
        id_procedimento=item.id_procedimento_processo or item.id_procedimento,
        interessado=item.razao_social,
        cnpj_cpf=item.cnpj_cpf,
        agente_regulado=item.agente_regulado,
        fase=prazo.fase,
        tipo_prazo=cp.rotulo_do_prazo(prazo.fase, prazo.dias),
        base_legal=tipo.base_legal if tipo else None,
        dias=prazo.dias,
        data_inicio=prazo.data_inicio,
        data_vencimento=prazo.data_vencimento,
        dias_restantes=restantes,
        restante_rotulo=cp.rotulo_restante(restantes),
        semaforo=cor,
        situacao_rotulo=cp.ROTULOS_SEMAFORO.get(cor or "", None),
        responsavel=responsavel,
        status=prazo.status,
    )


# ==============================================================================
# Rotas
# ==============================================================================


@router.get("/tipos")
def listar_tipos(
    _usuario: UsuarioAutenticado = Depends(get_current_user),
) -> list[dict]:
    """Matriz de prazos: alimenta o filtro "Tipo de prazo" e a tela de parâmetros."""
    return [
        {
            "chave": t.chave,
            "rotulo": t.rotulo,
            "dias": t.dias,
            "base_legal": t.base_legal,
            "gatilho": t.gatilho,
            "no_vencimento": t.no_vencimento,
            "fase": t.fase,
            "gerencial": t.gerencial,
        }
        for t in cp.MATRIZ_PRAZOS
    ]


@router.get("/responsaveis")
def listar_responsaveis(
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(get_current_user),
) -> list[dict]:
    """Responsáveis com processo atribuído, para o filtro da tela."""
    stmt = (
        select(m.Usuario.id, m.Usuario.nome, m.Usuario.email)
        .join(m.CaixaEntrada, m.CaixaEntrada.responsavel_id == m.Usuario.id)
        .distinct()
    )
    return [
        {"id": uid, "nome": nome or email}
        for uid, nome, email in db.execute(stmt).all()
    ]


@router.get("", response_model=RespostaPrazos)
def listar(
    busca: str | None = Query(None, description="Nº SEI, CPF/CNPJ ou nome do interessado"),
    agente: str | None = Query(None, description="Agente regulado (segmento)"),
    tipo: str | None = Query(None, description="Chave do tipo de prazo da matriz"),
    situacao: str | None = Query(None, description="verde | amarelo | vermelho"),
    responsavel_id: int | None = Query(None),
    priorizados: bool = Query(False, description="Somente os priorizados (★)"),
    venc_de: date | None = Query(None, description="Vencimento a partir de (modo calendário)"),
    venc_ate: date | None = Query(None, description="Vencimento até (modo calendário)"),
    limit: int = Query(300, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Prazos ativos com semáforo, filtros e cartões de resumo.

    Os cartões contam o universo filtrado **sem** o filtro de situação: eles
    servem de filtro rápido, então precisam continuar mostrando quantos itens
    existem em cada cor mesmo depois de o usuário clicar em uma delas.
    """
    hoje = date.today()

    base = (
        select(m.PrazoProcesso, m.CaixaEntrada, m.Usuario.nome, m.Usuario.email)
        .join(m.CaixaEntrada, m.CaixaEntrada.id == m.PrazoProcesso.caixa_entrada_id)
        .outerjoin(m.Usuario, m.Usuario.id == m.CaixaEntrada.responsavel_id)
        .where(m.PrazoProcesso.status.in_(STATUS_ATIVOS))
    )
    base = _restringir_por_unidade(base, usuario, db)

    if busca:
        termo = busca.strip()
        limpo = termo.replace(".", "").replace("-", "").replace("/", "").replace(" ", "")
        alvo_texto = f"%{termo.lower()}%"
        alvo_num = f"%{limpo}%"
        base = base.where(
            or_(
                _sem_mascara(m.CaixaEntrada.numero_sei).like(alvo_num),
                _sem_mascara(m.CaixaEntrada.numero_processo_sei).like(alvo_num),
                _sem_mascara(m.CaixaEntrada.cnpj_cpf).like(alvo_num),
                func.lower(m.CaixaEntrada.razao_social).like(alvo_texto),
            )
        )
    if agente:
        base = base.where(m.CaixaEntrada.agente_regulado == agente)
    if tipo:
        alvo = cp.tipo_por_chave(tipo)
        if alvo:
            # A fase é o que está gravado no prazo; a duração desempata quando a
            # fase serve a mais de um tipo (defesa comum e por edital, recurso e
            # julgamento do recurso).
            if alvo.fase:
                base = base.where(m.PrazoProcesso.fase == alvo.fase)
            base = base.where(m.PrazoProcesso.dias == alvo.dias)
    if responsavel_id:
        base = base.where(m.CaixaEntrada.responsavel_id == responsavel_id)
    if priorizados:
        base = base.where(m.CaixaEntrada.prioritario.is_(True))
    if venc_de:
        base = base.where(m.PrazoProcesso.data_vencimento >= venc_de)
    if venc_ate:
        base = base.where(m.PrazoProcesso.data_vencimento <= venc_ate)

    # Priorizados primeiro, depois o mais urgente: é a ordem de trabalho pedida.
    ordenado = base.order_by(
        func.coalesce(m.CaixaEntrada.prioritario, False).desc(),
        m.PrazoProcesso.data_vencimento.asc(),
    )

    linhas = [
        _montar_linha(prazo, item, nome or email, hoje)
        for prazo, item, nome, email in db.execute(ordenado).all()
    ]

    resumo = ResumoPrazos(
        vencidos=sum(1 for l in linhas if l.semaforo == cp.VERMELHO),
        vence_em_3_dias=sum(1 for l in linhas if l.semaforo == cp.AMARELO),
        no_prazo=sum(1 for l in linhas if l.semaforo == cp.VERDE),
        priorizados=sum(1 for l in linhas if l.prioritario),
    )

    if situacao:
        linhas = [l for l in linhas if l.semaforo == situacao]

    total = len(linhas)
    return RespostaPrazos(
        resumo=resumo,
        prazos=linhas[offset : offset + limit],
        total=total,
        pode_priorizar=pode_priorizar(usuario, db),
    )
