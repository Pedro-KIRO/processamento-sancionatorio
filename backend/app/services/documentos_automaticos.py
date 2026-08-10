"""
Geração automática de documentos no SEI (certidões, intimações, etc.).

Documentos gerados pela automação (verificar_prazos) sem intervenção do
analista — usam templates com placeholders preenchidos automaticamente.

Os templates aqui são PLACEHOLDERS — serão substituídos pelos templates
definitivos quando a área de negócio fornecer. A estrutura de geração
(chamar SEI, incluir no bloco, registrar evento) já está pronta.
"""
from __future__ import annotations

import logging
from datetime import date

from app.db import models as m
from app.integrations.sei.client import SeiApiError, SeiClient
from app.services import series_sei as series

logger = logging.getLogger(__name__)

# Séries confirmadas em GET /series (ver app/services/series_sei.py). Antes tudo
# aqui usava 2403, que é Termo de encerramento e não Despacho — as certidões
# entravam na árvore do SEI com o rótulo errado.
ID_SERIE_CERTIDAO = series.CERTIDAO


# ==============================================================================
# Templates placeholder (substituir pelos definitivos da área de negócio)
# ==============================================================================

def _template_certidao_decurso_defesa(item: m.CaixaEntrada, data_vencimento: date) -> str:
    """Template placeholder da certidão de decurso de prazo de defesa prévia."""
    razao = item.razao_social or "INTERESSADO"
    cnpj = item.cnpj_cpf or ""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""
    data_fmt = data_vencimento.strftime("%d/%m/%Y")

    return f"""<p class="Texto_Centralizado"><strong>CERTIDÃO DE DECURSO DE PRAZO</strong></p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Certifico que o interessado <strong>{razao.upper()}</strong>{f', CNPJ/CPF {cnpj}' if cnpj else ''}, 
regularmente citado nos autos do Processo Administrativo Sancionatório nº <strong>{numero_processo}</strong>, 
deixou transcorrer <em>in albis</em> o prazo de 15 (quinze) dias corridos para apresentação de defesa prévia, 
cujo termo final se deu em <strong>{data_fmt}</strong>, sem que tenha se manifestado nos autos.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Dou fé.
</p>

<p class="Texto_Alinhado_Direita">
São Paulo, {date.today().strftime("%d de %B de %Y").replace("January", "janeiro").replace("February", "fevereiro").replace("March", "março").replace("April", "abril").replace("May", "maio").replace("June", "junho").replace("July", "julho").replace("August", "agosto").replace("September", "setembro").replace("October", "outubro").replace("November", "novembro").replace("December", "dezembro")}.
</p>
"""


def _template_certidao_decurso_alegacoes(item: m.CaixaEntrada, data_vencimento: date) -> str:
    """Template placeholder da certidão de decurso de prazo de alegações finais."""
    razao = item.razao_social or "INTERESSADO"
    cnpj = item.cnpj_cpf or ""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""
    data_fmt = data_vencimento.strftime("%d/%m/%Y")

    return f"""<p class="Texto_Centralizado"><strong>CERTIDÃO DE DECURSO DE PRAZO — ALEGAÇÕES FINAIS</strong></p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Certifico que o interessado <strong>{razao.upper()}</strong>{f', CNPJ/CPF {cnpj}' if cnpj else ''}, 
regularmente intimado nos autos do Processo Administrativo Sancionatório nº <strong>{numero_processo}</strong>, 
deixou transcorrer <em>in albis</em> o prazo de 7 (sete) dias corridos para apresentação de alegações finais, 
cujo termo final se deu em <strong>{data_fmt}</strong>, sem que tenha se manifestado nos autos.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Dou fé.
</p>

<p class="Texto_Alinhado_Direita">
São Paulo, {date.today().strftime("%d de %B de %Y").replace("January", "janeiro").replace("February", "fevereiro").replace("March", "março").replace("April", "abril").replace("May", "maio").replace("June", "junho").replace("July", "julho").replace("August", "agosto").replace("September", "setembro").replace("October", "outubro").replace("November", "novembro").replace("December", "dezembro")}.
</p>
"""


# ==============================================================================
# Geração e inclusão no SEI
# ==============================================================================

def gerar_certidao_decurso(
    sei: SeiClient,
    item: m.CaixaEntrada,
    data_vencimento: date,
    id_unidade: str,
    tipo_prazo: str = "defesa",
) -> dict | None:
    """Gera a certidão de decurso de prazo e inclui no processo SEI.

    Parâmetros:
        sei: cliente SEI autenticado
        item: item da caixa de entrada (com dados do processo)
        data_vencimento: data em que o prazo venceu
        id_unidade: unidade SEI para a operação
        tipo_prazo: "defesa" ou "alegacoes"

    Retorna:
        dict com dados do documento criado (idDocumento, documentoFormatado),
        ou None se falhou (erro logado mas não propagado — a automação não
        deve parar por falha na geração de certidão).
    """
    # Escolher o processo onde incluir a certidão
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        logger.warning("Item %s sem id_procedimento — não é possível gerar certidão", item.id)
        return None

    # Gerar HTML do template
    if tipo_prazo == "alegacoes":
        html = _template_certidao_decurso_alegacoes(item, data_vencimento)
    else:
        html = _template_certidao_decurso_defesa(item, data_vencimento)

    # Incluir documento no SEI
    try:
        resultado = sei.incluir_documento(
            id_procedimento=id_procedimento,
            id_unidade=id_unidade,
            id_serie=ID_SERIE_CERTIDAO,
            html=html,
            nome_arvore="Certidão de decurso de prazo",
            nivel_acesso="1",
        )
        logger.info(
            "Certidão de decurso gerada para processo %s: documento %s",
            item.numero_processo_sei or item.numero_sei,
            resultado.get("documentoFormatado"),
        )
        return resultado
    except SeiApiError as e:
        logger.error(
            "Falha ao gerar certidão de decurso para processo %s: %s",
            item.numero_processo_sei or item.numero_sei, e,
        )
        return None


# ==============================================================================
# Certidão de disponibilização de acesso externo
# ==============================================================================

def _template_certidao_disponibilizacao(item: m.CaixaEntrada, destinatario: str, email: str) -> str:
    """Template placeholder da certidão de disponibilização de acesso externo."""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""
    hoje_fmt = date.today().strftime("%d/%m/%Y")

    return f"""<p class="Texto_Centralizado"><strong>CERTIDÃO DE DISPONIBILIZAÇÃO DE ACESSO EXTERNO</strong></p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Certifico que, nesta data ({hoje_fmt}), foi disponibilizado acesso externo ao(à) interessado(a) 
<strong>{destinatario}</strong>, por meio do endereço eletrônico <strong>{email}</strong>, 
ao Processo Administrativo Sancionatório nº <strong>{numero_processo}</strong>, 
para fins de apresentação de defesa prévia, nos termos do artigo 64 da Lei Estadual nº 10.177/1998.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
O prazo para apresentação de defesa prévia é de 15 (quinze) dias corridos, contados a partir da data 
de disponibilização do acesso.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Dou fé.
</p>
"""


def gerar_certidao_disponibilizacao(
    sei: SeiClient,
    item: m.CaixaEntrada,
    destinatario: str,
    email: str,
    id_unidade: str,
) -> dict | None:
    """Gera certidão de disponibilização de acesso externo no processo SEI.

    Chamada após conceder acesso externo ao interessado.
    """
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        logger.warning("Item %s sem id_procedimento — não gerar certidão de disponibilização", item.id)
        return None

    html = _template_certidao_disponibilizacao(item, destinatario, email)

    try:
        resultado = sei.incluir_documento(
            id_procedimento=id_procedimento,
            id_unidade=id_unidade,
            id_serie=ID_SERIE_CERTIDAO,
            html=html,
            nome_arvore="Certidão de disponibilização de acesso externo",
            nivel_acesso="1",
        )
        logger.info(
            "Certidão de disponibilização gerada para processo %s: %s",
            item.numero_processo_sei or item.numero_sei,
            resultado.get("documentoFormatado"),
        )
        return resultado
    except SeiApiError as e:
        logger.error("Falha ao gerar certidão de disponibilização: %s", e)
        return None


# ==============================================================================
# Certidão de juntada (defesa ou alegações apresentadas)
# ==============================================================================

def _template_certidao_juntada(item: m.CaixaEntrada, data_juntada: date, tipo: str = "defesa") -> str:
    """Template placeholder da certidão de juntada de documentos."""
    razao = item.razao_social or "INTERESSADO"
    numero_processo = item.numero_processo_sei or item.numero_sei or ""
    data_fmt = data_juntada.strftime("%d/%m/%Y")

    tipo_texto = "defesa prévia" if tipo == "defesa" else "alegações finais"

    return f"""<p class="Texto_Centralizado"><strong>CERTIDÃO DE JUNTADA</strong></p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Certifico que, em {data_fmt}, o(a) interessado(a) <strong>{razao.upper()}</strong> 
apresentou documentos nos autos do Processo Administrativo Sancionatório nº <strong>{numero_processo}</strong>, 
a título de <strong>{tipo_texto}</strong>, conforme registro de documento externo constante nos autos.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Dou fé.
</p>
"""


def gerar_certidao_juntada(
    sei: SeiClient,
    item: m.CaixaEntrada,
    data_juntada: date,
    id_unidade: str,
    tipo: str = "defesa",
) -> dict | None:
    """Gera certidão de juntada no processo SEI.

    Chamada quando a automação detecta que o interessado juntou documentos
    (tarefa 13) — tanto para defesa prévia quanto para alegações finais.
    """
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        logger.warning("Item %s sem id_procedimento — não gerar certidão de juntada", item.id)
        return None

    html = _template_certidao_juntada(item, data_juntada, tipo)

    try:
        resultado = sei.incluir_documento(
            id_procedimento=id_procedimento,
            id_unidade=id_unidade,
            id_serie=ID_SERIE_CERTIDAO,
            html=html,
            nome_arvore="Certidão de juntada",
            nivel_acesso="1",
        )
        logger.info(
            "Certidão de juntada (%s) gerada para processo %s: %s",
            tipo, item.numero_processo_sei or item.numero_sei,
            resultado.get("documentoFormatado"),
        )
        return resultado
    except SeiApiError as e:
        logger.error("Falha ao gerar certidão de juntada: %s", e)
        return None


# ==============================================================================
# Edital de citação
# ==============================================================================

ID_SERIE_EDITAL = series.EDITAL


def _template_edital_citacao(item: m.CaixaEntrada) -> str:
    """Template placeholder do edital de citação."""
    razao = item.razao_social or "INTERESSADO"
    cnpj = item.cnpj_cpf or ""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""

    return f"""<p class="Texto_Centralizado"><strong>EDITAL DE CITAÇÃO</strong></p>

<p class="Texto_Centralizado">
Processo Administrativo Sancionatório nº <strong>{numero_processo}</strong>
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
O Departamento Estadual de Trânsito de São Paulo — DETRAN-SP, por meio da Coordenadoria de Processamento 
Sancionatório Administrativo e Recursal — CPSAR, no uso de suas atribuições legais, CITA, por edital, 
o(a) interessado(a) <strong>{razao.upper()}</strong>{f', CNPJ/CPF {cnpj}' if cnpj else ''}, 
por não ter sido possível a citação pessoal, para que, no prazo de 15 (quinze) dias corridos, contados 
da publicação deste edital no Diário Oficial do Estado de São Paulo, apresente defesa prévia nos autos 
do Processo Administrativo Sancionatório acima identificado, sob pena de revelia.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
A defesa deverá ser apresentada por meio do Sistema Eletrônico de Informações — SEI/SP, mediante 
acesso externo disponibilizado ao interessado, ou protocolada na sede do DETRAN-SP.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
O não atendimento ao presente edital no prazo estipulado implicará em decurso de prazo, prosseguindo-se 
o processo administrativo independentemente de nova intimação.
</p>
"""


def _template_edital_intimacao_alegacoes(item: m.CaixaEntrada) -> str:
    """Template placeholder do edital de intimação para alegações finais."""
    razao = item.razao_social or "INTERESSADO"
    cnpj = item.cnpj_cpf or ""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""

    return f"""<p class="Texto_Centralizado"><strong>EDITAL DE INTIMAÇÃO PARA ALEGAÇÕES FINAIS</strong></p>

<p class="Texto_Centralizado">
Processo Administrativo Sancionatório nº <strong>{numero_processo}</strong>
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
O Departamento Estadual de Trânsito de São Paulo — DETRAN-SP, por meio da Coordenadoria de Processamento 
Sancionatório Administrativo e Recursal — CPSAR, no uso de suas atribuições legais, INTIMA, por edital, 
o(a) interessado(a) <strong>{razao.upper()}</strong>{f', CNPJ/CPF {cnpj}' if cnpj else ''}, 
para que, no prazo de 7 (sete) dias corridos, contados da publicação deste edital no Diário Oficial 
do Estado de São Paulo, apresente alegações finais nos autos do Processo Administrativo Sancionatório 
acima identificado.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
As alegações finais deverão ser apresentadas por meio do Sistema Eletrônico de Informações — SEI/SP, 
mediante acesso externo disponibilizado ao interessado, ou protocoladas na sede do DETRAN-SP.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
O não atendimento ao presente edital no prazo estipulado implicará em decurso de prazo, prosseguindo-se 
o processo administrativo para julgamento independentemente de nova intimação.
</p>
"""


def gerar_edital(
    sei: SeiClient,
    item: m.CaixaEntrada,
    id_unidade: str,
    tipo: str = "citacao",
) -> dict | None:
    """Gera edital (citação ou intimação) como documento interno no processo SEI.

    O analista deve publicar o edital manualmente no SEI após a geração.

    Parâmetros:
        tipo: "citacao" ou "intimacao_alegacoes"

    Retorna dict com idDocumento/documentoFormatado ou None se falhou.
    """
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        logger.warning("Item %s sem id_procedimento — não gerar edital", item.id)
        return None

    if tipo == "intimacao_alegacoes":
        html = _template_edital_intimacao_alegacoes(item)
        nome_arvore = "Edital de intimação para alegações finais"
    else:
        html = _template_edital_citacao(item)
        nome_arvore = "Edital de citação"

    try:
        resultado = sei.incluir_documento(
            id_procedimento=id_procedimento,
            id_unidade=id_unidade,
            id_serie=ID_SERIE_EDITAL,
            html=html,
            nome_arvore=nome_arvore,
            nivel_acesso="1",
        )
        logger.info(
            "Edital (%s) gerado para processo %s: %s",
            tipo, item.numero_processo_sei or item.numero_sei,
            resultado.get("documentoFormatado"),
        )
        return resultado
    except SeiApiError as e:
        logger.error("Falha ao gerar edital (%s): %s", tipo, e)
        return None


# ==============================================================================
# Notificação para recurso
# ==============================================================================

ID_SERIE_NOTIFICACAO = series.NOTIFICACAO


def _template_notificacao_recurso(item: m.CaixaEntrada) -> str:
    """Template placeholder da notificação para interposição de recurso."""
    razao = item.razao_social or "INTERESSADO"
    cnpj = item.cnpj_cpf or ""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""

    return f"""<p class="Texto_Centralizado"><strong>NOTIFICAÇÃO PARA INTERPOSIÇÃO DE RECURSO</strong></p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Fica o(a) interessado(a) <strong>{razao.upper()}</strong>{f', CNPJ/CPF {cnpj}' if cnpj else ''}, 
NOTIFICADO(A) da decisão proferida nos autos do Processo Administrativo Sancionatório 
nº <strong>{numero_processo}</strong>, para que, querendo, apresente recurso no prazo de 
15 (quinze) dias corridos, contados da data de disponibilização do acesso ao processo, 
nos termos do artigo 64 da Lei Estadual nº 10.177/1998.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
O recurso deverá ser apresentado por meio do Sistema Eletrônico de Informações — SEI/SP, 
mediante acesso externo disponibilizado ao interessado.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
O não atendimento à presente notificação no prazo estipulado implicará no trânsito em 
julgado da decisão administrativa.
</p>
"""


def gerar_notificacao_recurso(
    sei: SeiClient,
    item: m.CaixaEntrada,
    id_unidade: str,
) -> dict | None:
    """Gera notificação para interposição de recurso no processo SEI."""
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        logger.warning("Item %s sem id_procedimento — não gerar notificação de recurso", item.id)
        return None

    html = _template_notificacao_recurso(item)

    try:
        resultado = sei.incluir_documento(
            id_procedimento=id_procedimento,
            id_unidade=id_unidade,
            id_serie=ID_SERIE_NOTIFICACAO,
            html=html,
            nome_arvore="Notificação para recurso",
            nivel_acesso="1",
        )
        logger.info(
            "Notificação para recurso gerada para processo %s: %s",
            item.numero_processo_sei or item.numero_sei,
            resultado.get("documentoFormatado"),
        )
        return resultado
    except SeiApiError as e:
        logger.error("Falha ao gerar notificação para recurso: %s", e)
        return None


# ==============================================================================
# Certidão de decurso de prazo de recurso
# ==============================================================================

def _template_certidao_decurso_recurso(item: m.CaixaEntrada, data_vencimento: date) -> str:
    """Template placeholder da certidão de decurso de prazo de recurso."""
    razao = item.razao_social or "INTERESSADO"
    cnpj = item.cnpj_cpf or ""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""
    data_fmt = data_vencimento.strftime("%d/%m/%Y")

    return f"""<p class="Texto_Centralizado"><strong>CERTIDÃO DE DECURSO DE PRAZO — RECURSO</strong></p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Certifico que o(a) interessado(a) <strong>{razao.upper()}</strong>{f', CNPJ/CPF {cnpj}' if cnpj else ''}, 
regularmente notificado(a) da decisão proferida nos autos do Processo Administrativo Sancionatório 
nº <strong>{numero_processo}</strong>, deixou transcorrer <em>in albis</em> o prazo de 15 (quinze) 
dias corridos para interposição de recurso, cujo termo final se deu em <strong>{data_fmt}</strong>, 
sem que tenha se manifestado nos autos.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Certifico, ainda, que a decisão administrativa transitou em julgado na data acima indicada.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Dou fé.
</p>
"""


def gerar_certidao_decurso_recurso(
    sei: SeiClient,
    item: m.CaixaEntrada,
    data_vencimento: date,
    id_unidade: str,
) -> dict | None:
    """Gera certidão de decurso de prazo de recurso no processo SEI."""
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        logger.warning("Item %s sem id_procedimento — não gerar certidão de decurso de recurso", item.id)
        return None

    html = _template_certidao_decurso_recurso(item, data_vencimento)

    try:
        resultado = sei.incluir_documento(
            id_procedimento=id_procedimento,
            id_unidade=id_unidade,
            id_serie=ID_SERIE_CERTIDAO,
            html=html,
            nome_arvore="Certidão de decurso de prazo - recurso",
            nivel_acesso="1",
        )
        logger.info(
            "Certidão de decurso de recurso gerada para processo %s: %s",
            item.numero_processo_sei or item.numero_sei,
            resultado.get("documentoFormatado"),
        )
        return resultado
    except SeiApiError as e:
        logger.error("Falha ao gerar certidão de decurso de recurso: %s", e)
        return None


# ==============================================================================
# Termo de encerramento
# ==============================================================================

def _template_termo_encerramento(item: m.CaixaEntrada) -> str:
    """Template placeholder do termo de encerramento do processo."""
    razao = item.razao_social or "INTERESSADO"
    cnpj = item.cnpj_cpf or ""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""

    return f"""<p class="Texto_Centralizado"><strong>TERMO DE ENCERRAMENTO</strong></p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Tendo sido cumpridas todas as etapas do Processo Administrativo Sancionatório 
nº <strong>{numero_processo}</strong>, instaurado em face de <strong>{razao.upper()}</strong>{f', CNPJ/CPF {cnpj}' if cnpj else ''}, 
com a devida observância dos princípios do contraditório e da ampla defesa, 
encerra-se o presente processo administrativo.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Nada mais havendo a tratar, determina-se o arquivamento dos autos.
</p>
"""


def gerar_termo_encerramento(
    sei: SeiClient,
    item: m.CaixaEntrada,
    id_unidade: str,
) -> dict | None:
    """Gera o termo de encerramento no processo SEI."""
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        logger.warning("Item %s sem id_procedimento — não gerar termo de encerramento", item.id)
        return None

    html = _template_termo_encerramento(item)

    try:
        resultado = sei.incluir_documento(
            id_procedimento=id_procedimento,
            id_unidade=id_unidade,
            id_serie=series.TERMO_ENCERRAMENTO,
            html=html,
            nome_arvore="Termo de encerramento",
            nivel_acesso="1",
        )
        logger.info(
            "Termo de encerramento gerado para processo %s: %s",
            item.numero_processo_sei or item.numero_sei,
            resultado.get("documentoFormatado"),
        )
        return resultado
    except SeiApiError as e:
        logger.error("Falha ao gerar termo de encerramento: %s", e)
        return None


# ==============================================================================
# Fase de Julgamento — templates e geração
# ==============================================================================

ID_SERIE_DECISAO = series.DECISAO
# A portaria sai como Decisão: o catálogo do SEI só tem "Portaria Conjunta" e
# "Portaria de Pessoal", nenhuma adequada à portaria de penalidade. Pendente de
# definição da área.
ID_SERIE_PORTARIA = series.PORTARIA


def _template_certificacao_regularidade(item: m.CaixaEntrada) -> str:
    """Template placeholder da certificação de regularidade processual."""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""
    razao = item.razao_social or "INTERESSADO"

    return f"""<p class="Texto_Centralizado"><strong>CERTIDÃO DE REGULARIDADE PROCESSUAL</strong></p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Certifico, para os devidos fins, que foram observadas todas as formalidades legais no trâmite do 
Processo Administrativo Sancionatório nº <strong>{numero_processo}</strong>, instaurado em face de 
<strong>{razao.upper()}</strong>, estando os autos em condições de serem submetidos a julgamento, 
nos termos do artigo 64 da Lei Estadual nº 10.177/1998.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Foram assegurados o contraditório e a ampla defesa ao interessado, conforme documentação constante dos autos.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Dou fé.
</p>
"""


def _template_parecer_merito(item: m.CaixaEntrada) -> str:
    """Template placeholder do parecer de mérito."""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""
    razao = item.razao_social or "INTERESSADO"
    cnpj = item.cnpj_cpf or ""

    return f"""<p class="Texto_Centralizado"><strong>PARECER DE MÉRITO</strong></p>

<p class="Texto_Centralizado">
Processo Administrativo Sancionatório nº <strong>{numero_processo}</strong>
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
<strong>I — DOS FATOS</strong>
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Trata-se de Processo Administrativo Sancionatório instaurado em face de 
<strong>{razao.upper()}</strong>{f', CNPJ/CPF {cnpj}' if cnpj else ''}, 
em razão de [DESCREVER O FATO GERADOR — preencher manualmente].
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
<strong>II — DA INSTRUÇÃO</strong>
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
[RESUMO DA INSTRUÇÃO — defesa apresentada/não apresentada, alegações, provas — preencher manualmente]
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
<strong>III — DO MÉRITO</strong>
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
[ANÁLISE DE MÉRITO — preencher manualmente]
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
<strong>IV — DA CONCLUSÃO</strong>
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Ante o exposto, opino pela [APLICAÇÃO DE PENALIDADE / ARQUIVAMENTO — preencher manualmente].
</p>
"""


def _template_decisao(item: m.CaixaEntrada, penalidade: str = "") -> str:
    """Template placeholder da Decisão I (aplicação de penalidade)."""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""
    razao = item.razao_social or "INTERESSADO"
    cnpj = item.cnpj_cpf or ""

    return f"""<p class="Texto_Centralizado"><strong>DECISÃO</strong></p>

<p class="Texto_Centralizado">
Processo Administrativo Sancionatório nº <strong>{numero_processo}</strong>
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Vistos e analisados os autos do Processo Administrativo Sancionatório instaurado em face de 
<strong>{razao.upper()}</strong>{f', CNPJ/CPF {cnpj}' if cnpj else ''};
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Considerando o relatório de fiscalização e os demais elementos de prova constantes dos autos;
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Considerando o parecer de mérito favorável à aplicação de penalidade;
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
<strong>DECIDO</strong> aplicar ao interessado a penalidade de <strong>{penalidade or '[TIPO DE PENALIDADE — preencher]'}</strong>, 
nos termos do artigo 64 da Lei Estadual nº 10.177/1998.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Fica o interessado notificado de que poderá interpor recurso no prazo de 15 (quinze) dias corridos, 
contados da publicação desta decisão no Diário Oficial do Estado de São Paulo.
</p>
"""


def _template_portaria(item: m.CaixaEntrada, penalidade: str = "") -> str:
    """Template placeholder da Portaria (para publicação no DOE)."""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""
    razao = item.razao_social or "INTERESSADO"
    cnpj = item.cnpj_cpf or ""

    return f"""<p class="Texto_Centralizado"><strong>PORTARIA</strong></p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
O Diretor de Gestão de Regulados do Departamento Estadual de Trânsito de São Paulo — DETRAN-SP, 
no uso de suas atribuições legais,
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Considerando a decisão proferida nos autos do Processo Administrativo Sancionatório 
nº <strong>{numero_processo}</strong>,
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
<strong>RESOLVE:</strong>
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Artigo 1º — Aplicar ao(à) <strong>{razao.upper()}</strong>{f', CNPJ/CPF {cnpj}' if cnpj else ''}, 
a penalidade de <strong>{penalidade or '[TIPO DE PENALIDADE — preencher]'}</strong>.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Artigo 2º — Esta portaria entra em vigor na data de sua publicação.
</p>
"""


def _template_despacho_arquivamento(item: m.CaixaEntrada) -> str:
    """Template placeholder do despacho de arquivamento (encerramento)."""
    numero_processo = item.numero_processo_sei or item.numero_sei or ""
    razao = item.razao_social or "INTERESSADO"

    return f"""<p class="Texto_Centralizado"><strong>DESPACHO DE ARQUIVAMENTO</strong></p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Tendo sido cumpridas todas as etapas do Processo Administrativo Sancionatório 
nº <strong>{numero_processo}</strong>, instaurado em face de <strong>{razao.upper()}</strong>, 
e tendo transitado em julgado a decisão administrativa, determino o <strong>ARQUIVAMENTO</strong> 
dos presentes autos.
</p>

<p class="Texto_Justificado_Recuo_Primeira_Linha">
Providencie-se a comunicação aos órgãos competentes, se aplicável, e o encerramento do processo.
</p>
"""


# Funções de geração no SEI

def gerar_certificacao_regularidade(sei: SeiClient, item: m.CaixaEntrada, id_unidade: str) -> dict | None:
    """Gera certidão de regularidade processual no SEI (antes do julgamento)."""
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        return None
    html = _template_certificacao_regularidade(item)
    try:
        return sei.incluir_documento(id_procedimento, id_unidade, ID_SERIE_CERTIDAO, html,
                                     nome_arvore="Certidão de regularidade processual", nivel_acesso="1")
    except SeiApiError as e:
        logger.error("Falha ao gerar certificação de regularidade: %s", e)
        return None


def gerar_parecer_merito(sei: SeiClient, item: m.CaixaEntrada, id_unidade: str) -> dict | None:
    """Gera parecer de mérito no SEI."""
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        return None
    html = _template_parecer_merito(item)
    try:
        return sei.incluir_documento(id_procedimento, id_unidade, ID_SERIE_DECISAO, html,
                                     nome_arvore="Parecer de mérito", nivel_acesso="1")
    except SeiApiError as e:
        logger.error("Falha ao gerar parecer de mérito: %s", e)
        return None


def gerar_decisao(sei: SeiClient, item: m.CaixaEntrada, id_unidade: str, penalidade: str = "") -> dict | None:
    """Gera a Decisão I no SEI."""
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        return None
    html = _template_decisao(item, penalidade)
    try:
        return sei.incluir_documento(id_procedimento, id_unidade, ID_SERIE_DECISAO, html,
                                     nome_arvore="Decisão", nivel_acesso="1")
    except SeiApiError as e:
        logger.error("Falha ao gerar decisão: %s", e)
        return None


def gerar_portaria(sei: SeiClient, item: m.CaixaEntrada, id_unidade: str, penalidade: str = "") -> dict | None:
    """Gera a Portaria (publicação DOE) no SEI."""
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        return None
    html = _template_portaria(item, penalidade)
    try:
        return sei.incluir_documento(id_procedimento, id_unidade, ID_SERIE_PORTARIA, html,
                                     nome_arvore="Portaria", nivel_acesso="0")  # público para publicação
    except SeiApiError as e:
        logger.error("Falha ao gerar portaria: %s", e)
        return None


def gerar_despacho_arquivamento(sei: SeiClient, item: m.CaixaEntrada, id_unidade: str) -> dict | None:
    """Gera despacho de arquivamento no SEI."""
    id_procedimento = item.id_procedimento_processo or item.id_procedimento
    if not id_procedimento:
        return None
    html = _template_despacho_arquivamento(item)
    try:
        return sei.incluir_documento(id_procedimento, id_unidade, ID_SERIE_CERTIDAO, html,
                                     nome_arvore="Despacho de arquivamento", nivel_acesso="1")
    except SeiApiError as e:
        logger.error("Falha ao gerar despacho de arquivamento: %s", e)
        return None
