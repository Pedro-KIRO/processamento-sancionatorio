"""Catálogo dos documentos de cada fase do processo sancionatório.

Este módulo diz, para cada fase: quais documentos ela produz, em que ordem,
quem assina cada um, que prazo abre e quando o processo avança de fase.

Os modelos vêm da tabela ``config_template_despacho``, alimentada por
``scripts/importar_textos_padroes.py`` a partir de ``textos_padroes/``. A busca
é por (chave do documento, agente regulado), com queda para ``Qualquer`` quando
não existe versão específica — o saneador e o termo de instauração têm uma
versão por agente; os demais são gerais.

**Por que passos e não uma fase por documento:** julgamento produz três
documentos em sequência (encaminhamento à Consultoria Jurídica, relatório
opinativo e decisão), com assinantes diferentes. Criar uma fase para cada um
mudaria a sequência oficial de fases, que é fixa e acordada com a área. Então a
fase permanece a mesma e o app controla em que passo dela o processo está,
olhando os documentos já gerados.

Sequência implementada, conforme definido pela área:

1. **instauração** → termo de instauração + citação, prazo de defesa prévia
2. **aguardando_defesa** → nada a fazer; a automação de prazos observa
3. **defesa_apresentada** (defesa juntada ou prazo vencido) → despacho saneador
4. **instrução** → intimação para alegações finais, prazo de 7 dias
5. **aguardando_alegacoes** → nada a fazer; vencendo sem resposta, entra a
   certidão de decurso de prazo
6. **julgamento** → encaminhamento à CJ, relatório opinativo unificado (chefe de
   serviço e chefe de divisão) e decisão (coordenador)
7. **recurso** → notificação para apresentação de recurso
8. **encerramento** → termo de encerramento + despacho de encerramento
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import models as m
from app.services import series_sei as series
from app.services.textos_padroes import preencher_variaveis

# Série do SEI por função do documento (ver app/services/series_sei.py). Não
# existe série própria de "relatório opinativo" nem de "despacho saneador": o
# opinativo entra como Relatório e o saneador como Despacho, que é o que são.
SERIE_POR_FUNCAO: dict[str, str] = {
    "termo_instauracao": series.TERMO_INSTAURACAO,
    "instauracao_aditamento": series.TERMO_INSTAURACAO,
    "citacao": series.CITACAO,
    "citacao_edital": series.EDITAL,
    "arquivamento_relatorio": series.DESPACHO,
    "saneador": series.DESPACHO,
    "cautelar_manutencao": series.DESPACHO,
    "cautelar_revogacao": series.DESPACHO,
    "intimacao": series.INTIMACAO,
    "intimacao_alegacoes": series.INTIMACAO,
    "intimacao_alegacoes_edital": series.EDITAL,
    "retorno_autos": series.DESPACHO,
    "relatorio_opinativo": series.RELATORIO,
    "despacho_opinativo": series.DESPACHO,
    "parecer_merito": series.PARECER_MERITO,
    "encaminhamento_externo": series.DESPACHO,
    "sei_externo": series.DESPACHO,
    "decisao": series.DECISAO,
    "decisao_recurso": series.DECISAO,
    "portaria": series.PORTARIA,
    "notificacao_recurso": series.NOTIFICACAO,
    "notificacao_decisao": series.NOTIFICACAO,
    "cobranca": series.NOTIFICACAO,
    "certidao": series.CERTIDAO,
    "certidao_decurso": series.CERTIDAO,
    "certidao_juntada": series.CERTIDAO,
    "certidao_acesso": series.CERTIDAO,
    "certidao_regularidade": series.CERTIDAO,
    "certidao_bloqueio": series.CERTIDAO,
    "certidao_atos": series.CERTIDAO,
    "termo_encerramento": series.TERMO_ENCERRAMENTO,
    "arquivamento_processo": series.DESPACHO,
    "tac": series.TERMO_AJUSTAMENTO_CONDUTA,
    "oficio": series.DESPACHO,
    # Anexo: PDF enviado pelo usuário, não gerado de modelo
    "manifestacao_cj": series.ANEXO,
}

CARGO_CHEFE_DIVISAO = "Chefe de Divisão"
CARGO_CHEFE_SERVICO = "Chefe de Serviço"
CARGO_COORDENADOR = "Coordenador"


@dataclass(frozen=True)
class PassoFase:
    """Um documento a produzir dentro de uma fase.

    ``funcao`` é o papel do documento no fluxo. As variantes disponíveis saem do
    banco, por (função, agente) — quatro saneadores de autoescola, nove
    arquivamentos de relatório de perito. A tela oferece a lista e o analista
    escolhe; ver ``app/services/classificacao_modelos.py``.
    """

    #: Função do documento (``saneador``, ``intimacao_alegacoes``...). A busca
    #: no banco é por prefixo ``<funcao>|``.
    funcao: str
    #: Título mostrado ao usuário
    titulo: str
    #: Nome do documento na árvore do processo, no SEI
    nome_arvore: str
    #: Cargos em cujos blocos de assinatura o documento entra, na ordem
    cargos_assinatura: tuple[str, ...] = (CARGO_CHEFE_DIVISAO,)
    #: Prazo aberto no SEI junto com o documento, em dias
    dias_prazo: Optional[int] = None
    #: "documento" (gerado a partir do modelo) ou "anexo" (PDF enviado pelo
    #: usuário e incluído como documento externo)
    tipo: str = "documento"
    #: Explicação curta do passo, mostrada na tela
    descricao: str = ""

    @property
    def chave_documento(self) -> str:
        """Identificador do passo dentro da fase. É a própria função."""
        return self.funcao

    def id_serie(self, modelo: str | None = None) -> str:
        """Série do SEI do documento.

        A série é definida pela função, não pela variante: as nove versões do
        arquivamento de relatório são todas despacho.
        """
        return SERIE_POR_FUNCAO.get(self.funcao, series.DESPACHO)

    def opcoes(self, db: Session | None = None, agente: str | None = None) -> list[dict]:
        """Variantes disponíveis, com nome legível, para a tela oferecer.

        A que o coordenador marcou como padrão vem primeiro e com
        ``padrao=True``, para a tela já deixá-la selecionada.
        """
        if db is None:
            return []

        from app.services import classificacao_modelos as cm

        opcoes = []
        for registro in listar_modelos(db, self.funcao, agente):
            _funcao, rotulo = cm.partes_da_chave(registro.descricao_doc)
            opcoes.append({
                "chave": registro.descricao_doc,
                "nome": rotulo or registro.descricao_doc,
                "padrao": bool(registro.padrao),
            })
        return opcoes

    def aceita(self, modelo: str | None, db: Session | None = None, agente: str | None = None) -> bool:
        """Diz se o modelo escolhido é uma das variantes deste passo."""
        if modelo is None:
            return True
        if not modelo.startswith(f"{self.funcao}|"):
            return False
        if db is None:
            return True
        return any(o["chave"] == modelo for o in self.opcoes(db, agente))


@dataclass(frozen=True)
class FaseDocumental:
    """Os passos de uma fase e para onde ela avança quando terminam."""

    passos: tuple[PassoFase, ...]
    avanca_para: Optional[str] = None


# Fases em que o app não age: o processo espera o interessado. A automação
# automacoes/verificar_prazos.py é quem observa e move.
FASES_DE_ESPERA = {
    "aguardando_defesa": (
        "O prazo de defesa prévia corre da disponibilização do acesso externo e "
        "reinicia por mais 15 dias se o interessado visualizar. Juntada a defesa, "
        "a fase avança sozinha. Vencido sem visualização, o app libera o edital de "
        "citação; vencido depois de visualizado, entra a certidão de decurso."
    ),
    "aguardando_alegacoes": (
        "O prazo de 7 dias para alegações finais está correndo. Se vencer sem "
        "resposta, o app inclui a certidão de decurso de prazo."
    ),
}


FASES_DOCUMENTAIS: dict[str, FaseDocumental] = {
    # A defesa chegou (ou o prazo venceu): o saneador organiza o processo antes
    # da instrução. Há uma versão do modelo por agente regulado.
    "defesa_apresentada": FaseDocumental(
        passos=(
            PassoFase(
                funcao="saneador",
                titulo="Despacho Saneador",
                nome_arvore="Despacho saneador",
                cargos_assinatura=(CARGO_CHEFE_DIVISAO,),
                descricao=(
                    "Saneia o processo após a defesa prévia (ou o decurso do prazo) "
                    "e abre a instrução. Há versões conforme houve ou não defesa e "
                    "conforme a medida cautelar seja mantida ou revogada."
                ),
            ),
        ),
        avanca_para="instrucao",
    ),
    "instrucao": FaseDocumental(
        passos=(
            PassoFase(
                funcao="intimacao_alegacoes",
                titulo="Intimação para Alegações Finais",
                nome_arvore="Intimação",
                cargos_assinatura=(CARGO_CHEFE_DIVISAO,),
                dias_prazo=7,
                descricao=(
                    "Intima o interessado a apresentar alegações finais em 7 dias. "
                    "O prazo é aberto no SEI junto com o documento."
                ),
            ),
        ),
        avanca_para="aguardando_alegacoes",
    ),
    "julgamento": FaseDocumental(
        passos=(
            PassoFase(
                funcao="manifestacao_cj",
                titulo="Manifestação da Consultoria Jurídica",
                nome_arvore="Manifestação da Consultoria Jurídica",
                tipo="anexo",
                cargos_assinatura=(),
                descricao=(
                    "Anexe o PDF da manifestação recebida da Consultoria Jurídica. "
                    "Ele entra no processo como documento externo."
                ),
            ),
            PassoFase(
                funcao="relatorio_opinativo",
                titulo="Relatório Opinativo",
                nome_arvore="Relatório opinativo",
                cargos_assinatura=(CARGO_CHEFE_SERVICO, CARGO_CHEFE_DIVISAO),
                descricao=(
                    "Consolida a instrução, para assinatura do chefe de serviço e do "
                    "chefe de divisão. Escolha a versão conforme o caso (baixa "
                    "cadastral, julgamento antecipado, estrutural...)."
                ),
            ),
            PassoFase(
                funcao="decisao",
                titulo="Decisão",
                nome_arvore="Decisão",
                cargos_assinatura=(CARGO_COORDENADOR,),
                descricao=(
                    "Decide o processo. Assinatura do coordenador. As versões "
                    "correspondem ao resultado (arquivamento, advertência, suspensão, "
                    "cassação)."
                ),
            ),
        ),
        avanca_para="recurso",
    ),
    "recurso": FaseDocumental(
        passos=(
            PassoFase(
                funcao="notificacao_recurso",
                titulo="Notificação para Apresentação de Recurso",
                nome_arvore="Notificação",
                cargos_assinatura=(CARGO_CHEFE_DIVISAO,),
                dias_prazo=15,
                descricao="Notifica o interessado da decisão e abre o prazo de recurso.",
            ),
        ),
        # Não avança: espera o prazo de recurso correr.
        avanca_para=None,
    ),
    "encerramento": FaseDocumental(
        passos=(
            PassoFase(
                funcao="termo_encerramento",
                titulo="Termo de Encerramento",
                nome_arvore="Termo de encerramento",
                cargos_assinatura=(CARGO_CHEFE_SERVICO,),
                descricao="Atesta que todas as providências do processo foram tomadas.",
            ),
            PassoFase(
                funcao="arquivamento_processo",
                titulo="Arquivamento do Processo",
                nome_arvore="Despacho",
                cargos_assinatura=(CARGO_COORDENADOR,),
                descricao="Determina o arquivamento do processo administrativo.",
            ),
        ),
        avanca_para="encerrado",
    ),
}


# Documentos do arquivamento de relatório (quando a triagem decide não
# instaurar). Não são fase do processo sancionatório: acontecem no próprio
# processo de fiscalização.
ARQUIVAMENTO_RELATORIO = (
    PassoFase(
        funcao="arquivamento_relatorio",
        titulo="Despacho de Arquivamento do Relatório",
        nome_arvore="Despacho",
        cargos_assinatura=(CARGO_CHEFE_DIVISAO,),
        descricao="Encerra a análise do relatório de fiscalização.",
    ),
    PassoFase(
        funcao="termo_encerramento",
        titulo="Termo de Encerramento",
        nome_arvore="Termo de encerramento",
        cargos_assinatura=(CARGO_CHEFE_DIVISAO,),
        descricao="Atesta o encerramento do relatório de fiscalização.",
    ),
)


def listar_modelos(
    db: Session, funcao: str, agente_regulado: str | None,
) -> list[m.ConfigTemplateDespacho]:
    """Modelos de uma função para o agente, ou os genéricos (``Qualquer``).

    Os modelos oficiais são gravados como ``<função>|<rótulo>`` e há mais de uma
    variante por função — quatro saneadores de autoescola, nove arquivamentos de
    relatório de perito. É esta lista que a tela oferece ao analista.

    **O modelo marcado como padrão vem primeiro.** É por aqui que a escolha do
    coordenador na tela "Textos-padrão" passa a valer no app inteiro: quem
    precisa de um modelo só (``_primeiro_modelo`` em ``despachos_sei``) pega o
    primeiro da lista, e a tela usa a mesma ordem para pré-selecionar.
    """
    from app.services import classificacao_modelos as cm

    prefixo = f"{funcao}{cm.SEPARADOR}%"
    # coalesce em vez de nullslast: o SQL Server não aceita NULLS LAST, e ali
    # NULL ordenaria na frente no DESC, jogando modelo sem marca para o topo.
    primeiro_o_padrao = func.coalesce(m.ConfigTemplateDespacho.padrao, False).desc()

    def _do_agente(agente: str) -> list[m.ConfigTemplateDespacho]:
        return (
            db.query(m.ConfigTemplateDespacho)
            .filter(
                m.ConfigTemplateDespacho.agente_regulado == agente,
                m.ConfigTemplateDespacho.descricao_doc.like(prefixo),
            )
            .order_by(primeiro_o_padrao, m.ConfigTemplateDespacho.descricao_doc)
            .all()
        )

    if agente_regulado:
        achados = _do_agente(agente_regulado)
        if achados:
            return achados
    return _do_agente("Qualquer")


def buscar_template(
    db: Session, chave_documento: str, agente_regulado: str | None,
) -> m.ConfigTemplateDespacho | None:
    """Modelo do documento para o agente, ou o geral (``Qualquer``).

    O agente vem da caixa de entrada já no vocabulário do CPSAR (``ECV``,
    ``Autoescola``...), o mesmo usado na importação dos textos-padrão.
    """
    consulta = db.query(m.ConfigTemplateDespacho)
    if agente_regulado:
        achado = consulta.filter_by(
            agente_regulado=agente_regulado, descricao_doc=chave_documento,
        ).first()
        if achado:
            return achado
    return consulta.filter_by(
        agente_regulado="Qualquer", descricao_doc=chave_documento,
    ).first()


def montar_html(
    db: Session, chave_documento: str, item: m.CaixaEntrada, dias_prazo: int | None = None,
) -> str | None:
    """HTML do documento com as variáveis do processo preenchidas, ou None."""
    template = buscar_template(db, chave_documento, item.agente_regulado)
    if not template:
        return None
    return preencher_variaveis(
        template.template_html,
        numero_processo=item.numero_processo_sei or item.numero_sei,
        razao_social=item.razao_social,
        cnpj_cpf=item.cnpj_cpf,
        dias_prazo=dias_prazo,
    )


def passo_pendente(
    fase: str, chaves_geradas: set[str],
) -> tuple[PassoFase | None, bool, int, int]:
    """Próximo passo da fase, dado o que já foi gerado.

    Devolve ``(passo, e_o_ultimo, indice, total)``. ``passo`` é None quando
    todos os documentos da fase já foram produzidos — nesse caso, a fase pode
    avançar.
    """
    config = FASES_DOCUMENTAIS.get(fase)
    if not config:
        return None, False, 0, 0

    total = len(config.passos)
    for i, passo in enumerate(config.passos):
        # Qualquer variante daquela função cumpre o passo: quem escolheu o
        # "Despacho 135 - BAIXA CADASTRAL" não precisa gerar os outros oito.
        if not any(
            chave == passo.funcao or chave.startswith(f"{passo.funcao}|")
            for chave in chaves_geradas
        ):
            return passo, i == total - 1, i, total
    return None, False, total, total


def avanco_da_fase(fase: str) -> str | None:
    config = FASES_DOCUMENTAIS.get(fase)
    return config.avanca_para if config else None
