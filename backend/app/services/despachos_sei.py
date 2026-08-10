"""
Geração de despachos/documentos SEI (Arquivar, TAC, Instaurar).

Consulta dados de referência (templates, blocos, códigos) do banco próprio
(tabelas config_*). Quando o banco não tiver o dado (migração ainda não rodou),
faz fallback para o Graph (SharePoint) — garantindo que funciona durante a
transição.

Portado dos fluxos do Power Automate `incluirTAC` (Arquivar e TAC) e
`testeCriacaoDOC` (Instaurar), lidos dos exports em `flows_referencia/`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.orm import Session

from app.db import models as m
from app.integrations.graph.client import GraphClient
from app.integrations.sei.client import SeiApiError, SeiClient, SeiErroDefinitivoError, SeiIndisponivelError
from app.services import classificacao_modelos as cm
from app.services import series_sei as series
from app.services.agentes_regulados import subclasse as subclasse_agente

LISTA_SEI_DESPACHOS_ID = "2bc584ff-9266-471c-a7d3-f646aa261379"
LISTA_BLOCOS_ASSINATURA_ID = "f55f9a83-5cca-48db-bebb-20d542dc23e1"
LISTA_CODIGOS_API_ID = "67bfcb94-ec83-42e6-872a-cf94ff69eca1"

# Séries do SEI (ver app/services/series_sei.py). O arquivamento usa o modelo
# "Decisão 743 - Arquivamento", então entra como Decisão — antes usava 2403, que
# é Termo de encerramento.
ID_SERIE_ARQUIVAR = series.DECISAO
ID_SERIE_TAC = series.TERMO_AJUSTAMENTO_CONDUTA
ID_SERIE_INSTAURAR = series.TERMO_INSTAURACAO

# descricaoDOC usada para buscar o TEMPLATE em listaSEIDespachos (não é o texto
# salvo no documento, é só a chave de busca do template — igual ao app original).
DESCRICAO_TEMPLATE_ARQUIVAR = "DETRAN - Decisão 743 - Arquivamento"
DESCRICAO_TEMPLATE_TAC = "DETRAN - Termo de ajustamento de conduta"
DESCRICAO_TEMPLATE_INSTAURAR = "DETRAN - Termo de instauração"

CARGO_PADRAO = "Chefe de Divisão"
CARGO_COORDENADOR = "Coordenador"

CODIGO_ASSUNTO_PADRAO = "015.02.06.002"
DESCRICAO_ASSUNTO_PADRAO = "Processo Administrativo Sancionatório"
ID_HIPOTESE_LEGAL_PADRAO = "114"


class DespachoSeiError(Exception):
    """Erro ao gerar ou enviar um despacho/documento ao SEI.

    Atributos:
        temporario: True se a causa foi uma instabilidade do SEI (vale tentar
            de novo depois); False se é um erro definitivo (precisa de ajuste
            manual nos dados ou verificação de permissão).
        numero_sei_criado / id_procedimento_criado: preenchidos quando um NOVO
            processo já foi criado no SEI antes do erro ocorrer (só acontece
            no fluxo de Instaurar). Nesse caso, **não se deve tentar de novo
            pelo botão** — isso criaria um segundo processo. O usuário precisa
            continuar manualmente no processo já criado, ou contatar o suporte.
    """

    def __init__(
        self,
        message: str,
        *,
        temporario: bool = False,
        numero_sei_criado: str | None = None,
        id_procedimento_criado: str | None = None,
        etapa: str | None = None,
    ):
        super().__init__(message)
        self.temporario = temporario
        self.numero_sei_criado = numero_sei_criado
        self.id_procedimento_criado = id_procedimento_criado
        self.etapa = etapa


class TemplateNaoEncontradoError(DespachoSeiError):
    """Nenhum template encontrado em listaSEIDespachos para os critérios dados."""


@dataclass
class ResultadoAcaoSei:
    """Resultado de uma ação (Arquivar/TAC/Instaurar) executada com sucesso.

    `avisos` traz problemas não-críticos que não impediram o resultado
    principal (ex.: falha ao incluir no bloco de assinatura) — o usuário deve
    ser informado para que possa concluir manualmente essa parte no SEI.
    """

    numero_sei: str
    id_procedimento: str
    id_documento: str | None
    documento_formatado: str | None
    avisos: list[str] = field(default_factory=list)


def _descrever_erro_sei(e: SeiApiError) -> str:
    """Mensagem amigável a partir de um erro classificado do cliente SEI."""
    if isinstance(e, SeiIndisponivelError):
        return f"O SEI está temporariamente indisponível: {e}"
    return f"O SEI recusou a solicitação: {e}"


def _buscar_template(
    graph: Optional[GraphClient],
    site_id: str,
    agente_regulado: str,
    descricao_doc: str,
    db: Optional[Session] = None,
    funcao: str | None = None,
) -> dict | None:
    """Busca o template de despacho — primeiro no banco, depois no Graph (fallback).

    Tenta com o agente exato; se não achar, tenta com agenteRegulado="Qualquer"
    (usado pelos despachos genéricos de Arquivamento/TAC).

    ``funcao`` é o papel do documento no fluxo (``arquivamento_relatorio``,
    ``tac``, ``termo_instauracao``). Os modelos oficiais são gravados como
    ``<função>|<rótulo>``, com várias variantes por função, então a busca por
    função pega a primeira variante disponível — ver
    ``app/services/classificacao_modelos.py``. É o caminho principal desde que
    os modelos passaram a vir do processo de textos-padrão do SEI;
    ``descricao_doc`` continua atendendo os registros antigos do SharePoint.

    Registro com HTML vazio é tratado como inexistente. A migração do SharePoint
    trouxe as chaves de todos os templates mas nenhum conteúdo, e esses registros
    vazios faziam o editor abrir em branco em vez de cair no fallback.
    """
    def _valido(reg) -> bool:
        return bool(reg and (reg.template_html or "").strip())

    def _resposta(reg) -> dict:
        return {"HTML": reg.template_html, "nomeArvore": reg.nome_arvore or ""}

    # --- Tentativa 1: banco próprio ---
    if db:
        # Por função (modelos oficiais), do agente e depois do curinga
        if funcao:
            prefixo = f"{funcao}{cm.SEPARADOR}%"
            for agente in (agente_regulado, "Qualquer"):
                reg = (
                    db.query(m.ConfigTemplateDespacho)
                    .filter(
                        m.ConfigTemplateDespacho.agente_regulado == agente,
                        m.ConfigTemplateDespacho.descricao_doc.like(prefixo),
                    )
                    .order_by(m.ConfigTemplateDespacho.descricao_doc)
                    .first()
                )
                if _valido(reg):
                    return _resposta(reg)

        reg = db.query(m.ConfigTemplateDespacho).filter_by(
            agente_regulado=agente_regulado, descricao_doc=descricao_doc
        ).first()
        if _valido(reg):
            return _resposta(reg)
        if agente_regulado != "Qualquer":
            reg = db.query(m.ConfigTemplateDespacho).filter_by(
                agente_regulado="Qualquer", descricao_doc=descricao_doc
            ).first()
            if _valido(reg):
                return _resposta(reg)

    if graph is None:
        return None

    # --- Fallback: Graph (SharePoint) ---
    filtro = f"fields/agenteRegulado eq '{agente_regulado}' and fields/descricaoDOC eq '{descricao_doc}'"
    itens = graph.get_list_items_filtered(site_id, LISTA_SEI_DESPACHOS_ID, filtro, top=1)
    if itens:
        return itens[0].get("fields", itens[0])

    if agente_regulado != "Qualquer":
        filtro_generico = f"fields/agenteRegulado eq 'Qualquer' and fields/descricaoDOC eq '{descricao_doc}'"
        itens = graph.get_list_items_filtered(site_id, LISTA_SEI_DESPACHOS_ID, filtro_generico, top=1)
        if itens:
            return itens[0].get("fields", itens[0])

    return None


def _buscar_id_bloco(
    graph: Optional[GraphClient],
    site_id: str,
    agente_regulado: str,
    cargo: str,
    db: Optional[Session] = None,
) -> str | None:
    """idBloco de assinatura para (agente, cargo).

    ``graph`` é opcional: quem já tem o dado migrado para o banco pode passar
    None e evitar abrir conexão com o SharePoint só para um fallback.
    """
    # --- Banco ---
    if db:
        reg = db.query(m.ConfigBlocoAssinatura).filter_by(
            agente_regulado=agente_regulado, cargo=cargo
        ).first()
        if reg:
            return reg.id_bloco

    if graph is None:
        return None

    # --- Fallback: Graph ---
    filtro = f"fields/agenteRegulado eq '{agente_regulado}' and fields/cargo eq '{cargo}'"
    itens = graph.get_list_items_filtered(site_id, LISTA_BLOCOS_ASSINATURA_ID, filtro, top=1)
    if not itens:
        return None
    campos = itens[0].get("fields", itens[0])
    return campos.get("idBloco")


def _buscar_id_tipo_procedimento(
    graph: Optional[GraphClient],
    site_id: str,
    agente_regulado: str,
    db: Optional[Session] = None,
    agente_origem: str | None = None,
) -> str | None:
    """idTipoProcedimento para abrir o processo sancionatório do agente.

    ``agente_origem`` é o nome como veio da listaDesignacao e só importa para
    Perito: o SEI tem tipos distintos para Clínica, Médico e Psicólogo, e nenhum
    tipo único de "Perito" (conferido em ``GET /processos/tipos``). Nesse caso a
    chave da configuração é ``Perito | <subclasse>``.
    """
    chaves = [agente_regulado]

    sub = subclasse_agente(agente_origem) if agente_origem else None
    if sub:
        # A chave mais específica vem primeiro.
        chaves.insert(0, f"{agente_regulado} | {sub}")

    # --- Banco ---
    if db:
        for chave in chaves:
            reg = db.query(m.ConfigTipoProcedimento).filter_by(agente_regulado=chave).first()
            if reg:
                return reg.id_tipo_procedimento

    if graph is None:
        return None

    # --- Fallback: Graph ---
    filtro = f"fields/agenteRegulado eq '{agente_regulado}'"
    itens = graph.get_list_items_filtered(site_id, LISTA_CODIGOS_API_ID, filtro, top=1)
    if not itens:
        return None
    campos = itens[0].get("fields", itens[0])
    return campos.get("idTipoProcedimento")


def _link_direto(item: m.CaixaEntrada, sei_web_url: str) -> str:
    if not sei_web_url or not item.id_procedimento:
        return ""
    base = sei_web_url.rstrip("/")
    return f"{base}/controlador.php?acao=procedimento_trabalhar&id_procedimento={item.id_procedimento}"


def _substituir_placeholders(html: str, item: m.CaixaEntrada, link_documento: str) -> str:
    """Substitui os placeholders mais comuns do template pelos dados do item.

    Cobre os tokens observados nos templates de Arquivamento/TAC/Instauração
    lidos dos fluxos de referência. Placeholders sem correspondência (ex.:
    [TIPO_SANCAO], [DESCRICAO_FATO]) são deixados como estão para o analista
    preencher manualmente no editor.
    """
    razao = item.razao_social or ""
    cnpj = item.cnpj_cpf or ""
    # Texto do link é o número do SEI da fiscalização (em vez de "Link Direto"),
    # a pedido do usuário. Se não houver link disponível, mostra o número puro.
    texto_link = item.numero_sei or "Link Direto"
    link_html = f"<a href='{link_documento}' target='_blank'>{texto_link}</a>" if link_documento else texto_link

    # Data da fiscalização formatada
    data_fisc_formatada = ""
    if item.data_inicio_fiscalizacao:
        meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
                 "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
        d = item.data_inicio_fiscalizacao
        data_fisc_formatada = f"{d.day} de {meses[d.month - 1]} de {d.year}"

    substituicoes: dict[str, str] = {
        "[NOME COMPLETO]": razao.upper(),
        "NOME COMPLETO DO COMPROMISSÁRIO": razao.upper(),
        "[NOME_EMPRESA_MAIUSCULO]": razao.upper(),
        "[NOME DA EMPRESA]": razao.upper(),
        "[NOME DA EMPRESA MAIÚSCULA]": razao.upper(),
        "[NOME EMPRESARIAL EM NEGRITO]": razao.upper(),
        "[NOME_EMPRESA_MINUSCULO]": razao.lower(),
        "[Nome da empresa minúsculo]": razao.lower(),
        "[NOME_EMPRESA]": razao.upper(),
        "[CNPJ]": cnpj,
        "[NN.NNN.NNN/000N-NN]": cnpj,
        "[NNN.NNN.NNN-NN]": cnpj,
        "000.000.000-00": cnpj,
        "[LINK_DOCUMENTO]": link_html,
        "[link]": link_html,
        "[DIA] de [MES] de [ANO]": data_fisc_formatada or "[DIA] de [MES] de [ANO]",
        "[DATA_FISCALIZACAO]": data_fisc_formatada or "[DATA_FISCALIZACAO]",
        "Chefe de Divisão": "Chefe de Divisão",  # placeholder — será trocado se cautelar
    }

    resultado = html
    for token, valor in substituicoes.items():
        resultado = resultado.replace(token, valor)
    return resultado


def _montar_template(
    graph: Optional[GraphClient],
    site_id: str,
    agente_regulado: str,
    descricao_template: str,
    item: m.CaixaEntrada,
    sei_web_url: str,
    db: Optional[Session] = None,
    funcao: str | None = None,
) -> str:
    template = _buscar_template(
        graph, site_id, agente_regulado, descricao_template, db=db, funcao=funcao,
    )
    if not template:
        alvo = f"função='{funcao}'" if funcao else f"descricaoDOC='{descricao_template}'"
        raise TemplateNaoEncontradoError(
            f"Nenhum modelo encontrado para agenteRegulado='{agente_regulado}' / {alvo}."
        )
    html_base = template.get("HTML", "") or ""
    link = _link_direto(item, sei_web_url)
    return _substituir_placeholders(html_base, item, link)


# ---------------------------------------------------------------------------
# Templates (chamados pelo endpoint GET, para carregar no editor)
# ---------------------------------------------------------------------------
def _montar_de_texto_padrao(
    chave: str, item: m.CaixaEntrada, sei_web_url: str, db: Optional[Session],
) -> str | None:
    """Monta o documento a partir dos textos-padrão importados da área.

    São eles a fonte atual dos modelos (``scripts/importar_textos_padroes.py``).
    Devolve None quando a chave não está cadastrada, para quem chama poder cair
    no template antigo do SharePoint.
    """
    if db is None:
        return None

    from app.services.catalogo_fases import montar_html

    html = montar_html(db, chave, item)
    if not html:
        return None
    # Além das variáveis próprias dos textos-padrão, aplica os placeholders
    # herdados dos modelos antigos ([NOME DA EMPRESA], [LINK_DOCUMENTO]...).
    return _substituir_placeholders(html, item, _link_direto(item, sei_web_url))


def modelos_disponiveis(
    db: Optional[Session], funcao: str, item: m.CaixaEntrada,
) -> list[dict]:
    """Variantes de uma função para o agente do item, com nome legível.

    Vem tudo do banco: as variantes são os modelos oficiais importados do
    processo de textos-padrão. Antes as opções eram listas fixas no código, o que
    não acompanhava a chegada de modelos novos.

    A variante marcada como padrão pelo coordenador vem primeiro, com
    ``padrao=True``.
    """
    if db is None:
        return []

    from app.services.catalogo_fases import listar_modelos

    opcoes = []
    for registro in listar_modelos(db, funcao, item.agente_regulado):
        _funcao, rotulo = cm.partes_da_chave(registro.descricao_doc)
        opcoes.append({
            "chave": registro.descricao_doc,
            "nome": rotulo or registro.descricao_doc,
            "padrao": bool(registro.padrao),
        })
    return opcoes


def _modelo_padrao(db: Optional[Session], funcao: str, item: m.CaixaEntrada) -> str | None:
    """Modelo a usar quando a tela não informou nenhum.

    É o que o coordenador fixou como padrão para aquela função e agente; sem
    marca, o primeiro em ordem alfabética. A ordenação vem de
    ``catalogo_fases.listar_modelos``.
    """
    opcoes = modelos_disponiveis(db, funcao, item)
    return opcoes[0]["chave"] if opcoes else None


def montar_template_arquivar(
    graph: Optional[GraphClient], site_id: str, item: m.CaixaEntrada, sei_web_url: str,
    db: Optional[Session] = None, modelo: str | None = None,
) -> str:
    """Modelo do arquivamento do relatório.

    Os modelos oficiais são por agente e por motivo do arquivamento (sem
    irregularidade, baixa cadastral, duplicidade...), então ``modelo`` permite à
    tela escolher; sem ele, vem a primeira variante do agente.
    """
    chave = modelo or _modelo_padrao(db, "arquivamento_relatorio", item)
    if chave:
        html = _montar_de_texto_padrao(chave, item, sei_web_url, db)
        if html:
            return html
    return _montar_template(
        graph, site_id, item.agente_regulado or "Qualquer", DESCRICAO_TEMPLATE_ARQUIVAR,
        item, sei_web_url, db=db, funcao="arquivamento_relatorio",
    )


def montar_template_tac(
    graph: Optional[GraphClient], site_id: str, item: m.CaixaEntrada, sei_web_url: str,
    db: Optional[Session] = None, modelo: str | None = None,
) -> str:
    chave = modelo or _modelo_padrao(db, "tac", item)
    if chave:
        html = _montar_de_texto_padrao(chave, item, sei_web_url, db)
        if html:
            return html
    return _montar_template(
        graph, site_id, item.agente_regulado or "Qualquer", DESCRICAO_TEMPLATE_TAC,
        item, sei_web_url, db=db, funcao="tac",
    )


def modelos_termo_instauracao(
    item: m.CaixaEntrada, db: Optional[Session] = None,
) -> list[dict[str, str]]:
    """Variantes do termo de instauração para o agente do item.

    Sai do banco: para desmonte são as versões por lei estadual e federal, para
    os demais as versões com e sem medida cautelar, e para perito as duas
    também. Antes essa lista era fixa no código, com o desmonte tratado à parte.
    """
    return modelos_disponiveis(db, "termo_instauracao", item)


def montar_template_instaurar(
    graph: Optional[GraphClient],
    site_id: str,
    item: m.CaixaEntrada,
    sei_web_url: str,
    db: Optional[Session] = None,
    cautelar: bool = False,
    modelo: str | None = None,
) -> str:
    chave = modelo
    if not chave:
        opcoes = modelos_termo_instauracao(item, db)
        # Com medida cautelar, prefere a variante que a mencione no rótulo.
        if cautelar:
            chave = next(
                (o["chave"] for o in opcoes if "cautelar" in o["nome"].lower()),
                None,
            )
        if not chave:
            # Sem cautelar, evita a variante cautelar quando há alternativa.
            sem_cautelar = [o for o in opcoes if "cautelar" not in o["nome"].lower()]
            escolhidas = sem_cautelar or opcoes
            chave = escolhidas[0]["chave"] if escolhidas else None

    if chave:
        html = _montar_de_texto_padrao(chave, item, sei_web_url, db)
        if html:
            return html

    return _montar_template(
        graph, site_id, item.agente_regulado or "Qualquer", DESCRICAO_TEMPLATE_INSTAURAR,
        item, sei_web_url, db=db, funcao="termo_instauracao",
    )


# ---------------------------------------------------------------------------
# Ações (chamadas pelos endpoints POST, para efetivamente criar no SEI)
# ---------------------------------------------------------------------------
def executar_arquivar(
    sei: SeiClient,
    graph: GraphClient,
    site_id: str,
    item: m.CaixaEntrada,
    html: str,
    id_unidade: str,
    cargo: str = CARGO_PADRAO,
    db: Optional[Session] = None,
) -> ResultadoAcaoSei:
    """Arquiva o relatório de fiscalização: despacho + termo de encerramento.

    A área definiu a sequência: o despacho editado pelo analista, depois o termo
    de encerramento do relatório, os dois no bloco de assinatura do chefe de
    divisão, e por fim a conclusão do relatório no SEI.

    A conclusão do processo na unidade **não** é feita aqui: a API do SEI
    disponibilizada não tem operação para isso (só recebimento). Ela entra como
    aviso, para o analista concluir no SEI — e não como falha silenciosa, que
    deixaria o relatório aberto sem ninguém perceber.
    """
    resultado = _executar_incluir_documento_no_processo_existente(
        sei, graph, site_id, item, html, id_unidade, cargo,
        id_serie=ID_SERIE_ARQUIVAR, nome_arvore="", db=db,
    )

    if db is not None:
        resultado.avisos.extend(
            _incluir_termo_encerramento(sei, db, item, id_unidade, cargo, resultado.id_procedimento)
        )

    resultado.avisos.append(
        "Documentos gerados e enviados para assinatura. Depois de assinados, conclua o "
        "relatório no SEI — a API disponibilizada não permite concluir o processo pelo app."
    )
    return resultado


def _incluir_termo_encerramento(
    sei: SeiClient,
    db: Session,
    item: m.CaixaEntrada,
    id_unidade: str,
    cargo: str,
    id_procedimento: str,
) -> list[str]:
    """Inclui o termo de encerramento do relatório e o manda para assinatura.

    Devolve avisos. O despacho principal já está no SEI quando isto roda, então
    uma falha aqui não invalida o arquivamento — mas precisa ser informada, para
    o analista completar manualmente.
    """
    from app.services.catalogo_fases import montar_html

    html_termo = montar_html(db, "termo_encerramento", item)
    if not html_termo:
        return [
            "O termo de encerramento não foi gerado: o modelo 'termo_encerramento' não está "
            "cadastrado. Rode scripts/importar_textos_padroes.py."
        ]

    try:
        doc = sei.incluir_documento(
            id_procedimento, id_unidade, series.TERMO_ENCERRAMENTO, html_termo,
            nome_arvore="Termo de encerramento", nivel_acesso="1",
        )
    except SeiApiError as e:
        return [
            f"O despacho foi criado, mas o termo de encerramento falhou "
            f"({_descrever_erro_sei(e)}). Gere o termo manualmente no SEI."
        ]

    documento_formatado = doc.get("documentoFormatado")
    if not documento_formatado:
        return []

    avisos: list[str] = []
    id_bloco = _buscar_id_bloco(None, "", item.agente_regulado or "", cargo, db=db)

    if not id_bloco:
        avisos.append(
            f"O termo de encerramento {documento_formatado} foi criado, mas não há bloco de "
            f"assinatura cadastrado para '{item.agente_regulado}' / '{cargo}'. Inclua manualmente."
        )
    else:
        try:
            sei.incluir_documento_bloco(id_bloco, documento_formatado, id_unidade)
        except SeiApiError as e:
            avisos.append(
                f"O termo de encerramento {documento_formatado} foi criado, mas não entrou no "
                f"bloco de assinatura ({_descrever_erro_sei(e)}). Inclua manualmente no SEI."
            )
    return avisos


def executar_tac(
    sei: SeiClient,
    graph: GraphClient,
    site_id: str,
    item: m.CaixaEntrada,
    html: str,
    id_unidade: str,
    cargo: str = CARGO_PADRAO,
    db: Optional[Session] = None,
) -> ResultadoAcaoSei:
    return _executar_incluir_documento_no_processo_existente(
        sei, graph, site_id, item, html, id_unidade, cargo,
        id_serie=ID_SERIE_TAC, nome_arvore="", db=db,
    )


def _executar_incluir_documento_no_processo_existente(
    sei: SeiClient,
    graph: GraphClient,
    site_id: str,
    item: m.CaixaEntrada,
    html: str,
    id_unidade: str,
    cargo: str,
    id_serie: str,
    nome_arvore: str,
    db: Optional[Session] = None,
) -> ResultadoAcaoSei:
    if not item.numero_sei:
        raise DespachoSeiError("Item sem número SEI.")

    # 1. Marca como recebido na unidade. Se o processo já estava recebido, o
    #    SEI normalmente responde com erro definitivo (ex.: "já recebido") —
    #    isso é esperado e seguimos adiante. Erros TEMPORÁRIOS aqui, porém,
    #    interrompem o fluxo: nada foi criado ainda, então é seguro abortar
    #    e deixar o usuário tentar de novo sem risco de duplicidade.
    try:
        sei.receber_processo(item.numero_sei, id_unidade)
    except SeiIndisponivelError as e:
        raise DespachoSeiError(
            f"Não foi possível confirmar o recebimento do processo {item.numero_sei} "
            f"({_descrever_erro_sei(e)}). Nenhum documento foi criado ainda — pode tentar novamente.",
            temporario=True, etapa="receber_processo",
        ) from e
    except SeiErroDefinitivoError:
        pass  # provavelmente já estava recebido; segue o fluxo normalmente

    # 2. Consulta o processo para obter o idProcedimento atual.
    try:
        detalhes = sei.consultar_processo(item.numero_sei, id_unidade)
    except SeiApiError as e:
        raise DespachoSeiError(
            f"Não foi possível consultar o processo {item.numero_sei} ({_descrever_erro_sei(e)}). "
            "Nenhum documento foi criado ainda.",
            temporario=isinstance(e, SeiIndisponivelError), etapa="consultar_processo",
        ) from e
    id_procedimento = detalhes.get("idProcedimento")
    if not id_procedimento:
        raise DespachoSeiError(f"Não foi possível obter idProcedimento para {item.numero_sei}.")

    # 3. Inclui o documento gerado a partir do HTML. A partir daqui, se algo
    #    falhar, o documento pode já ter sido criado no SEI — não é seguro
    #    tentar de novo automaticamente (criaria um documento duplicado).
    try:
        doc = sei.incluir_documento(
            id_procedimento, id_unidade, id_serie, html, nome_arvore=nome_arvore, nivel_acesso="1",
        )
    except SeiApiError as e:
        raise DespachoSeiError(
            f"Falha ao incluir o documento no processo {item.numero_sei} ({_descrever_erro_sei(e)}). "
            "Verifique manualmente no SEI se o documento foi criado antes de tentar novamente "
            "(para não duplicar).",
            temporario=isinstance(e, SeiIndisponivelError), etapa="incluir_documento",
        ) from e
    id_documento = doc.get("idDocumento")
    documento_formatado = doc.get("documentoFormatado")

    avisos: list[str] = []

    # 4. Inclui no bloco de assinatura do responsável (se encontrarmos o bloco).
    #    O documento já existe no SEI nesse ponto — uma falha aqui não deve
    #    ser escondida do usuário: ele precisa saber que terá que incluir o
    #    documento no bloco manualmente.
    agente = item.agente_regulado or ""
    try:
        id_bloco = _buscar_id_bloco(graph, site_id, agente, cargo, db=db)
    except Exception as e:  # noqa: BLE001
        id_bloco = None
        avisos.append(
            f"Não foi possível localizar o bloco de assinatura para '{agente}' / '{cargo}': {e}. "
            "Inclua o documento manualmente no bloco de assinatura correto."
        )
    if not id_bloco:
        if not avisos:
            avisos.append(
                f"Nenhum bloco de assinatura cadastrado para '{agente}' / '{cargo}'. "
                "Inclua o documento manualmente no bloco de assinatura correto."
            )
    elif documento_formatado:
        try:
            sei.incluir_documento_bloco(id_bloco, documento_formatado, id_unidade)
        except SeiApiError as e:
            avisos.append(
                f"O documento {documento_formatado} foi criado, mas não foi possível incluí-lo "
                f"no bloco de assinatura ({_descrever_erro_sei(e)}). Inclua manualmente no SEI."
            )

    return ResultadoAcaoSei(
        numero_sei=item.numero_sei,
        id_procedimento=str(id_procedimento),
        id_documento=str(id_documento) if id_documento else None,
        documento_formatado=documento_formatado,
        avisos=avisos,
    )


def executar_instaurar(
    sei: SeiClient,
    graph: GraphClient,
    site_id: str,
    item: m.CaixaEntrada,
    html: str,
    id_unidade: str,
    cautelar: bool,
    db: Optional[Session] = None,
) -> ResultadoAcaoSei:
    """Cria um NOVO processo SEI de instauração e inclui o documento nele."""
    agente = item.agente_regulado or ""
    id_tipo_procedimento = _buscar_id_tipo_procedimento(
        graph, site_id, agente, db=db, agente_origem=item.agente_origem,
    )
    if not id_tipo_procedimento:
        sub = subclasse_agente(item.agente_origem)
        detalhe = f"agenteRegulado='{agente}'"
        if sub:
            detalhe = f"agenteRegulado='{agente} | {sub}'"
        elif agente == "Perito":
            # Sem a subclasse não há como escolher entre Clínica, Médico e
            # Psicólogo, que são tipos diferentes no SEI.
            detalhe += (
                f" (agente de origem '{item.agente_origem or 'não informado'}' não permite "
                "identificar se é clínica, médico ou psicólogo)"
            )
        raise DespachoSeiError(f"idTipoProcedimento não encontrado para {detalhe}.")

    razao = item.razao_social or ""
    cnpj = item.cnpj_cpf or ""
    tipo_doc = item.tipo_documento or ""
    especificacao = f"{razao} - {tipo_doc} {cnpj}".strip(" -")

    # 1. Cria o processo novo. Se falhar aqui (antes de qualquer resposta com
    #    sucesso), nada foi criado no SEI — seguro tentar de novo.
    try:
        novo = sei.criar_processo(
            id_unidade, id_tipo_procedimento, especificacao,
            id_hipotese_legal=ID_HIPOTESE_LEGAL_PADRAO, nivel_acesso="1",
            codigo_assunto=CODIGO_ASSUNTO_PADRAO, descricao_assunto=DESCRICAO_ASSUNTO_PADRAO,
        )
    except SeiApiError as e:
        raise DespachoSeiError(
            f"Falha ao criar o novo processo SEI ({_descrever_erro_sei(e)}). Nenhum processo foi criado.",
            temporario=isinstance(e, SeiIndisponivelError), etapa="criar_processo",
        ) from e

    id_procedimento = novo.get("idProcedimento")
    numero_novo = novo.get("procedimentoFormatado")
    if not id_procedimento or not numero_novo:
        raise DespachoSeiError("Falha ao criar o novo processo SEI (resposta sem idProcedimento).")

    # A PARTIR DESTE PONTO o processo novo já existe no SEI. Qualquer erro daqui
    # em diante NÃO deve ser tratado como "pode tentar de novo do zero" — isso
    # criaria um segundo processo. Informamos o número já criado para o usuário
    # continuar manualmente (incluir o documento direto no processo indicado).
    avisos: list[str] = []

    # 2. Marca o processo novo como recebido na unidade.
    try:
        sei.receber_processo(numero_novo, id_unidade)
    except SeiApiError as e:
        avisos.append(
            f"O processo {numero_novo} foi criado, mas não foi possível confirmar o recebimento "
            f"na unidade ({_descrever_erro_sei(e)}). Verifique manualmente no SEI."
        )

    # 2.5. Incluir conjunto probatório (PDF dos docs da fiscalização) ANTES do termo.
    #      Falha aqui não impede a instauração — vira aviso para o usuário incluir depois.
    if item.id_procedimento:
        try:
            from app.api.routes.documentos import _gerar_pdf_unificado
            resultado_pdf = _gerar_pdf_unificado(item.id_procedimento, id_unidade)
            nome_pdf = f"Conjunto_probatorio_{item.numero_sei or ''}.pdf"
            id_arquivo = sei.upload_arquivo(id_unidade, nome_pdf, resultado_pdf.pdf_bytes)
            sei.incluir_documento_externo(
                id_procedimento=id_procedimento,
                id_unidade=id_unidade,
                id_arquivo=id_arquivo,
                nome_arvore="Conjunto probatório",
                id_serie="1917",
                descricao=f"Documentos do processo de fiscalização {item.numero_sei}",
            )
            # Informar sobre documentos que não entraram no PDF
            if resultado_pdf.docs_falha:
                nomes = ", ".join(
                    f"{d['numero']} ({d['nome']})" for d in resultado_pdf.docs_falha[:5]
                )
                avisos.append(
                    f"O conjunto probatório foi incluído, mas {len(resultado_pdf.docs_falha)} "
                    f"documento(s) não puderam ser baixados e ficaram de fora do PDF: {nomes}. "
                    "Verifique se esses documentos precisam ser anexados manualmente."
                )
        except Exception as e:
            avisos.append(
                f"Não foi possível incluir o conjunto probatório automaticamente: {e}. "
                "Inclua manualmente no SEI (baixe os documentos da fiscalização e anexe no processo novo)."
            )

    # 3. Inclui o documento de instauração no processo novo.
    # Se cautelar, trocar "Chefe de Divisão" por "Coordenador" no corpo do documento
    html_final = html
    if cautelar:
        html_final = html_final.replace("Chefe de Divisão", "Coordenador")
        html_final = html_final.replace("chefe de divisão", "Coordenador")
        html_final = html_final.replace("CHEFE DE DIVISÃO", "COORDENADOR")

    try:
        doc = sei.incluir_documento(
            id_procedimento, id_unidade, ID_SERIE_INSTAURAR, html_final, nome_arvore="", nivel_acesso="1",
        )
    except SeiApiError as e:
        raise DespachoSeiError(
            f"O processo {numero_novo} foi criado, mas houve falha ao incluir o documento de "
            f"instauração ({_descrever_erro_sei(e)}). NÃO tente instaurar de novo — o processo já "
            f"existe. Acesse o processo {numero_novo} diretamente no SEI para incluir o documento "
            "manualmente.",
            temporario=False,  # processo já existe: repetir do botão duplicaria o processo
            numero_sei_criado=numero_novo, id_procedimento_criado=str(id_procedimento),
            etapa="incluir_documento",
        ) from e
    id_documento = doc.get("idDocumento")
    documento_formatado = doc.get("documentoFormatado")

    # 4. Inclui no bloco de assinatura (Coordenador se cautelar, Chefe de Divisão se não).
    cargo = CARGO_COORDENADOR if cautelar else CARGO_PADRAO
    try:
        id_bloco = _buscar_id_bloco(graph, site_id, agente, cargo, db=db)
    except Exception as e:  # noqa: BLE001
        id_bloco = None
        avisos.append(
            f"Não foi possível localizar o bloco de assinatura para '{agente}' / '{cargo}': {e}. "
            "Inclua o documento manualmente no bloco de assinatura correto."
        )
    if not id_bloco and not avisos:
        avisos.append(
            f"Nenhum bloco de assinatura cadastrado para '{agente}' / '{cargo}'. "
            "Inclua o documento manualmente no bloco de assinatura correto."
        )
    elif id_bloco and documento_formatado:
        try:
            sei.incluir_documento_bloco(id_bloco, documento_formatado, id_unidade)
        except SeiApiError as e:
            avisos.append(
                f"O documento {documento_formatado} foi criado, mas não foi possível incluí-lo "
                f"no bloco de assinatura ({_descrever_erro_sei(e)}). Inclua manualmente no SEI."
            )

    return ResultadoAcaoSei(
        numero_sei=numero_novo,
        id_procedimento=str(id_procedimento),
        id_documento=str(id_documento) if id_documento else None,
        documento_formatado=documento_formatado,
        avisos=avisos,
    )
