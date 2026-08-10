"""Rotas de "Processos em Andamento".

Reúne os itens que já saíram da Caixa de Entrada por terem recebido um
despacho de Arquivar, TAC ou Instaurar (``status_triagem`` em
``arquivado``/``tac``/``instaurado``). É o "espelho" do filtro usado em
``GET /caixa-entrada``.

Documento principal por status:
- ``instaurado``: o Instaurar cria um processo NOVO no SEI. Os documentos
  exibidos aqui são os do processo novo (``id_procedimento_processo``).
- ``tac`` / ``arquivado``: o documento gerado foi incluído no MESMO processo
  de fiscalização (não existe processo novo) — os documentos exibidos são os
  do processo original (``id_procedimento``).
"""
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes.despachos import _graph_cpsar, _id_unidade, _sei_client
from app.api.routes.documentos import (
    DocumentoOut,
    listar_documentos_por_procedimento,
    obter_conteudo_documento_por_numero,
)
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.schemas.caixa_entrada import CaixaEntradaOut
from app.services import calculo_prazos
from app.services.andamentos_sei import buscar_data_instauracao

router = APIRouter(prefix="/processos-andamento", tags=["Processos em Andamento"])

STATUS_EM_ANDAMENTO = ("arquivado", "tac", "instaurado")

_MASK_CHARS = re.compile(r"[.\-/\s]")


def _normalizar(texto: str | None) -> str:
    return _MASK_CHARS.sub("", texto or "")


def _coluna_sem_mascara(coluna):
    for ch in (".", "/", "-", " "):
        coluna = func.replace(coluna, ch, "")
    return coluna


def _obter_item(item_id: int, db: Session) -> m.CaixaEntrada:
    item = db.get(m.CaixaEntrada, item_id)
    if not item or item.status_triagem not in STATUS_EM_ANDAMENTO:
        raise HTTPException(status_code=404, detail="Processo em andamento não encontrado")
    return item


def _id_procedimento_documento(item: m.CaixaEntrada) -> str | None:
    """Escolhe qual processo SEI consultar para exibir os documentos.

    Instaurado → processo novo (id_procedimento_processo). TAC/Arquivado →
    processo original (id_procedimento), pois não existe processo novo.
    """
    if item.status_triagem == "instaurado" and item.id_procedimento_processo:
        return item.id_procedimento_processo
    return item.id_procedimento


def _agendar_busca_data_instauracao(item_id: int, id_procedimento_processo: str) -> None:
    """Descobre a data de instauração em background (não bloqueia a resposta).

    ``buscar_data_instauracao`` percorre a listaSEIDespachos no SharePoint e
    consulta os andamentos no SEI — alguns segundos por chamada. Antes isso
    rodava de forma síncrona em todo GET de detalhe de processo instaurado sem
    data, e era um dos motivos de a tela demorar a abrir.

    A data não é necessária para renderizar a página: quando for descoberta,
    aparece no próximo carregamento. Falhas são silenciosas por design (a
    automação agendada é o caminho garantido).
    """
    import threading

    from app.db.base import get_engine, get_sessionmaker

    unidade = _id_unidade()

    def _trabalho():
        try:
            sei = _sei_client()
            graph, site_id = _graph_cpsar()
            data = buscar_data_instauracao(sei, graph, site_id, id_procedimento_processo, unidade)
            if not data:
                return
            SessionLocal = get_sessionmaker(get_engine())
            with SessionLocal() as bg_db:
                bg_item = bg_db.get(m.CaixaEntrada, item_id)
                if bg_item and not bg_item.data_instauracao:
                    bg_item.data_instauracao = data
                    bg_db.commit()
        except Exception:  # noqa: BLE001
            pass

    threading.Thread(target=_trabalho, daemon=True).start()


@router.get("", response_model=list[CaixaEntradaOut])
def listar(
    busca: str | None = Query(None, description="Nº SEI ou CNPJ/CPF, com ou sem máscara"),
    agente: str | None = Query(None, description="Filtra por agente regulado"),
    filtro: str | None = Query(None, description="Filtro contextual: prazos, cautelares, decisoes, arquivamento"),
    data_inicio: date | None = Query(None, description="Data de instauração inicial"),
    data_fim: date | None = Query(None, description="Data de instauração final"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista processos em andamento (Arquivados, TAC ou Instaurados).

    O parâmetro `filtro` permite views contextuais:
    - prazos: apenas processos com prazo em andamento
    - cautelares: processos instaurados (todos têm potencial para cautelar)
    - decisoes: processos nas fases de julgamento, recurso ou encerramento
    - arquivamento: processos na fase encerrado
    """
    stmt = select(m.CaixaEntrada).where(m.CaixaEntrada.status_triagem.in_(STATUS_EM_ANDAMENTO))

    # Filtro por unidade do usuário (quando auth está ativo e o usuário é analista)
    if usuario.email and usuario.email != "dev@local":
        usuario_db = db.query(m.Usuario).filter_by(email=usuario.email).first()
        if usuario_db and usuario_db.perfil != "coordenador" and usuario_db.id_unidade:
            stmt = stmt.where(m.CaixaEntrada.id_unidade_sei == usuario_db.id_unidade)

    # Filtro contextual (vindo da sidebar)
    if filtro == "prazos":
        # Apenas processos que têm prazo em andamento
        ids_com_prazo = (
            select(m.PrazoProcesso.caixa_entrada_id)
            .where(m.PrazoProcesso.status == "em_andamento")
            .scalar_subquery()
        )
        stmt = stmt.where(m.CaixaEntrada.id.in_(ids_com_prazo))
    elif filtro == "cautelares":
        # Processos instaurados (potencial para medida cautelar)
        stmt = stmt.where(m.CaixaEntrada.status_triagem == "instaurado")
    elif filtro == "decisoes":
        # Processos nas fases de julgamento/recurso/encerramento
        fases_decisao = ("julgamento", "recurso", "encerramento")
        ids_em_fase = (
            select(m.FaseProcessoAndamento.caixa_entrada_id)
            .where(
                m.FaseProcessoAndamento.fase.in_(fases_decisao),
                m.FaseProcessoAndamento.data_saida.is_(None),
            )
            .scalar_subquery()
        )
        stmt = stmt.where(m.CaixaEntrada.id.in_(ids_em_fase))
    elif filtro == "controle_interno":
        # Processos parados há 15+ dias (última atividade mais antiga que 15 dias)
        from datetime import datetime, timedelta

        limite = datetime.now() - timedelta(days=15)
        # Processos que NÃO têm nenhum evento nos últimos 15 dias
        ids_com_atividade_recente = (
            select(m.EventoProcesso.caixa_entrada_id)
            .where(m.EventoProcesso.criado_em >= limite)
            .scalar_subquery()
        )
        # Também excluir quem tem prazo criado recentemente
        ids_prazo_recente = (
            select(m.PrazoProcesso.caixa_entrada_id)
            .where(m.PrazoProcesso.criado_em >= limite)
            .scalar_subquery()
        )
        # Também excluir quem entrou numa fase recentemente
        ids_fase_recente = (
            select(m.FaseProcessoAndamento.caixa_entrada_id)
            .where(m.FaseProcessoAndamento.data_entrada >= limite)
            .scalar_subquery()
        )
        # Só instaurados (não incluir arquivados/TAC que estão resolvidos)
        stmt = stmt.where(
            m.CaixaEntrada.status_triagem == "instaurado",
            m.CaixaEntrada.id.notin_(ids_com_atividade_recente),
            m.CaixaEntrada.id.notin_(ids_prazo_recente),
            m.CaixaEntrada.id.notin_(ids_fase_recente),
        )
    elif filtro == "arquivamento":
        # Processos encerrados
        ids_encerrados = (
            select(m.FaseProcessoAndamento.caixa_entrada_id)
            .where(
                m.FaseProcessoAndamento.fase == "encerrado",
                m.FaseProcessoAndamento.data_saida.is_(None),
            )
            .scalar_subquery()
        )
        stmt = stmt.where(m.CaixaEntrada.id.in_(ids_encerrados))

    if busca:
        termo = _normalizar(busca)
        if termo:
            alvo = f"%{termo}%"
            stmt = stmt.where(
                or_(
                    _coluna_sem_mascara(m.CaixaEntrada.numero_sei).like(alvo),
                    _coluna_sem_mascara(m.CaixaEntrada.numero_processo_sei).like(alvo),
                    _coluna_sem_mascara(m.CaixaEntrada.cnpj_cpf).like(alvo),
                )
            )
    if agente:
        stmt = stmt.where(m.CaixaEntrada.agente_regulado == agente)
    if data_inicio:
        stmt = stmt.where(m.CaixaEntrada.data_instauracao >= data_inicio)
    if data_fim:
        stmt = stmt.where(m.CaixaEntrada.data_instauracao <= data_fim)

    # Priorizados (★) primeiro: é o efeito prático da priorização pedido no
    # documento — "sobe no ordenamento das filas". `coalesce` porque as linhas
    # gravadas antes da coluna existir têm NULL, e no SQL Server o nulo viria
    # na frente num DESC.
    stmt = (
        stmt.order_by(
            func.coalesce(m.CaixaEntrada.prioritario, False).desc(),
            m.CaixaEntrada.data_instauracao.desc().nullslast(),
            m.CaixaEntrada.data_recebimento.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    return db.scalars(stmt).all()


@router.get("/{item_id}", response_model=CaixaEntradaOut)
def obter(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Detalhes de um processo em andamento pelo ID.

    Gatilho best-effort: se o processo foi instaurado e ainda não tem
    ``data_instauracao``, tenta descobrir agora (checando se o documento já
    foi assinado no SEI). Complementa a automação agendada
    (``atualizar_data_instauracao.py``) para o caso comum de o usuário abrir
    a tela antes do próximo ciclo agendado. Qualquer falha aqui é silenciosa
    — não deve impedir a exibição do processo.
    """
    item = _obter_item(item_id, db)
    if item.status_triagem == "instaurado" and not item.data_instauracao and item.id_procedimento_processo:
        _agendar_busca_data_instauracao(item.id, item.id_procedimento_processo)
    return item


@router.get("/{item_id}/documentos", response_model=list[DocumentoOut])
def listar_documentos(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Histórico de documentos do processo (mais recente primeiro)."""
    item = _obter_item(item_id, db)
    id_procedimento = _id_procedimento_documento(item)
    if not id_procedimento:
        return []
    return listar_documentos_por_procedimento(
        id_procedimento, id_unidade_hint=item.id_unidade_sei, db=db,
    )


@router.get("/{item_id}/documentos/{numero_doc}/conteudo")
def obter_conteudo_documento(
    item_id: int,
    numero_doc: str,
    tipo: str | None = Query(None, description="Tipo do documento: 'interno' ou 'externo'"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Conteúdo (base64) de um documento específico do processo."""
    item = _obter_item(item_id, db)
    return JSONResponse(content=obter_conteudo_documento_por_numero(
        numero_doc, tipo_doc=tipo, id_unidade_hint=item.id_unidade_sei, db=db,
    ))


# ==============================================================================
# Histórico de andamentos do processo (resumido / completo)
# ==============================================================================

from app.api.routes.historico import listar_historico_andamentos, AndamentoOut


@router.get("/{item_id}/historico", response_model=list[AndamentoOut])
def obter_historico(
    item_id: int,
    modo: str = Query("resumido", description="'resumido' ou 'completo'"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Histórico de andamentos do processo no SEI.

    No caso de instaurado, mostra o histórico do processo NOVO criado.
    Em TAC/Arquivado, mostra o histórico do processo de fiscalização original.
    """
    item = _obter_item(item_id, db)
    id_procedimento = _id_procedimento_documento(item)
    if not id_procedimento:
        return []
    id_unidade = item.id_unidade_sei or "110053117"
    return listar_historico_andamentos(id_procedimento, id_unidade, modo=modo, db=db)


# ==============================================================================
# Disponibilização de acesso externo
# ==============================================================================

from pydantic import BaseModel as PydanticBaseModel


DIAS_DEFESA_PREVIA = 15


def _iniciar_prazo_defesa(
    db: Session,
    item_id: int,
    usuario: UsuarioAutenticado,
    exigir_disponibilizacao: bool = False,
) -> m.PrazoProcesso | None:
    """Abre o prazo de defesa prévia deste processo, se ainda não existe.

    A contagem parte da **disponibilização do acesso externo**, lida dos
    andamentos do SEI (tarefa 50) — não do momento do clique. O normal é o prazo
    abrir sozinho (automação e abertura da tela); esta função atende o caminho
    manual e o momento em que o próprio app disponibiliza o acesso.

    ``exigir_disponibilizacao=False`` deixa o prazo valer de hoje quando o SEI
    não tem o andamento: é o que o botão da tela faz, sob a palavra do analista.
    Também gera a certidão de disponibilização no SEI.
    """
    from app.services.acesso_externo import abrir_prazo_defesa, buscar_acesso_externo

    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        return None

    sei = _sei_client()
    id_unidade = item.id_unidade_sei or _id_unidade()

    acesso = buscar_acesso_externo(sei, item, id_unidade)
    prazo = abrir_prazo_defesa(
        db, item, acesso,
        autor=usuario.nome or usuario.email or "Sistema",
        sei=sei,
        id_unidade=id_unidade,
        dias=DIAS_DEFESA_PREVIA,
        exigir_disponibilizacao=exigir_disponibilizacao,
    )
    if prazo is None:
        return None
    db.commit()

    # Gerar certidão de disponibilização no SEI (best-effort)
    try:
        from app.services.documentos_automaticos import gerar_certidao_disponibilizacao
        destinatario = item.razao_social or "Interessado"
        # Email não está armazenado no item — usar genérico
        gerar_certidao_disponibilizacao(sei, item, destinatario, "", id_unidade)
    except Exception:
        pass  # Falha na certidão não impede o prazo

    return prazo


class DisponibilizarAcessoExternoIn(PydanticBaseModel):
    """Dados para disponibilizar acesso externo ao interessado."""
    destinatario: str
    email_destinatario: str
    motivo: str = "Disponibilização de acesso para apresentação de defesa prévia"
    senha: str = ""
    series: str = "264"
    dias: str = "365"
    id_contato: str = ""


class DisponibilizarAcessoExternoOut(PydanticBaseModel):
    sucesso: bool
    mensagem: str
    dados_sei: dict | None = None


@router.post("/{item_id}/acesso-externo", response_model=DisponibilizarAcessoExternoOut)
def disponibilizar_acesso_externo(
    item_id: int,
    dados: DisponibilizarAcessoExternoIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Disponibiliza acesso externo ao interessado no processo instaurado.

    Após a instauração, o interessado precisa ter acesso ao processo para
    apresentar defesa prévia. Este endpoint chama a API do SEI para conceder
    esse acesso, permitindo que o interessado visualize e inclua documentos.

    O email da unidade é obtido automaticamente pela tabela config_email_unidade.
    """
    item = _obter_item(item_id, db)

    if item.status_triagem != "instaurado":
        raise HTTPException(400, "Acesso externo só pode ser concedido a processos instaurados.")

    # Usar o processo instaurado (novo), não o de fiscalização
    numero_processo = item.numero_processo_sei
    if not numero_processo:
        raise HTTPException(400, "Processo instaurado sem número SEI registrado.")

    id_unidade = item.id_unidade_sei or _id_unidade()
    if not id_unidade:
        raise HTTPException(503, "Unidade SEI não configurada.")

    # Buscar email da unidade na tabela de configuração
    config_email = db.query(m.ConfigEmailUnidade).filter_by(id_unidade=id_unidade).first()
    if not config_email:
        raise HTTPException(
            400,
            f"Email da unidade {id_unidade} não encontrado na configuração. "
            "Cadastre o email em config_email_unidade.",
        )

    sei = _sei_client()

    try:
        resultado = sei.disponibilizar_acesso_externo(
            protocolo_procedimento=numero_processo,
            id_unidade=id_unidade,
            email_unidade=config_email.email,
            destinatario=dados.destinatario,
            email_destinatario=dados.email_destinatario,
            motivo=dados.motivo,
            tipo="E",
            sin_inclusao="S",
            series=dados.series,
            dias=dados.dias,
            senha=dados.senha,
            id_contato=dados.id_contato,
        )
    except Exception as e:
        raise HTTPException(502, f"Erro ao disponibilizar acesso externo no SEI: {e}")

    # Prazo de 15 dias inicia agora (acesso externo concedido)
    _iniciar_prazo_defesa(db, item_id, usuario)

    return DisponibilizarAcessoExternoOut(
        sucesso=True,
        mensagem=f"Acesso externo disponibilizado com sucesso para {dados.destinatario} ({dados.email_destinatario}). Prazo de 15 dias iniciado.",
        dados_sei=resultado if isinstance(resultado, dict) else None,
    )


@router.get("/{item_id}/acesso-externo")
def listar_acesso_externo(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista as disponibilizações de acesso externo do processo."""
    item = _obter_item(item_id, db)

    numero_processo = item.numero_processo_sei or item.numero_sei
    if not numero_processo:
        raise HTTPException(400, "Processo sem número SEI.")

    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    try:
        resultado = sei.listar_disponibilizacoes_acesso_externo(numero_processo, id_unidade)
    except Exception as e:
        raise HTTPException(502, f"Erro ao listar disponibilizações: {e}")

    return resultado


@router.delete("/{item_id}/acesso-externo/{id_disponibilizacao}")
def cancelar_acesso_externo(
    item_id: int,
    id_disponibilizacao: str,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Cancela uma disponibilização de acesso externo."""
    item = _obter_item(item_id, db)

    numero_processo = item.numero_processo_sei or item.numero_sei
    if not numero_processo:
        raise HTTPException(400, "Processo sem número SEI.")

    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    try:
        sei.cancelar_disponibilizacao_acesso_externo(numero_processo, id_unidade, id_disponibilizacao)
    except Exception as e:
        raise HTTPException(502, f"Erro ao cancelar disponibilização: {e}")

    return {"sucesso": True, "mensagem": "Disponibilização cancelada com sucesso."}


@router.post("/{item_id}/iniciar-prazo-defesa")
def iniciar_prazo_defesa(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Abre o prazo de defesa prévia na mão (saída de emergência).

    O normal é o prazo abrir sozinho quando o SEI registra a disponibilização
    do acesso externo — pela automação de prazos ou ao abrir a tela do processo.
    Este endpoint atende o caso em que o andamento não aparece (disponibilização
    por outro meio, histórico incompleto): a contagem passa a valer da data da
    disponibilização, se houver andamento, ou de hoje.

    Se o prazo já existe, não cria outro.
    """
    item = _obter_item(item_id, db)

    if item.status_triagem != "instaurado":
        raise HTTPException(400, "Prazo de defesa só pode ser iniciado para processos instaurados.")

    prazo = _iniciar_prazo_defesa(db, item_id, usuario, exigir_disponibilizacao=False)

    if prazo is None:
        return {
            "sucesso": True,
            "mensagem": "Este processo já tem prazo de defesa prévia registrado.",
        }

    return {
        "sucesso": True,
        "mensagem": (
            f"Prazo de {prazo.dias} dias para defesa prévia iniciado em "
            f"{prazo.data_inicio.strftime('%d/%m/%Y')} — vence em "
            f"{prazo.data_vencimento.strftime('%d/%m/%Y')}."
        ),
    }


class GerarEditalIn(PydanticBaseModel):
    """Dados para gerar edital no SEI."""
    tipo: str = "citacao"  # "citacao" ou "intimacao_alegacoes"


def _abrir_prazo_do_edital(
    db: Session, item: m.CaixaEntrada, item_id: int, nome_autor: str,
) -> m.PrazoProcesso | None:
    """Abre os 15 dias que correm do edital de citação.

    Só faz sentido quando o processo está na defesa prévia e o prazo anterior
    já venceu sem visualização — é justamente o caso em que o edital é o
    caminho. Se ainda há prazo correndo, não cria outro.
    """
    from datetime import date, timedelta
    from sqlalchemy import select as sa_select

    fase_reg = db.scalars(
        sa_select(m.FaseProcessoAndamento)
        .where(m.FaseProcessoAndamento.caixa_entrada_id == item_id)
        .order_by(m.FaseProcessoAndamento.data_entrada.desc())
        .limit(1)
    ).first()
    if not fase_reg or fase_reg.fase != "aguardando_defesa":
        return None

    em_andamento = db.scalars(
        sa_select(m.PrazoProcesso).where(
            m.PrazoProcesso.caixa_entrada_id == item_id,
            m.PrazoProcesso.fase == "aguardando_defesa",
            m.PrazoProcesso.status == "em_andamento",
        )
    ).first()
    if em_andamento:
        return None

    hoje = date.today()
    prazo = m.PrazoProcesso(
        caixa_entrada_id=item_id,
        fase="aguardando_defesa",
        dias=DIAS_DEFESA_PREVIA,
        data_inicio=hoje,
        # Edital publicado hoje: contagem começa amanhã e o vencimento cai em
        # dia útil (Lei 10.177/1998, art. 25).
        data_vencimento=calculo_prazos.calcular_vencimento(hoje, DIAS_DEFESA_PREVIA, db),
        status="em_andamento",
        registrado_sei=False,
    )
    db.add(prazo)
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id,
        tipo="prazo_definido",
        descricao=(
            f"Prazo de {DIAS_DEFESA_PREVIA} dias reaberto pelo edital de citação "
            f"(vence em {prazo.data_vencimento.strftime('%d/%m/%Y')})"
        ),
        autor=nome_autor,
    ))

    numero_processo = item.numero_processo_sei or item.numero_sei
    id_unidade = item.id_unidade_sei or _id_unidade()
    if numero_processo:
        try:
            sei = _sei_client()
            sei.definir_prazo(
                numero_processo, id_unidade,
                data_prazo=prazo.data_vencimento.strftime("%d/%m/%Y"),
            )
            prazo.registrado_sei = True
        except Exception:  # noqa: BLE001
            pass  # Falha no SEI não impede o prazo local

    return prazo


@router.post("/{item_id}/gerar-edital")
def gerar_edital_endpoint(
    item_id: int,
    dados: GerarEditalIn = GerarEditalIn(),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Gera um edital (citação ou intimação para alegações finais) no processo SEI.

    O edital é criado como documento interno no SEI. Após a geração, o analista
    deve acessar o processo no SEI e publicar o edital manualmente no Diário Oficial.

    Retorna o número do documento gerado para referência.
    """
    item = _obter_item(item_id, db)

    if item.status_triagem != "instaurado":
        raise HTTPException(400, "Edital só pode ser gerado para processos instaurados.")

    if dados.tipo not in ("citacao", "intimacao_alegacoes"):
        raise HTTPException(400, "Tipo de edital deve ser 'citacao' ou 'intimacao_alegacoes'.")

    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    from app.services.documentos_automaticos import gerar_edital

    try:
        resultado = gerar_edital(sei, item, id_unidade, tipo=dados.tipo)
    except Exception as e:
        raise HTTPException(502, f"Erro ao gerar edital no SEI: {e}")

    if not resultado:
        raise HTTPException(502, "Não foi possível gerar o edital. Verifique os logs.")

    # Registrar evento
    nome_autor = usuario.nome or usuario.email or "Sistema"
    tipo_label = "citação" if dados.tipo == "citacao" else "intimação para alegações finais"
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id,
        tipo="edital_gerado",
        descricao=f"Edital de {tipo_label} gerado: {resultado.get('documentoFormatado', '')}. Publicar manualmente no SEI.",
        autor=nome_autor,
    ))

    # O edital de citação abre a segunda rodada de 15 dias da defesa prévia.
    # Vencida também esta, o caminho é a certidão de decurso (não outro edital).
    prazo_edital = None
    if dados.tipo == "citacao":
        prazo_edital = _abrir_prazo_do_edital(db, item, item_id, nome_autor)

    db.commit()

    # Link para o processo no SEI
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    link_sei = f"https://sei.sp.gov.br/sei/controlador.php?acao=procedimento_trabalhar&id_procedimento={id_procedimento}" if id_procedimento else None

    mensagem = (
        f"Edital de {tipo_label} gerado com sucesso ({resultado.get('documentoFormatado')}). "
        "Acesse o processo no SEI para publicar no Diário Oficial."
    )
    if prazo_edital:
        mensagem += (
            f" Novo prazo de {DIAS_DEFESA_PREVIA} dias aberto, vencendo em "
            f"{prazo_edital.data_vencimento.strftime('%d/%m/%Y')}."
        )

    return {
        "sucesso": True,
        "documento_formatado": resultado.get("documentoFormatado"),
        "id_documento": resultado.get("idDocumento"),
        "link_sei": link_sei,
        "mensagem": mensagem,
    }


@router.post("/{item_id}/gerar-notificacao-recurso")
def gerar_notificacao_recurso_endpoint(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Gera a notificação para interposição de recurso no processo SEI.

    Usado após a Decisão I ser proferida e publicada. O analista então
    disponibiliza acesso externo e inicia o prazo de recurso (15 dias).
    """
    item = _obter_item(item_id, db)

    if item.status_triagem != "instaurado":
        raise HTTPException(400, "Notificação de recurso só pode ser gerada para processos instaurados.")

    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    from app.services.documentos_automaticos import gerar_notificacao_recurso

    try:
        resultado = gerar_notificacao_recurso(sei, item, id_unidade)
    except Exception as e:
        raise HTTPException(502, f"Erro ao gerar notificação de recurso: {e}")

    if not resultado:
        raise HTTPException(502, "Não foi possível gerar a notificação. Verifique os logs.")

    nome_autor = usuario.nome or usuario.email or "Sistema"
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id,
        tipo="notificacao_recurso",
        descricao=f"Notificação para recurso gerada: {resultado.get('documentoFormatado', '')}",
        autor=nome_autor,
    ))
    db.commit()

    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    link_sei = f"https://sei.sp.gov.br/sei/controlador.php?acao=procedimento_trabalhar&id_procedimento={id_procedimento}" if id_procedimento else None

    return {
        "sucesso": True,
        "documento_formatado": resultado.get("documentoFormatado"),
        "id_documento": resultado.get("idDocumento"),
        "link_sei": link_sei,
        "mensagem": f"Notificação para recurso gerada ({resultado.get('documentoFormatado')}). Disponibilize o acesso externo e inicie o prazo de recurso.",
    }


@router.post("/{item_id}/gerar-termo-encerramento")
def gerar_termo_encerramento_endpoint(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Gera o termo de encerramento do processo no SEI.

    Usado como etapa final do processo — após decurso de recurso ou decisão II.
    """
    item = _obter_item(item_id, db)

    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    from app.services.documentos_automaticos import gerar_termo_encerramento

    try:
        resultado = gerar_termo_encerramento(sei, item, id_unidade)
    except Exception as e:
        raise HTTPException(502, f"Erro ao gerar termo de encerramento: {e}")

    if not resultado:
        raise HTTPException(502, "Não foi possível gerar o termo de encerramento. Verifique os logs.")

    nome_autor = usuario.nome or usuario.email or "Sistema"
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id,
        tipo="encerramento",
        descricao=f"Termo de encerramento gerado: {resultado.get('documentoFormatado', '')}",
        autor=nome_autor,
    ))
    db.commit()

    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    link_sei = f"https://sei.sp.gov.br/sei/controlador.php?acao=procedimento_trabalhar&id_procedimento={id_procedimento}" if id_procedimento else None

    return {
        "sucesso": True,
        "documento_formatado": resultado.get("documentoFormatado"),
        "id_documento": resultado.get("idDocumento"),
        "link_sei": link_sei,
        "mensagem": f"Termo de encerramento gerado ({resultado.get('documentoFormatado')}). O processo pode ser encerrado.",
    }


# ==============================================================================
# Medida cautelar (upload de imagem/documento)
# ==============================================================================

from fastapi import File, UploadFile


@router.post("/{item_id}/medida-cautelar")
async def upload_medida_cautelar(
    item_id: int,
    arquivo: UploadFile = File(...),
    descricao: str = Query("Comprovante de medida cautelar (bloqueio)", description="Descrição do documento"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Faz upload de um arquivo (imagem/PDF) como medida cautelar no processo SEI.

    O arquivo é incluído como documento externo no processo instaurado.
    Uso típico: print de tela de outro sistema comprovando o bloqueio cautelar.

    Aceita: imagens (PNG, JPG, JPEG), PDF, ou qualquer arquivo que o SEI aceite.
    Tamanho máximo: 10 MB.
    """
    item = _obter_item(item_id, db)

    if item.status_triagem != "instaurado":
        raise HTTPException(400, "Medida cautelar só pode ser incluída em processos instaurados.")

    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        raise HTTPException(400, "Processo sem id_procedimento.")

    # Ler conteúdo do arquivo
    conteudo = await arquivo.read()
    if len(conteudo) > 10 * 1024 * 1024:
        raise HTTPException(400, "Arquivo excede o limite de 10 MB.")
    if len(conteudo) == 0:
        raise HTTPException(400, "Arquivo vazio.")

    nome_arquivo = arquivo.filename or "medida_cautelar"
    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    # 1. Upload do arquivo para o SEI
    try:
        id_arquivo = sei.upload_arquivo(id_unidade, nome_arquivo, conteudo)
    except Exception as e:
        raise HTTPException(502, f"Erro ao fazer upload do arquivo: {e}")

    # 2. Incluir como documento externo no processo
    try:
        resultado = sei.incluir_documento_externo(
            id_procedimento=id_procedimento,
            id_unidade=id_unidade,
            id_arquivo=id_arquivo,
            nome_arvore="Medida cautelar",
            id_serie="1917",  # Anexo
            descricao=descricao,
        )
    except Exception as e:
        raise HTTPException(502, f"Erro ao incluir documento no processo: {e}")

    # Registrar evento
    nome_autor = usuario.nome or usuario.email or "Sistema"
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id,
        tipo="medida_cautelar",
        descricao=f"Medida cautelar incluída: {resultado.get('documentoFormatado', '')} ({nome_arquivo})",
        autor=nome_autor,
    ))
    db.commit()

    id_proc_link = item.id_procedimento_processo or item.id_procedimento
    link_sei = f"https://sei.sp.gov.br/sei/controlador.php?acao=procedimento_trabalhar&id_procedimento={id_proc_link}" if id_proc_link else None

    return {
        "sucesso": True,
        "documento_formatado": resultado.get("documentoFormatado"),
        "id_documento": resultado.get("idDocumento"),
        "link_sei": link_sei,
        "mensagem": f"Medida cautelar incluída com sucesso ({nome_arquivo} — {resultado.get('documentoFormatado')}).",
    }


# ==============================================================================
# Documentos da fase de julgamento
# ==============================================================================

class GerarDecisaoIn(PydanticBaseModel):
    """Dados para gerar decisão/portaria."""
    penalidade: str = ""  # ex: "advertência", "suspensão das atividades por 30 dias"


@router.post("/{item_id}/gerar-certificacao-regularidade")
def gerar_certificacao_regularidade_endpoint(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Gera a certidão de regularidade processual no SEI (pré-julgamento)."""
    item = _obter_item(item_id, db)
    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    from app.services.documentos_automaticos import gerar_certificacao_regularidade
    resultado = gerar_certificacao_regularidade(sei, item, id_unidade)
    if not resultado:
        raise HTTPException(502, "Não foi possível gerar a certidão de regularidade.")

    nome_autor = usuario.nome or usuario.email or "Sistema"
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id, tipo="certificacao_regularidade",
        descricao=f"Certidão de regularidade processual gerada: {resultado.get('documentoFormatado', '')}",
        autor=nome_autor,
    ))
    db.commit()
    return _resposta_documento(resultado, item, "Certidão de regularidade processual gerada.")


@router.post("/{item_id}/gerar-parecer-merito")
def gerar_parecer_merito_endpoint(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Gera o parecer de mérito no SEI (fase de julgamento)."""
    item = _obter_item(item_id, db)
    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    from app.services.documentos_automaticos import gerar_parecer_merito
    resultado = gerar_parecer_merito(sei, item, id_unidade)
    if not resultado:
        raise HTTPException(502, "Não foi possível gerar o parecer de mérito.")

    nome_autor = usuario.nome or usuario.email or "Sistema"
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id, tipo="parecer_merito",
        descricao=f"Parecer de mérito gerado: {resultado.get('documentoFormatado', '')}",
        autor=nome_autor,
    ))
    db.commit()
    return _resposta_documento(resultado, item, "Parecer de mérito gerado. Preencha os campos e assine no SEI.")


@router.post("/{item_id}/gerar-decisao")
def gerar_decisao_endpoint(
    item_id: int,
    dados: GerarDecisaoIn = GerarDecisaoIn(),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Gera a Decisão I (aplicação de penalidade) no SEI."""
    item = _obter_item(item_id, db)
    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    from app.services.documentos_automaticos import gerar_decisao
    resultado = gerar_decisao(sei, item, id_unidade, penalidade=dados.penalidade)
    if not resultado:
        raise HTTPException(502, "Não foi possível gerar a decisão.")

    nome_autor = usuario.nome or usuario.email or "Sistema"
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id, tipo="decisao_gerada",
        descricao=f"Decisão gerada: {resultado.get('documentoFormatado', '')} — penalidade: {dados.penalidade or '(a preencher)'}",
        autor=nome_autor,
    ))
    db.commit()
    return _resposta_documento(resultado, item, "Decisão gerada. Preencha os campos, assine e publique no SEI.")


@router.post("/{item_id}/gerar-portaria")
def gerar_portaria_endpoint(
    item_id: int,
    dados: GerarDecisaoIn = GerarDecisaoIn(),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Gera a Portaria (para publicação no DOE) no SEI."""
    item = _obter_item(item_id, db)
    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    from app.services.documentos_automaticos import gerar_portaria
    resultado = gerar_portaria(sei, item, id_unidade, penalidade=dados.penalidade)
    if not resultado:
        raise HTTPException(502, "Não foi possível gerar a portaria.")

    nome_autor = usuario.nome or usuario.email or "Sistema"
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id, tipo="portaria_gerada",
        descricao=f"Portaria gerada: {resultado.get('documentoFormatado', '')}. Publicar manualmente no SEI.",
        autor=nome_autor,
    ))
    db.commit()
    return _resposta_documento(resultado, item, "Portaria gerada. Acesse o SEI para publicar no Diário Oficial.")


@router.post("/{item_id}/gerar-despacho-arquivamento")
def gerar_despacho_arquivamento_endpoint(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Gera o despacho de arquivamento (encerramento) no SEI."""
    item = _obter_item(item_id, db)
    id_unidade = item.id_unidade_sei or _id_unidade()
    sei = _sei_client()

    from app.services.documentos_automaticos import gerar_despacho_arquivamento
    resultado = gerar_despacho_arquivamento(sei, item, id_unidade)
    if not resultado:
        raise HTTPException(502, "Não foi possível gerar o despacho de arquivamento.")

    nome_autor = usuario.nome or usuario.email or "Sistema"
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id, tipo="despacho_arquivamento",
        descricao=f"Despacho de arquivamento gerado: {resultado.get('documentoFormatado', '')}",
        autor=nome_autor,
    ))
    db.commit()
    return _resposta_documento(resultado, item, "Despacho de arquivamento gerado.")


def _resposta_documento(resultado: dict, item: m.CaixaEntrada, mensagem: str) -> dict:
    """Monta resposta padrão para endpoints de geração de documento."""
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    link_sei = f"https://sei.sp.gov.br/sei/controlador.php?acao=procedimento_trabalhar&id_procedimento={id_procedimento}" if id_procedimento else None
    return {
        "sucesso": True,
        "documento_formatado": resultado.get("documentoFormatado"),
        "id_documento": resultado.get("idDocumento"),
        "link_sei": link_sei,
        "mensagem": mensagem,
    }


# ==============================================================================
# Comunicação por e-mail (registro de envio)
# ==============================================================================

class EnviarComunicacaoIn(PydanticBaseModel):
    """Dados para registrar envio de comunicação por e-mail."""
    destinatario: str  # nome ou razão social
    email: str
    assunto: str = "Comunicação — Processo Administrativo Sancionatório"
    corpo: str = ""  # HTML ou texto do e-mail (opcional: se vazio, usa template)
    tipo: str = "encerramento"  # encerramento, notificacao, citacao, etc.


@router.post("/{item_id}/enviar-comunicacao")
def enviar_comunicacao(
    item_id: int,
    dados: EnviarComunicacaoIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Registra o envio de comunicação por e-mail ao interessado ou órgão competente.

    O envio real do e-mail é feito pelo SEI (criando documento do tipo E-mail no
    processo). Este endpoint registra no banco que a comunicação foi realizada,
    para rastreabilidade e BI.

    Se no futuro quisermos enviar e-mail diretamente (SMTP ou Graph), este
    endpoint já está preparado para ser estendido.
    """
    item = _obter_item(item_id, db)

    nome_autor = usuario.nome or usuario.email or "Sistema"

    # Registrar evento de comunicação
    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id,
        tipo="comunicacao_enviada",
        descricao=(
            f"Comunicação enviada para {dados.destinatario} ({dados.email}). "
            f"Tipo: {dados.tipo}. Assunto: {dados.assunto}"
        ),
        autor=nome_autor,
    ))

    # Notificação de registro
    db.add(m.Notificacao(
        caixa_entrada_id=item_id,
        tipo="comunicacao_enviada",
        titulo=f"Comunicação enviada: {dados.tipo}",
        descricao=f"E-mail enviado para {dados.destinatario} ({dados.email}) — {dados.assunto}",
    ))

    db.commit()

    return {
        "sucesso": True,
        "mensagem": (
            f"Comunicação registrada com sucesso. "
            f"Destinatário: {dados.destinatario} ({dados.email}). "
            f"Para efetuar o envio real, crie um documento do tipo E-mail no SEI do processo."
        ),
    }


# ==============================================================================
# Atribuição de responsável
# ==============================================================================

PERFIS_GESTORES = ("coordenador", "chefe_divisao")


def _pode_alterar_atribuicao(usuario: UsuarioAutenticado, db: Session) -> bool:
    """Coordenador ou chefe de divisão pode alterar a atribuição do processo."""
    from app.core.security import AUTH_ENABLED, ROLES_COORDENADOR
    if not AUTH_ENABLED:
        return True
    if ROLES_COORDENADOR & set(usuario.roles or []):
        return True
    email = (usuario.email or "").strip().lower()
    if email:
        registro = db.query(m.Usuario).filter(m.Usuario.email.ilike(email), m.Usuario.ativo.is_(True)).first()
        if registro and (registro.perfil or "").strip().lower() in PERFIS_GESTORES:
            return True
    return False


class AtribuicaoOut(PydanticBaseModel):
    responsavel_id: int | None = None
    responsavel_nome: str | None = None
    responsavel_email: str | None = None
    pode_editar: bool = False


class AtribuicaoIn(PydanticBaseModel):
    responsavel_id: int | None = None


@router.get("/{item_id}/atribuicao")
def obter_atribuicao(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
) -> AtribuicaoOut:
    """Retorna quem está responsável pelo processo e se o usuário pode editar."""
    item = _obter_item(item_id, db)
    responsavel = None
    if item.responsavel_id:
        responsavel = db.get(m.Usuario, item.responsavel_id)
    return AtribuicaoOut(
        responsavel_id=item.responsavel_id,
        responsavel_nome=responsavel.nome if responsavel else None,
        responsavel_email=responsavel.email if responsavel else None,
        pode_editar=_pode_alterar_atribuicao(usuario, db),
    )


@router.put("/{item_id}/atribuicao")
def alterar_atribuicao(
    item_id: int,
    dados: AtribuicaoIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
) -> AtribuicaoOut:
    """Altera o responsável pelo processo. Restrito a coordenador e chefe de divisão."""
    if not _pode_alterar_atribuicao(usuario, db):
        raise HTTPException(403, "Apenas coordenadores e chefes de divisão podem alterar a atribuição.")
    item = _obter_item(item_id, db)
    if dados.responsavel_id is not None:
        novo_responsavel = db.get(m.Usuario, dados.responsavel_id)
        if not novo_responsavel or not novo_responsavel.ativo:
            raise HTTPException(404, "Usuário não encontrado ou inativo.")
    item.responsavel_id = dados.responsavel_id
    db.commit()

    responsavel = db.get(m.Usuario, item.responsavel_id) if item.responsavel_id else None
    return AtribuicaoOut(
        responsavel_id=item.responsavel_id,
        responsavel_nome=responsavel.nome if responsavel else None,
        responsavel_email=responsavel.email if responsavel else None,
        pode_editar=True,
    )


# ==============================================================================
# Priorização (★) — Documentação de Negócio v3.0
#
# Sobe o processo no ordenamento das filas e dá destaque visual em todas as
# telas. Não altera prazo legal nenhum: é ordenação de trabalho, não de rito.
# ==============================================================================


class PrioridadeOut(PydanticBaseModel):
    prioritario: bool = False
    justificativa: str | None = None
    definida_por: str | None = None
    definida_em: str | None = None
    pode_editar: bool = False


class PrioridadeIn(PydanticBaseModel):
    prioritario: bool
    justificativa: str | None = None


def _prioridade_resposta(item: m.CaixaEntrada, pode_editar: bool) -> PrioridadeOut:
    return PrioridadeOut(
        prioritario=bool(item.prioritario),
        justificativa=item.prioridade_justificativa,
        definida_por=item.prioridade_definida_por,
        definida_em=item.prioridade_definida_em.isoformat() if item.prioridade_definida_em else None,
        pode_editar=pode_editar,
    )


@router.get("/{item_id}/prioridade")
def obter_prioridade(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
) -> PrioridadeOut:
    """Estado da priorização e se o usuário pode alterá-la."""
    from app.core.security import pode_priorizar

    item = _obter_item(item_id, db)
    return _prioridade_resposta(item, pode_priorizar(usuario, db))


@router.put("/{item_id}/prioridade")
def alterar_prioridade(
    item_id: int,
    dados: PrioridadeIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
) -> PrioridadeOut:
    """Marca ou desmarca o processo como prioritário para toda a equipe.

    A justificativa é obrigatória ao priorizar: a coluna ★ da tela de prazos
    mostra o motivo, e priorizar sem dizer por quê transfere para o resto da
    equipe uma decisão sem contexto.
    """
    from app.core.security import pode_priorizar

    if not pode_priorizar(usuario, db):
        raise HTTPException(
            403,
            "Apenas a Coordenação e as chefias de divisão e serviço podem "
            "priorizar processos.",
        )

    item = _obter_item(item_id, db)
    justificativa = (dados.justificativa or "").strip()
    if dados.prioritario and not justificativa:
        raise HTTPException(422, "Informe a justificativa da priorização.")

    autor = usuario.nome or usuario.email or "Sistema"
    item.prioritario = dados.prioritario
    if dados.prioritario:
        item.prioridade_justificativa = justificativa
        item.prioridade_definida_por = autor
        item.prioridade_definida_em = m._agora()
    else:
        item.prioridade_justificativa = None
        item.prioridade_definida_por = None
        item.prioridade_definida_em = None

    db.add(m.EventoProcesso(
        caixa_entrada_id=item_id,
        tipo="prioridade_alterada",
        descricao=(
            f"Processo priorizado pela Coordenação: {justificativa}"
            if dados.prioritario
            else "Priorização removida"
        ),
        autor=autor,
    ))
    db.commit()
    return _prioridade_resposta(item, True)
