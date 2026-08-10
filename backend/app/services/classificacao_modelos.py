"""Classificação dos modelos de documento vindos do SEI.

Os modelos são baixados do processo de textos-padrão (ver
``scripts/baixar_textos_padroes_sei.py``) e chegam com o nome que a área deu na
árvore do SEI, por exemplo:

    DETRAN - Despacho 82 AUTOESCOLA - SANEADOR - COM DEFESA
    DETRAN - Despacho 47 PERITOS - Relatório - Arqui - Sem irregular
    DETRAN - Certidão - JUNTADA DE DOCUMENTOS - DESPACHANTE

Deste nome saem três informações:

- **função**: o papel do documento no fluxo (``saneador``,
  ``arquivamento_relatorio``, ``decisao_primeira_instancia``...). É por ela que
  o app encontra os modelos de um passo da fase.
- **agente**: a classe do agente regulado, quando o nome traz. "ECV-EPIV"
  atende duas classes e por isso rende dois registros.
- **rótulo**: o que diferencia um modelo dos outros da mesma função, mostrado ao
  analista na hora de escolher ("COM DEFESA", "Sem irregular").

**Por que não uma chave fixa por documento:** o fluxo tinha um modelo por passo
quando os textos eram coletados à mão. Os modelos oficiais têm variantes — são
quatro saneadores de autoescola e nove arquivamentos de relatório de perito.
Classificar por função permite que o passo ofereça todas as variantes daquele
agente, e que modelos novos entrem sem alterar código.
"""
from __future__ import annotations

import re
import unicodedata

from app.services import agentes_regulados as agentes

# Separador entre função e rótulo em ``config_template_despacho.descricao_doc``.
# Guardar os dois no mesmo campo evita alterar o esquema da tabela.
SEPARADOR = "|"


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    ).lower()


# Agente a partir do nome do modelo. "ECV-EPIV" vale para as duas classes.
# Avaliado em ordem: "ECV-EPIV" precisa vir antes de "ECV" e de "EPIV".
AGENTES_NO_NOME: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ecv-epiv", (agentes.ECV, agentes.ESTAMPADORA)),
    ("ecv epiv", (agentes.ECV, agentes.ESTAMPADORA)),
    ("peritos", (agentes.PERITO,)),
    ("autoescola", (agentes.AUTOESCOLA,)),
    ("despachante", (agentes.DESPACHANTE,)),
    ("desmontes", (agentes.DESMONTE,)),
    ("desmonte", (agentes.DESMONTE,)),
    ("epiv", (agentes.ESTAMPADORA,)),
    ("ecv", (agentes.ECV,)),
    # "AUTO" isolado aparece em "Despacho 76 AUTO - RELATÓRIO - ARQUI"
    ("auto", (agentes.AUTOESCOLA,)),
)

# Função do documento, por palavra-chave no nome. A ordem importa: o primeiro
# padrão que casar decide, então o mais específico vem primeiro.
#
# Cada item é (padrões, função, título do passo).
FUNCOES: tuple[tuple[tuple[str, ...], str, str], ...] = (
    # --- Instauração ---
    (("termo de instauracao aditamento",), "instauracao_aditamento", "Aditamento do Termo de Instauração"),
    (("termo de instauracao",), "termo_instauracao", "Termo de Instauração"),
    (("mandado citacao", "citacao em processo administrativo sancionatorio por edital"),
     "citacao_edital", "Citação por Edital"),
    (("citacao por edital", "citacao por edital", "edital de citacao", "citacao por edital"),
     "citacao_edital", "Citação por Edital"),
    (("citacao",), "citacao", "Citação"),

    # --- Arquivamento na análise do relatório ---
    # "relatorio - arq" cobre as duas grafias da área: "Relatório - Arqui" e
    # "RELATÓRIO - ARQ.". Sem isso, "ARQ. - SEM IRREGULARIDADE" caía na regra de
    # certidão de regularidade, por conter "regularidade".
    (("arquivamento de relatorio", "relatorio - arq"),
     "arquivamento_relatorio", "Arquivamento do Relatório"),

    # --- Saneamento e cautelar ---
    (("saneador",), "saneador", "Despacho Saneador"),
    (("manutencao de cautelar", "manutencao cautelar", "manutencao da cautelar"),
     "cautelar_manutencao", "Manutenção da Medida Cautelar"),
    (("revogacao da cautelar", "revogacao de medida cautelar", "revogacao cautelar"),
     "cautelar_revogacao", "Revogação da Medida Cautelar"),

    # --- Instrução: intimação para alegações finais ---
    (("intimacao alegacoes finais - edital", "intimacao edital - alegacoes finais",
      "edital de intimacao alegacoes finais", "intimacao por edital"),
     "intimacao_alegacoes_edital", "Intimação para Alegações Finais por Edital"),
    (("alegacoes finais", "intimacao para alegacoes finais"),
     "intimacao_alegacoes", "Intimação para Alegações Finais"),
    (("retorno dos autos",), "retorno_autos", "Retorno dos Autos"),

    # --- Opinativo e parecer ---
    (("relatorio opinativo", "relatorio - relatorio opinativo"),
     "relatorio_opinativo", "Relatório Opinativo"),
    (("julgamento antecipado",), "relatorio_opinativo", "Relatório Opinativo"),
    # "Parecer de mérito" vem antes de "parecer opinativo": a área nomeou alguns
    # modelos como "Parecer de mérito (Parecer Opinativo)", e o documento é o
    # parecer de mérito — tem série própria no SEI (2412).
    (("parecer de merito",), "parecer_merito", "Parecer de Mérito"),
    (("parecer opinativo", "despacho opinativo", "opinativo"),
     "despacho_opinativo", "Despacho Opinativo"),

    # --- Encaminhamentos ---
    (("encaminhamento pge", "encaminhamento recurso pge", "sefaz",
      "enquadramento parecer referencial"),
     "encaminhamento_externo", "Encaminhamento Externo"),
    (("sei externo",), "sei_externo", "Comunicação por SEI Externo"),

    # --- Decisão ---
    # A notificação de ciência vem antes: ela cita a decisão no nome, mas o
    # documento é a notificação enviada ao interessado.
    (("ciencia da decisao",), "notificacao_decisao", "Notificação de Ciência da Decisão"),
    (("decisao ii", "decisao 2 ", "decisao - ii"), "decisao_recurso", "Decisão em Recurso"),
    (("decisao i", "decisao - i"), "decisao", "Decisão"),
    (("reconsideracao",), "decisao_recurso", "Decisão em Recurso"),
    (("decisao",), "decisao", "Decisão"),
    (("minuta de portaria", "portaria"), "portaria", "Minuta de Portaria"),

    # --- Recurso e notificações ---
    (("apresentacao de recurso", "notificacao recursal", "para recurso", "- recurso",
      "despacho sobre recurso"),
     "notificacao_recurso", "Notificação para Recurso"),
    (("pagamento - dare", "notificacao edital dare", "guia pagamento dare",
      "acusa pagamento"),
     "cobranca", "Cobrança (DARE)"),
    (("notificacao (intimacao", "intimacao",), "intimacao", "Intimação"),

    # --- Certidões ---
    (("decurso",), "certidao_decurso", "Certidão de Decurso de Prazo"),
    (("juntada",), "certidao_juntada", "Certidão de Juntada de Documentos"),
    (("liberacao de acesso",), "certidao_acesso", "Certidão de Liberação de Acesso"),
    (("regularidade",), "certidao_regularidade", "Certidão de Regularidade Processual"),
    (("bloqueio", "desbloqueio", "bloq e desb"), "certidao_bloqueio", "Certidão de Bloqueio"),
    (("atos processuais", "certidao de atos"), "certidao_atos", "Certidão de Atos Processuais"),
    (("certidao",), "certidao", "Certidão"),

    # --- Encerramento ---
    (("termo de encerramento",), "termo_encerramento", "Termo de Encerramento"),
    (("arquivamento - pa", "arquivamento pa", "arquivamento antes do termo",
      "arquivamento fechado", "arquivamento materialidade",
      "arquiv por falta de elementos", "arquiv inconsistencia"),
     "arquivamento_processo", "Arquivamento do Processo"),
    (("termo de ajustamento de conduta", "proposicao de tac"), "tac", "Termo de Ajustamento de Conduta"),

    # --- Outros ---
    (("oficio",), "oficio", "Ofício"),
)

# Título legível de cada função, para a tela.
TITULOS: dict[str, str] = {}
for _padroes, _funcao, _titulo in FUNCOES:
    TITULOS.setdefault(_funcao, _titulo)


def detectar_agentes(nome: str) -> tuple[str, ...]:
    """Classes de agente que o modelo atende. Vazio = serve para qualquer um."""
    texto = _sem_acento(nome)
    for marca, classes in AGENTES_NO_NOME:
        if marca in texto:
            return classes
    return ()


def detectar_funcao(nome: str) -> str | None:
    """Função do documento no fluxo, ou None se o nome não for reconhecido."""
    texto = _sem_acento(nome)
    for padroes, funcao, _titulo in FUNCOES:
        if any(p in texto for p in padroes):
            return funcao
    return None


def montar_rotulo(nome: str, agentes_detectados: tuple[str, ...]) -> str:
    """Texto que diferencia este modelo dos outros da mesma função.

    Remove o prefixo "DETRAN - " e o nome do agente, e mantém o tipo e o número
    do documento. O número é essencial: cinco arquivamentos de relatório de
    despachante têm exatamente o mesmo nome na árvore do SEI ("ARQUIVAMENTO DE
    RELATÓRIO"), e só os despachos 148 a 152 os distinguem. Além disso, a área
    se refere aos modelos pelo número.
    """
    limpo = re.sub(r"^\s*DETRAN\s*-\s*", "", nome).strip()

    # Nome do agente, em qualquer posição (as duas grafias: com e sem acento)
    for marca, _classes in AGENTES_NO_NOME:
        limpo = re.sub(rf"\b{re.escape(marca)}\b", "", limpo, flags=re.IGNORECASE)
    limpo = re.sub(
        r"\bECV\s*-\s*EPIV\b|\bECV\b|\bEPIV\b|\bPERITOS\b|\bAUTOESCOLA\b|\bAUTO\b"
        r"|\bDESPACHANTE\b|\bDESMONTES?\b",
        "", limpo, flags=re.IGNORECASE,
    )

    # Normaliza os separadores que sobraram e as sobras de pontuação
    limpo = re.sub(r"\s*[-–]\s*", " - ", limpo)
    limpo = re.sub(r"\s+", " ", limpo)
    limpo = re.sub(r"(\s*-\s*)+", " - ", limpo).strip(" -–")

    if not limpo:
        return re.sub(r"^\s*DETRAN\s*-\s*", "", nome).strip()
    return limpo


def classificar(nome: str) -> tuple[str, tuple[str, ...], str] | None:
    """``(funcao, agentes, rotulo)`` do modelo, ou None se não reconhecido."""
    funcao = detectar_funcao(nome)
    if not funcao:
        return None
    classes = detectar_agentes(nome)
    return funcao, classes, montar_rotulo(nome, classes)


def chave(funcao: str, rotulo: str) -> str:
    """Valor gravado em ``descricao_doc``: função e rótulo no mesmo campo."""
    return f"{funcao}{SEPARADOR}{rotulo}"


def partes_da_chave(descricao_doc: str) -> tuple[str, str]:
    """Inverso de ``chave``: devolve ``(funcao, rotulo)``."""
    funcao, _, rotulo = descricao_doc.partition(SEPARADOR)
    return funcao, rotulo


def titulo_da_funcao(funcao: str) -> str:
    return TITULOS.get(funcao, funcao.replace("_", " ").capitalize())
