"""Rotas dos despachos SEI (Arquivar, TAC, Instaurar).

Fluxo: GET carrega o template HTML (para edição no frontend), POST envia o
HTML final (editado pelo usuário) e executa a ação real no SEI.

Tratamento de erros da API do SEI:
- Erros TEMPORÁRIOS (servidor do SEI fora do ar, timeout, instabilidade) são
  retornados como HTTP 503, com `temporario: true` no corpo — o frontend pode
  oferecer "tentar novamente" sem risco de duplicidade, pois nada foi criado.
- Erros DEFINITIVOS (dados inválidos, permissão, ou already-criado-mas-falhou-
  depois) são retornados como HTTP 502, com `temporario: false`. Quando algo
  já foi criado no SEI antes da falha (ex.: processo de instauração), o corpo
  inclui `numero_sei_criado` para o usuário continuar manualmente.
- Toda tentativa (sucesso ou erro) é registrada em HistoricoDespacho para dar
  rastreabilidade e evitar decisões "no escuro" sobre repetir a ação.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.integrations.graph.client import GraphClient, GraphSettings
from app.integrations.sei.client import SeiClient, SeiSettings
from app.schemas.despachos import (
    ExecutarDespachoIn,
    ExecutarInstauracaoIn,
    HistoricoDespachoOut,
    ResultadoDespachoOut,
    TemplateDespachoOut,
)
from app.services import despachos_sei as svc
from app.services import mala_direta

router = APIRouter(prefix="/caixa-entrada/{item_id}", tags=["Despachos SEI"])


def _obter_item(item_id: int, db: Session) -> m.CaixaEntrada:
    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item da caixa de entrada não encontrado")
    return item


def _graph_cpsar() -> tuple[GraphClient, str]:
    """Cliente Graph + site_id do CPSAR (cacheados entre requests).

    Antes isso resolvia o site_id na rede a cada request, o que deixava a
    abertura do modal de despacho lenta. Agora é resolvido uma vez por
    processo (ver ``app.core.sei_shared.get_graph_client``).
    """
    from app.core.sei_shared import get_graph_client
    try:
        return get_graph_client("/teams/DETRAN-CPSAR", timeout=30)
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Graph não configurado")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Erro ao conectar ao SharePoint: {e}")


class _GraphPreguicoso:
    """Adia a conexão ao SharePoint até que ela seja realmente necessária.

    Os templates de despacho já vivem no banco (``config_template_despacho``),
    então na maioria dos casos o Graph nunca é usado. Antes, a rota conectava
    ao SharePoint incondicionalmente — pagando latência de rede à toa em toda
    abertura do editor. Este proxy só conecta se algum atributo do
    ``GraphClient`` for de fato acessado (fallback quando falta dado no banco).
    """

    def __init__(self):
        self._real: GraphClient | None = None

    def _resolver(self) -> GraphClient:
        if self._real is None:
            self._real, _ = _graph_cpsar()
        return self._real

    def __getattr__(self, nome: str):
        return getattr(self._resolver(), nome)


def _graph_lazy() -> tuple["_GraphPreguicoso", str]:
    """Par (graph, site_id) em que a conexão só acontece se for usada."""
    return _GraphPreguicoso(), ""


def _sei_client() -> SeiClient:
    """Cliente SEI compartilhado (reaproveita o token entre requests)."""
    from app.core.sei_shared import get_sei_client
    try:
        return get_sei_client(timeout=60)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=503, detail="SEI não configurado")


def _id_unidade() -> str:
    """Unidade que assina as escritas no SEI.

    TODO: substituir por unidade do usuário autenticado quando existir esse
    cadastro (hoje AUTH_ENABLED=false em dev, sem unidade por usuário).
    """
    return os.getenv("SEI_UNIDADE_PROCESSAMENTO_PADRAO", "")


def _sei_web_url() -> str:
    return os.getenv("SEI_WEB_URL", "")


# ---------------------------------------------------------------------------
# Templates (GET) — carregados no editor de texto do frontend
# ---------------------------------------------------------------------------
@router.get("/despachos/arquivar", response_model=TemplateDespachoOut)
def obter_template_arquivar(
    item_id: int,
    modelo: str | None = Query(
        None,
        description="Variante do arquivamento. Os modelos oficiais variam por "
                    "motivo (sem irregularidade, baixa cadastral, duplicidade...).",
    ),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    item = _obter_item(item_id, db)
    graph, site_id = _graph_lazy()
    try:
        html = svc.montar_template_arquivar(
            graph, site_id, item, _sei_web_url(), db=db, modelo=modelo,
        )
    except svc.TemplateNaoEncontradoError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return TemplateDespachoOut(
        html=html,
        modelos=svc.modelos_disponiveis(db, "arquivamento_relatorio", item),
        marcadores=mala_direta.inventario(html, item, _sei_web_url()),
    )


@router.get("/despachos/tac", response_model=TemplateDespachoOut)
def obter_template_tac(
    item_id: int,
    modelo: str | None = Query(None, description="Variante do TAC."),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    item = _obter_item(item_id, db)
    graph, site_id = _graph_lazy()
    try:
        html = svc.montar_template_tac(graph, site_id, item, _sei_web_url(), db=db, modelo=modelo)
    except svc.TemplateNaoEncontradoError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return TemplateDespachoOut(
        html=html,
        modelos=svc.modelos_disponiveis(db, "tac", item),
        marcadores=mala_direta.inventario(html, item, _sei_web_url()),
    )


@router.get("/despachos/instaurar", response_model=TemplateDespachoOut)
def obter_template_instaurar(
    item_id: int,
    cautelar: bool = Query(False, description="Usa a versão com medida cautelar."),
    modelo: str | None = Query(
        None,
        description="Variante do termo de instauração (com/sem cautelar, lei "
                    "estadual/federal no caso de desmonte).",
    ),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    item = _obter_item(item_id, db)
    graph, site_id = _graph_lazy()
    try:
        html = svc.montar_template_instaurar(
            graph, site_id, item, _sei_web_url(), db=db, cautelar=cautelar, modelo=modelo,
        )
    except svc.TemplateNaoEncontradoError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return TemplateDespachoOut(
        html=html,
        modelos=svc.modelos_termo_instauracao(item, db),
        marcadores=mala_direta.inventario(html, item, _sei_web_url()),
    )


def _registrar_historico(
    db: Session,
    item_id: int,
    tipo: str,
    usuario: UsuarioAutenticado,
    *,
    status: str,
    mensagem: str | None = None,
    resultado: "svc.ResultadoAcaoSei | None" = None,
    numero_sei_criado: str | None = None,
    id_procedimento_criado: str | None = None,
) -> None:
    registro = m.HistoricoDespacho(
        caixa_entrada_id=item_id,
        tipo=tipo,
        status=status,
        mensagem=mensagem,
        numero_sei_resultado=(resultado.numero_sei if resultado else numero_sei_criado),
        id_procedimento_resultado=(resultado.id_procedimento if resultado else id_procedimento_criado),
        documento_formatado=(resultado.documento_formatado if resultado else None),
        avisos="\n".join(resultado.avisos) if resultado and resultado.avisos else None,
        autor=usuario.nome or usuario.email or None,
    )
    db.add(registro)
    db.commit()


def _levantar_http_do_erro(e: "svc.DespachoSeiError") -> HTTPException:
    """Converte um DespachoSeiError em HTTPException com o código e o corpo certos.

    - 503 (temporário): nada foi criado ainda, pode tentar novamente.
    - 502 (definitivo): pode já haver algo criado no SEI (numero_sei_criado);
      o frontend NÃO deve oferecer "tentar de novo" automaticamente nesse caso.
    """
    status_code = 503 if e.temporario else 502
    detail = {
        "message": str(e),
        "temporario": e.temporario,
        "etapa": e.etapa,
        "numero_sei_criado": e.numero_sei_criado,
        "id_procedimento_criado": e.id_procedimento_criado,
    }
    return HTTPException(status_code=status_code, detail=detail)


# ---------------------------------------------------------------------------
# Histórico — registro de tentativas (sucesso e erro) por item
# ---------------------------------------------------------------------------
@router.get("/despachos/historico", response_model=list[HistoricoDespachoOut])
def listar_historico_despachos(item_id: int, db: Session = Depends(get_db),
                                usuario: UsuarioAutenticado = Depends(get_current_user)):
    _obter_item(item_id, db)
    stmt = (
        select(m.HistoricoDespacho)
        .where(m.HistoricoDespacho.caixa_entrada_id == item_id)
        .order_by(m.HistoricoDespacho.criado_em.desc())
    )
    return db.scalars(stmt).all()


# ---------------------------------------------------------------------------
# Ações (POST) — envia o HTML final e cria o documento/processo no SEI real
# ---------------------------------------------------------------------------
@router.post("/despachos/arquivar", response_model=ResultadoDespachoOut)
def executar_arquivar(item_id: int, dados: ExecutarDespachoIn, db: Session = Depends(get_db),
                       usuario: UsuarioAutenticado = Depends(get_current_user)):
    item = _obter_item(item_id, db)
    sei = _sei_client()
    graph, site_id = _graph_lazy()
    try:
        resultado = svc.executar_arquivar(sei, graph, site_id, item, dados.html, _id_unidade(), db=db)
    except svc.DespachoSeiError as e:
        _registrar_historico(
            db, item_id, "arquivar", usuario,
            status="erro_temporario" if e.temporario else "erro_definitivo",
            mensagem=str(e), numero_sei_criado=e.numero_sei_criado,
            id_procedimento_criado=e.id_procedimento_criado,
        )
        raise _levantar_http_do_erro(e)
    item.status_triagem = "arquivado"
    db.commit()
    _registrar_historico(db, item_id, "arquivar", usuario, status="sucesso", resultado=resultado)
    return ResultadoDespachoOut(**resultado.__dict__)


@router.post("/despachos/tac", response_model=ResultadoDespachoOut)
def executar_tac(item_id: int, dados: ExecutarDespachoIn, db: Session = Depends(get_db),
                  usuario: UsuarioAutenticado = Depends(get_current_user)):
    item = _obter_item(item_id, db)
    sei = _sei_client()
    graph, site_id = _graph_lazy()
    try:
        resultado = svc.executar_tac(sei, graph, site_id, item, dados.html, _id_unidade(), db=db)
    except svc.DespachoSeiError as e:
        _registrar_historico(
            db, item_id, "tac", usuario,
            status="erro_temporario" if e.temporario else "erro_definitivo",
            mensagem=str(e), numero_sei_criado=e.numero_sei_criado,
            id_procedimento_criado=e.id_procedimento_criado,
        )
        raise _levantar_http_do_erro(e)
    item.status_triagem = "tac"
    db.commit()
    _registrar_historico(db, item_id, "tac", usuario, status="sucesso", resultado=resultado)
    return ResultadoDespachoOut(**resultado.__dict__)


@router.post("/despachos/instaurar", response_model=ResultadoDespachoOut)
def executar_instaurar(item_id: int, dados: ExecutarInstauracaoIn, db: Session = Depends(get_db),
                        usuario: UsuarioAutenticado = Depends(get_current_user)):
    item = _obter_item(item_id, db)
    sei = _sei_client()
    graph, site_id = _graph_lazy()
    try:
        resultado = svc.executar_instaurar(
            sei, graph, site_id, item, dados.html, _id_unidade(), cautelar=dados.cautelar, db=db,
        )
    except svc.DespachoSeiError as e:
        _registrar_historico(
            db, item_id, "instaurar", usuario,
            status="erro_temporario" if e.temporario else "erro_definitivo",
            mensagem=str(e), numero_sei_criado=e.numero_sei_criado,
            id_procedimento_criado=e.id_procedimento_criado,
        )
        raise _levantar_http_do_erro(e)
    item.status_triagem = "instaurado"
    # O Instaurar cria um processo NOVO no SEI — guardamos separadamente do
    # numero_sei/id_procedimento originais (que continuam apontando para o
    # processo de fiscalização), para a tela de Processos em Andamento poder
    # consultar/exibir os documentos do processo novo.
    item.numero_processo_sei = resultado.numero_sei
    item.id_procedimento_processo = resultado.id_procedimento
    from datetime import date, timedelta
    item.data_instauracao = date.today()

    # Instauração com cautelar entra na fila do Coordenador Geral, que concorda
    # (segue para assinatura) ou recusa (o processo volta à caixa de entrada).
    # Ver app/api/routes/cautelares.py para o ciclo de vida completo.
    if dados.cautelar:
        from app.services import calculo_prazos as cp

        prazo = dados.cautelar_prazo_dias if dados.cautelar_prazo_dias in cp.PRAZOS_CAUTELAR else 30
        hoje = date.today()
        db.add(m.Cautelar(
            caixa_entrada_id=item_id,
            tipo="Bloqueio cautelar",
            data_inicio=hoje,
            data_fim=cp.calcular_vencimento(hoje, prazo, db),
            prazo_dias=prazo,
            situacao="vigente",
            fundamentacao=(
                "Art. 62, parágrafo único, da Lei Estadual nº 10.177/1998 — medida "
                "indicada no termo de instauração."
            ),
            unidade_responsavel=_id_unidade(),
            aprovacao="pendente",
        ))

    db.commit()
    _registrar_historico(db, item_id, "instaurar", usuario, status="sucesso", resultado=resultado)

    # --- Iniciar fases automaticamente ---
    # Fase 1: instauracao (entrada imediata + saída imediata)
    # Fase 2: aguardando_defesa (fase atual — prazo só inicia quando o acesso
    #          externo for disponibilizado ao interessado)
    try:
        from app.db.models import _agora
        nome_autor = usuario.nome or usuario.email or "Sistema"

        fase_instauracao = m.FaseProcessoAndamento(
            caixa_entrada_id=item_id,
            fase="instauracao",
            autor=nome_autor,
            observacao="Fase criada automaticamente na instauração",
            data_saida=_agora(),
        )
        db.add(fase_instauracao)

        fase_defesa = m.FaseProcessoAndamento(
            caixa_entrada_id=item_id,
            fase="aguardando_defesa",
            autor=nome_autor,
            observacao="Aguardando disponibilização de acesso externo para início do prazo",
        )
        db.add(fase_defesa)

        db.add(m.EventoProcesso(
            caixa_entrada_id=item_id,
            tipo="fase_avancada",
            descricao="Processo instaurado → aguardando defesa prévia (prazo inicia após disponibilização de acesso externo)",
            autor=nome_autor,
        ))

        db.commit()
    except Exception:
        # Falha ao criar fases/prazo não deve impedir o retorno de sucesso
        # da instauração (o processo já foi criado no SEI)
        db.rollback()

    return ResultadoDespachoOut(**resultado.__dict__)
