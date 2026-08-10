"""Acesso externo do SEI: quando foi disponibilizado e se foi visualizado.

Regra da área para a defesa prévia:

1. O prazo de 15 dias conta **da disponibilização do acesso externo**, não da
   data em que o analista clicou no botão do app. E ele **abre sozinho**: quem
   dispara é o andamento do SEI, não uma ação na tela — o botão "iniciar prazo"
   ficou só para o caso de o andamento não aparecer.
2. Se o interessado **visualizar** o acesso, a contagem **reinicia** por mais 15
   dias, contados da visualização (uma vez só).
3. Vencido **sem visualização** → o caso vai para **edital de citação** (o app
   libera a criação do documento; a publicação é manual no SEI).
4. Vencido **com visualização** e sem defesa → **certidão de decurso de prazo**.
5. Defesa juntada **depois** do vencimento → notificar no app (intempestiva).

Os dois fatos (disponibilização e visualização) vêm do **mesmo** andamento do
SEI, a tarefa 50::

    Disponibilizado acesso externo para @DESTINATARIO_NOME@
    (@DESTINATARIO_EMAIL@)@VALIDADE@.@VISUALIZACAO@ @MOTIVO@

A data do andamento é a disponibilização; o trecho ``@VISUALIZACAO@`` só é
preenchido ("Visualizado em dd/mm/yyyy hh:mm:ss") quando o destinatário abre o
link. Por isso "existe andamento de tarefa 50" **não** significa visualização —
era o que o código fazia antes, e o prazo reiniciava no mesmo dia em que
começava, dando 30 dias a todo mundo.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models as m
from app.services import calculo_prazos

#: Disponibilizado acesso externo (a descrição também informa a visualização).
TAREFA_ACESSO_EXTERNO = "50"
#: Mesma coisa, mas a disponibilização foi cancelada depois — não vale.
TAREFA_ACESSO_EXTERNO_CANCELADO = "89"
#: Registro de documento externo (defesa/alegações/recurso juntados).
TAREFA_DOCUMENTO_EXTERNO = "13"

#: "Visualizado em 10/07/2026 14:23:11" — o SEI escreve dentro da tarefa 50.
_RE_VISUALIZACAO = re.compile(
    r"visualizad[oa][^\d]{0,30}(\d{2}/\d{2}/\d{4})", re.IGNORECASE,
)
_RE_VISUALIZACAO_SEM_DATA = re.compile(r"visualizad[oa]", re.IGNORECASE)

#: Modelos de edital de citação (2ª rodada de prazo da defesa prévia).
CHAVES_EDITAL_CITACAO = ("citacao_edital", "edital_citacao")

#: Prazo da defesa prévia, em dias corridos.
DIAS_DEFESA_PREVIA = 15

FASE_DEFESA = "aguardando_defesa"


def converter_data(data_str: str | None) -> date | None:
    """``dd/mm/yyyy`` (formato do SEI) para ``date``; None se não der."""
    if not data_str:
        return None
    try:
        dia, mes, ano = str(data_str).strip().split(" ")[0].split("/")
        return date(int(ano), int(mes), int(dia))
    except (ValueError, IndexError):
        return None


@dataclass(frozen=True)
class AcessoExterno:
    """O que o SEI sabe sobre o acesso externo de um processo."""

    #: Data do andamento de disponibilização (início do prazo).
    data_disponibilizacao: date | None = None
    #: Data em que o interessado visualizou (reinicia o prazo).
    data_visualizacao: date | None = None
    #: Houve visualização mas o SEI não informou a data.
    visualizado_sem_data: bool = False

    @property
    def visualizado(self) -> bool:
        return self.data_visualizacao is not None or self.visualizado_sem_data


def extrair_acesso_externo(andamentos: list[dict]) -> AcessoExterno:
    """Lê os andamentos de tarefa 50 e devolve disponibilização/visualização.

    Considera a disponibilização **mais recente** que não foi cancelada — se o
    analista cancelou e disponibilizou de novo, o prazo conta da última. A
    visualização é a mais recente encontrada entre elas.
    """
    disponibilizacao: date | None = None
    visualizacao: date | None = None
    visualizado_sem_data = False

    for andamento in andamentos or []:
        if str(andamento.get("idTarefa", "")) != TAREFA_ACESSO_EXTERNO:
            continue

        data = converter_data(andamento.get("data"))
        if data and (disponibilizacao is None or data > disponibilizacao):
            disponibilizacao = data

        descricao = andamento.get("descricao") or ""
        achado = _RE_VISUALIZACAO.search(descricao)
        if achado:
            vista = converter_data(achado.group(1))
            if vista and (visualizacao is None or vista > visualizacao):
                visualizacao = vista
        elif _RE_VISUALIZACAO_SEM_DATA.search(descricao):
            visualizado_sem_data = True

    return AcessoExterno(
        data_disponibilizacao=disponibilizacao,
        data_visualizacao=visualizacao,
        visualizado_sem_data=visualizado_sem_data and visualizacao is None,
    )


def datas_documentos_externos(andamentos: list[dict]) -> list[date]:
    """Datas dos andamentos de documento externo (tarefa 13), da mais antiga."""
    datas = [
        data
        for andamento in andamentos or []
        if str(andamento.get("idTarefa", "")) == TAREFA_DOCUMENTO_EXTERNO
        and (data := converter_data(andamento.get("data")))
    ]
    return sorted(datas)


def buscar_acesso_externo(sei, item: m.CaixaEntrada, id_unidade: str | None = None) -> AcessoExterno:
    """Consulta o SEI e devolve o estado do acesso externo do processo.

    Nunca levanta exceção: SEI fora do ar ou item sem procedimento devolvem um
    ``AcessoExterno`` vazio, e quem chamou decide o que fazer (normalmente,
    tentar de novo na próxima rodada).
    """
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        return AcessoExterno()

    try:
        resp = sei.listar_andamentos(
            id_procedimento,
            id_unidade or item.id_unidade_sei or "110053117",
            tipo_historico="T",
            tarefas=TAREFA_ACESSO_EXTERNO,
            start=0,
            limit=50,
        )
    except Exception:  # noqa: BLE001
        return AcessoExterno()

    return extrair_acesso_externo(resp.get("Andamentos", []))


def prazo_defesa_existe(db: Session, caixa_entrada_id: int) -> bool:
    """Já houve prazo de defesa prévia neste processo (em qualquer status)?

    Serve para o prazo não renascer depois de vencido ou respondido — a segunda
    rodada, quando cabe, é aberta pelo edital de citação.
    """
    return db.scalars(
        select(m.PrazoProcesso.id).where(
            m.PrazoProcesso.caixa_entrada_id == caixa_entrada_id,
            m.PrazoProcesso.fase == FASE_DEFESA,
        ).limit(1)
    ).first() is not None


def abrir_prazo_defesa(
    db: Session,
    item: m.CaixaEntrada,
    acesso: AcessoExterno,
    autor: str,
    *,
    sei=None,
    id_unidade: str | None = None,
    dias: int = DIAS_DEFESA_PREVIA,
    exigir_disponibilizacao: bool = True,
    notificar: bool = False,
    hoje: date | None = None,
) -> m.PrazoProcesso | None:
    """Abre o prazo de defesa prévia a partir do acesso externo do SEI.

    Devolve ``None`` (sem gravar nada) quando já existe prazo da defesa neste
    processo ou quando o SEI ainda não registrou a disponibilização — este
    segundo caso é o normal enquanto o analista não disponibilizou o acesso.

    ``exigir_disponibilizacao=False`` é o caminho manual da tela: o analista
    afirma que disponibilizou, mas o andamento não foi encontrado, e a contagem
    passa a valer de hoje.

    Se o SEI já registra visualização, o prazo nasce reiniciado, contado dela —
    é o que acontece quando a disponibilização é antiga e o interessado já abriu
    o link antes do app tomar conhecimento.
    """
    if prazo_defesa_existe(db, item.id):
        return None

    hoje = hoje or date.today()
    inicio = acesso.data_disponibilizacao
    if inicio is None:
        if exigir_disponibilizacao:
            return None
        inicio = hoje
    inicio = min(inicio, hoje)

    # Contagem pela Lei 10.177/1998: exclui o dia inicial, inclui o final e
    # prorroga vencimento em dia sem expediente (ver services/calculo_prazos.py).
    feriados = calculo_prazos.carregar_feriados(db)
    vencimento = calculo_prazos.calcular_vencimento(inicio, dias, feriados=feriados)
    reiniciado = bool(acesso.visualizado)
    data_reinicio = None
    if reiniciado:
        data_reinicio = max(acesso.data_visualizacao or hoje, inicio)
        vencimento = calculo_prazos.calcular_vencimento(data_reinicio, dias, feriados=feriados)

    prazo = m.PrazoProcesso(
        caixa_entrada_id=item.id,
        fase=FASE_DEFESA,
        dias=dias,
        data_inicio=inicio,
        data_vencimento=vencimento,
        reiniciado=reiniciado,
        data_reinicio=data_reinicio,
        status="em_andamento",
        registrado_sei=False,
    )
    db.add(prazo)

    origem = (
        f"disponibilização do acesso externo em {inicio.strftime('%d/%m/%Y')}"
        if acesso.data_disponibilizacao
        else f"informação do analista ({inicio.strftime('%d/%m/%Y')})"
    )
    descricao = (
        f"Prazo de {dias} dias para defesa prévia iniciado — conta da {origem}, "
        f"vence em {vencimento.strftime('%d/%m/%Y')}"
    )
    if reiniciado and data_reinicio:
        descricao += (
            f". Acesso já visualizado em {data_reinicio.strftime('%d/%m/%Y')}: "
            "contagem reiniciada a partir da visualização"
        )
    db.add(m.EventoProcesso(
        caixa_entrada_id=item.id,
        tipo="prazo_definido",
        descricao=descricao,
        autor=autor,
    ))

    if notificar:
        numero = item.numero_processo_sei or item.numero_sei or ""
        db.add(m.Notificacao(
            caixa_entrada_id=item.id,
            tipo="prazo_definido",
            titulo="Prazo de defesa prévia iniciado",
            descricao=(
                f"O SEI registrou a disponibilização do acesso externo do processo "
                f"{numero} em {inicio.strftime('%d/%m/%Y')}. O prazo de {dias} dias "
                f"vence em {vencimento.strftime('%d/%m/%Y')}."
            ),
        ))

    # Prazo também no SEI, quando há cliente para isso (best-effort: falhar aqui
    # não invalida o controle local).
    numero_processo = item.numero_processo_sei or item.numero_sei
    if sei is not None and numero_processo:
        try:
            sei.definir_prazo(
                numero_processo,
                id_unidade or item.id_unidade_sei or "110053117",
                data_prazo=vencimento.strftime("%d/%m/%Y"),
            )
            prazo.registrado_sei = True
        except Exception:  # noqa: BLE001
            pass

    return prazo


def edital_citacao_gerado(db: Session, caixa_entrada_id: int) -> bool:
    """Já existe edital de citação neste processo?

    É o que separa a 1ª rodada do prazo de defesa (vencida sem visualização →
    publicar edital) da 2ª (vencida depois do edital → certidão de decurso).
    Sem isso o app ficaria pedindo edital para sempre.
    """
    eventos = db.scalars(
        select(m.EventoProcesso).where(
            m.EventoProcesso.caixa_entrada_id == caixa_entrada_id,
            m.EventoProcesso.tipo.in_(("edital_gerado", "documento_gerado")),
        )
    ).all()

    for evento in eventos:
        if evento.tipo == "edital_gerado":
            descricao = (evento.descricao or "").lower()
            if "citaç" in descricao or "citac" in descricao or not descricao:
                return True
        if evento.tipo == "documento_gerado" and evento.dados_json:
            if any(chave in evento.dados_json for chave in CHAVES_EDITAL_CITACAO):
                return True
    return False


def alinhar_inicio_com_disponibilizacao(
    db: Session, prazo: m.PrazoProcesso, acesso: AcessoExterno, autor: str,
) -> bool:
    """Ajusta o início do prazo para a data real da disponibilização.

    Só corrige para **antes**: o app pode ter aberto o prazo dias depois (o
    analista disponibilizou direto no SEI e só então clicou no botão), e nesse
    caso o vencimento cai junto. Uma disponibilização posterior ao início
    gravado significaria um acesso novo, o que não é decisão da automação.
    """
    data = acesso.data_disponibilizacao
    if not data or prazo.reiniciado or data >= prazo.data_inicio:
        return False

    anterior = prazo.data_vencimento
    prazo.data_inicio = data
    prazo.data_vencimento = calculo_prazos.calcular_vencimento(data, prazo.dias, db)

    db.add(m.EventoProcesso(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo="prazo_ajustado",
        descricao=(
            f"Prazo recontado da disponibilização do acesso externo "
            f"({data.strftime('%d/%m/%Y')}): vencimento "
            f"{anterior.strftime('%d/%m/%Y')} → "
            f"{prazo.data_vencimento.strftime('%d/%m/%Y')}"
        ),
        autor=autor,
    ))
    return True


def reiniciar_por_visualizacao(
    db: Session,
    prazo: m.PrazoProcesso,
    acesso: AcessoExterno,
    item: m.CaixaEntrada,
    autor: str,
    hoje: date | None = None,
) -> bool:
    """Reinicia o prazo na visualização do acesso externo (uma vez).

    A contagem nova parte da **data da visualização**, não do dia em que a
    automação rodou — senão um fim de semana já esticaria o prazo.
    """
    if prazo.reiniciado or not acesso.visualizado:
        return False

    hoje = hoje or date.today()
    vista = acesso.data_visualizacao or hoje
    if vista < prazo.data_inicio:
        # Visualização de um acesso anterior ao prazo atual: não reinicia.
        return False

    prazo.reiniciado = True
    prazo.data_reinicio = vista
    prazo.data_vencimento = calculo_prazos.calcular_vencimento(vista, prazo.dias, db)

    numero = item.numero_processo_sei or item.numero_sei or ""
    db.add(m.EventoProcesso(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo="prazo_reiniciado",
        descricao=(
            f"Acesso externo visualizado em {vista.strftime('%d/%m/%Y')} — "
            f"prazo reiniciado por mais {prazo.dias} dias "
            f"(novo vencimento: {prazo.data_vencimento.strftime('%d/%m/%Y')})"
        ),
        autor=autor,
    ))
    db.add(m.Notificacao(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo="acesso_externo_visualizado",
        titulo="Acesso externo visualizado — prazo reiniciado",
        descricao=(
            f"O interessado visualizou o acesso externo do processo {numero} em "
            f"{vista.strftime('%d/%m/%Y')}. O prazo de {prazo.dias} dias reiniciou e "
            f"vence em {prazo.data_vencimento.strftime('%d/%m/%Y')}."
        ),
    ))
    return True


def notificar_defesa_intempestiva(
    db: Session, prazo: m.PrazoProcesso, item: m.CaixaEntrada, data_juntada: date,
) -> None:
    """Avisa que a defesa chegou depois do prazo (não impede a juntada).

    Quem decide o que fazer com defesa intempestiva é o analista; o app só
    garante que ele fique sabendo.
    """
    numero = item.numero_processo_sei or item.numero_sei or ""
    dias_atraso = (data_juntada - prazo.data_vencimento).days
    rotulo = "Defesa prévia" if prazo.fase == "aguardando_defesa" else "Manifestação"

    db.add(m.EventoProcesso(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo="defesa_intempestiva",
        descricao=(
            f"{rotulo} apresentada em {data_juntada.strftime('%d/%m/%Y')}, "
            f"{dias_atraso} dia(s) após o vencimento do prazo "
            f"({prazo.data_vencimento.strftime('%d/%m/%Y')})"
        ),
        autor="Sistema (automação)",
    ))
    db.add(m.Notificacao(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo="defesa_intempestiva",
        titulo=f"{rotulo} apresentada fora do prazo",
        descricao=(
            f"O interessado juntou documento no processo {numero} em "
            f"{data_juntada.strftime('%d/%m/%Y')}, {dias_atraso} dia(s) após o "
            f"vencimento do prazo ({prazo.data_vencimento.strftime('%d/%m/%Y')}). "
            "Avalie a tempestividade antes de considerar a manifestação."
        ),
    ))


def notificar_falta_de_visualizacao(
    db: Session, prazo: m.PrazoProcesso, item: m.CaixaEntrada,
) -> None:
    """Vencimento sem visualização: o caminho é o edital de citação."""
    numero = item.numero_processo_sei or item.numero_sei or ""

    db.add(m.EventoProcesso(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo="prazo_vencido",
        descricao=(
            f"Prazo venceu em {prazo.data_vencimento.strftime('%d/%m/%Y')} sem que o "
            "interessado visualizasse o acesso externo — cabe edital de citação"
        ),
        autor="Sistema (automação)",
    ))
    db.add(m.Notificacao(
        caixa_entrada_id=prazo.caixa_entrada_id,
        tipo="acesso_nao_visualizado",
        titulo="Acesso externo não visualizado — gerar edital de citação",
        descricao=(
            f"O prazo do processo {numero} venceu em "
            f"{prazo.data_vencimento.strftime('%d/%m/%Y')} e o interessado não "
            "visualizou o acesso externo. Gere o edital de citação na tela do "
            "processo e publique no Diário Oficial."
        ),
    ))
