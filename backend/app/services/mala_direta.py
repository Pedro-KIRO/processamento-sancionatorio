"""Mala direta dos documentos: encontra os marcadores do modelo e os preenche.

Os textos-padrão da área trazem lacunas escritas entre colchetes — ``[NOME DA
EMPRESA]``, ``[inserir número da Ordem de Serviço]``, ``[bloqueio/desbloqueio]``.
Hoje elas chegam cruas no editor e o analista precisa caçar cada uma no meio do
texto. Este módulo inventaria essas lacunas para a tela poder pedir os valores
**antes** de abrir o documento, já sugerindo o que existe no cadastro.

Levantamento que orientou a classificação (185 arquivos em ``textos_padroes/``,
918 ocorrências, 324 distintas):

- ``[NOME DA EMPRESA]`` (34x), ``[NOME DA PESSOA FÍSICA]`` (23x),
  ``[NOME COMPLETO]`` (18x), ``[NUMERO DO CPF]`` (13x), ``[link sei]`` (14x) —
  saem do cadastro, não faz sentido perguntar.
- ``[bloqueio/desbloqueio]``, ``[tempestiva /intempestiva]``,
  ``[remota ou in loco]`` — são escolhas entre opções, não texto livre. Um campo
  de digitação aqui seria um convite a erro de grafia.
- ``[inserir número da Ordem de Serviço]``, ``[indicar a data do bloqueio]`` —
  pedem um valor que só o analista tem.
- ``[SE HOUVER]``, ``[Se a fiscalização não teve acompanhante, excluir este
  parágrafo]`` — **não são lacunas**: são instruções de edição para quem redige.
  Tratá-las como campo faria o formulário pedir um valor que não existe.

Por isso a detecção classifica em vez de devolver tudo como texto livre.

Ponto de atenção de implementação: o HTML vem do SEI com entidades
(``[descri&ccedil;&atilde;o]``) e, às vezes, com tag no meio do marcador
(``[</strong>link Sei<strong>]``). O rótulo mostrado na tela é normalizado, mas
a substituição usa o trecho literal do documento — senão nada casaria.
"""
from __future__ import annotations

import html as _html
import re
import unicodedata
from dataclasses import dataclass, field, replace
from datetime import date

MESES = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

# Tipos de marcador. O frontend escolhe o controle a partir daqui: `escolha`
# vira select, `cadastral` vem preenchido, `instrucao` é só aviso.
TIPO_CADASTRAL = "cadastral"
TIPO_ESCOLHA = "escolha"
TIPO_DATA = "data"
TIPO_TEXTO = "texto"
TIPO_INSTRUCAO = "instrucao"

# Um marcador é qualquer coisa entre colchetes que não contenha outro colchete.
# O limite de tamanho evita casar um trecho gigante quando o modelo tem um
# colchete solto sem fechamento por perto.
PADRAO_MARCADOR = re.compile(r"\[[^\[\]]{1,160}\]")

PADRAO_TAG = re.compile(r"<[^>]+>")

# Separadores de alternativa: "a/b", "a ou b". O "ou" exige espaço em volta para
# não partir palavras que contenham as letras (ex.: "outro").
PADRAO_ALTERNATIVA = re.compile(r"\s*/\s*|\s+ou\s+", re.IGNORECASE)

# Barra que faz parte de uma sigla ("OAB/SP", "DETRAN/SP", "km/h") e não separa
# alternativa. Sem esta ressalva, o parágrafo do procurador — que cita a OAB/SP —
# era lido como duas opções de escolha.
PADRAO_SIGLA_COM_BARRA = re.compile(r"(?<![\w])([A-Za-zÀ-ÿ]{1,5})/([A-Za-zÀ-ÿ]{1,5})(?![\w])")
_MARCA_BARRA = "\u0001"

# Marcadores que são recado para quem redige, não lacuna a preencher. Comparados
# contra a chave (sem acento, minúscula) e sempre no início do marcador.
# "adotar quando..." e "aplicar se..." vêm dos modelos de ECV, que trazem duas
# redações alternativas e instruem qual usar conforme a data da fiscalização.
INICIOS_INSTRUCAO = (
    "se houver",
    "se a ",
    "se o ",
    "se nao",
    "caso ",
    "excluir",
    "incluir se",
    "manter se",
    "opcional",
    "print ",
    "inserir print",
    "adotar ",
    "aplicar se",
    "aplicar quando",
    "nao constituido",
    "e no sistema",
)

# Máscaras de documento pelo tamanho dos grupos: CPF (3-3-3-2) e CNPJ
# (2-3-3-4, com ou sem o dígito verificador separado).
GRUPOS_DOCUMENTO = ([3, 3, 3, 2], [2, 3, 3, 4], [2, 3, 3, 4, 2])

# Pessoas ligadas ao agente, que NÃO são o agente. Sem esta ressalva, 30 lacunas
# de sócio-administrador, vistoriador, responsável e diretor recebiam a razão
# social da empresa — nome errado num documento oficial. A janela curta em volta
# de "nome" evita pegar "Nome da Empresa (e vistoriador, se houver)", em que o
# nome pedido é mesmo o da empresa.
#
# Despachante e perito ficam de fora da lista de propósito: nesses segmentos o
# agente regulado É a pessoa, e a razão social é o nome dela.
_PAPEIS = (
    "vistoriador|socio|administrador|proprietario|procurador|responsavel"
    "|acompanhante|testemunha|diretor|representante|instrutor"
)
PADRAO_NOME_DE_TERCEIRO = re.compile(
    rf"\bnome\b[^,;]{{0,12}}?\b(?:d[oae]s?\s+)?({_PAPEIS})"
    rf"|\b({_PAPEIS})\w*[^,;]{{0,12}}?\bnome\b",
)


@dataclass
class Marcador:
    """Uma lacuna do modelo, pronta para virar campo de formulário."""

    #: Trecho literal como aparece no HTML — é por ele que a substituição casa.
    token: str
    #: Texto legível, sem tag nem entidade, para mostrar na tela.
    rotulo: str
    tipo: str
    #: Chave do campo no formulário. Um mesmo ``token`` pode gerar vários
    #: campos (ver ``indice``), então a identidade não pode ser o token.
    id: str = ""
    #: Quantas vezes o token aparece no documento.
    total: int = 1
    #: Qual ocorrência este campo preenche (1-based). ``None`` = todas elas.
    indice: int | None = None
    #: Alternativas, quando ``tipo == TIPO_ESCOLHA``.
    opcoes: list[str] = field(default_factory=list)
    #: Valor vindo do cadastro, quando houver.
    valor_sugerido: str | None = None
    #: Campo de ``CaixaEntrada`` que originou a sugestão (rastreabilidade).
    campo: str | None = None
    #: Trecho do documento em volta desta ocorrência, com ``___`` no lugar da
    #: lacuna. É o que diz ao analista QUAL lacuna ele está preenchendo.
    contexto: str | None = None
    #: True quando o campo aceita mais de um valor (vários sócios, várias
    #: irregularidades). A quantidade é do caso, não do modelo.
    multivalor: bool = False
    #: Tokens adicionais que apontam para o mesmo dado cadastral (ex.:
    #: ``[Nome da empresa minúsculo]`` e ``[NOME DA EMPRESA]`` são ambos razão
    #: social). A substituição troca todos eles pelo mesmo valor.
    tokens_extras: list[str] = field(default_factory=list)

    @property
    def preenchivel(self) -> bool:
        """Instrução de edição não é campo: fica de fora do formulário."""
        return self.tipo != TIPO_INSTRUCAO


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto)
        if unicodedata.category(c) != "Mn"
    )


def _normalizar(bruto: str) -> str:
    """Rótulo legível a partir do trecho cru: sem colchetes, tag nem entidade."""
    interno = bruto[1:-1] if bruto.startswith("[") and bruto.endswith("]") else bruto
    interno = PADRAO_TAG.sub("", interno)
    interno = _html.unescape(interno)
    return re.sub(r"\s+", " ", interno).strip()


def _chave(rotulo: str) -> str:
    """Forma comparável do rótulo: sem acento, minúsculo, sem indicador ordinal.

    O ordinal precisa cair fora do meio do texto, não só das bordas: os modelos
    escrevem "nº do processo", e comparar contra "n do processo" só funciona se
    o "º" sair de onde estiver.
    """
    chave = _sem_acento(rotulo).lower()
    chave = chave.replace("\u00ba", "").replace("\u00b0", "")
    chave = re.sub(r"\s+", " ", chave)
    return chave.strip(" .:;-")


def _e_instrucao(chave: str) -> bool:
    """Instrução de edição, e não lacuna a preencher.

    Exige que o marcador **comece** com o termo (ou seja só ele). Procurar o
    termo em qualquer posição classificava errado: "Nome da Empresa (e
    vistoriador, se houver)" é campo de nome que por acaso menciona "se houver",
    e ia para instrução por causa disso.
    """
    if chave in ("ou", "e", "ou/e", "se houver", "nao constituido"):
        return True
    return chave.startswith(INICIOS_INSTRUCAO)


def _opcoes(rotulo: str) -> list[str]:
    """Alternativas do marcador, quando ele oferece escolha.

    ``[defesa prévia (15 dias) / alegações finais (7 dias)]`` tem duas opções;
    ``[NOME DA EMPRESA]`` não tem nenhuma. Só conta como escolha quando sobra
    mais de uma parte com conteúdo — assim uma barra solta de data
    (``XX/XX/XXXX``) não vira menu de opções.
    """
    # Protege a barra de sigla antes de dividir, e a devolve depois.
    protegido = PADRAO_SIGLA_COM_BARRA.sub(rf"\1{_MARCA_BARRA}\2", rotulo)
    partes = [p.strip(" .,;\u201c\u201d\"'") for p in PADRAO_ALTERNATIVA.split(protegido)]
    partes = [p.replace(_MARCA_BARRA, "/") for p in partes if p]
    if len(partes) < 2:
        return []
    # Número ou máscara com barra é data, nº de processo ou CNPJ — não
    # alternativa. O N entra na conta porque as máscaras dos modelos são
    # escritas com N ou X ("NN.NNN.NNN/NNNN-NN").
    if all(re.fullmatch(r"[\dNnXx.\u2013-]+", p) for p in partes):
        return []
    return partes


# --- Mapa cadastral --------------------------------------------------------
# Reconhecimento por palavra-chave em vez de lista fechada: os modelos escrevem
# a mesma lacuna de muitas formas ("NOME DA EMPRESA", "NOME MAIÚSCULO
# NEGRITADO", "Nome Completo", e há até um "NOME MAÍUSCULO" com o acento fora de
# lugar no original). Casar por lista exata deixaria a maioria de fora.
def _e_mascara_documento(chave: str) -> bool:
    """Marcador que é máscara de CPF/CNPJ escrita com N ou X.

    Confere o tamanho dos grupos em vez de aceitar qualquer sequência de X com
    ponto. Sem isso, ``[XXX.XXX]`` — que nos modelos é o **número da OAB** do
    procurador — era tratado como documento e recebia o CNPJ do agente.
    """
    if not re.fullmatch(r"[nx][nx.\-/]*[nx]", chave):
        return False
    grupos = [len(g) for g in re.split(r"[.\-/]+", chave) if g]
    return grupos in GRUPOS_DOCUMENTO


def _campo_cadastral(chave: str) -> str | None:
    tem = lambda *termos: any(t in chave for t in termos)  # noqa: E731

    if tem("cnpj", "cpf"):
        return "cnpj_cpf"
    if _e_mascara_documento(chave):
        return "cnpj_cpf"
    if tem("link"):
        return "link_processo"
    if re.fullmatch(r"140\.[x\d]+", chave) or tem(
        "numero sei", "n sei", "numero do processo", "n do processo", "numero processo",
    ):
        return "numero_processo"
    if tem("municipio", "cidade"):
        return "municipio"
    if tem("data da fiscalizacao", "data de fiscalizacao", "data_fiscalizacao"):
        return "data_fiscalizacao"
    # Nome de outra pessoa (sócio, vistoriador, responsável) não é o agente:
    # fica como campo livre, para o analista digitar.
    if PADRAO_NOME_DE_TERCEIRO.search(chave):
        return None
    # Nome do agente: cobre empresa, pessoa física, despachante e as variantes
    # com instrução de formatação no meio ("negrito e maiúsculo").
    if tem("nome", "razao social", "compromissario", "empresa"):
        return "razao_social"
    return None


def _valor_cadastral(campo: str, item, link_processo: str = "") -> str:
    """Valor do cadastro para o campo, já no formato que o documento espera."""
    if campo == "razao_social":
        # Padrão do projeto: razão social/nome em caixa alta.
        return (getattr(item, "razao_social", None) or "").upper()
    if campo == "cnpj_cpf":
        return getattr(item, "cnpj_cpf", None) or ""
    if campo == "numero_processo":
        return (
            getattr(item, "numero_processo_sei", None)
            or getattr(item, "numero_sei", None)
            or ""
        )
    if campo == "municipio":
        return getattr(item, "municipio", None) or ""
    if campo == "data_fiscalizacao":
        d = getattr(item, "data_inicio_fiscalizacao", None)
        return f"{d.day} de {MESES[d.month - 1]} de {d.year}" if isinstance(d, date) else ""
    if campo == "link_processo":
        return link_processo or ""
    return ""


def _classificar(token: str, item, link_processo: str) -> Marcador | None:
    """Um marcador classificado, sem ainda saber quantas vezes ele repete."""
    rotulo = _normalizar(token)
    if not rotulo:
        return None
    chave = _chave(rotulo)

    if _e_instrucao(chave):
        return Marcador(token, rotulo, TIPO_INSTRUCAO)

    opcoes = _opcoes(rotulo)
    if opcoes:
        return Marcador(token, rotulo, TIPO_ESCOLHA, opcoes=opcoes)

    campo = _campo_cadastral(chave)
    if campo:
        sugerido = _valor_cadastral(campo, item, link_processo) if item is not None else None
        return Marcador(
            token, rotulo, TIPO_CADASTRAL, valor_sugerido=sugerido or None, campo=campo,
        )

    return Marcador(token, rotulo, TIPO_DATA if "data" in chave else TIPO_TEXTO)


# Marcador repetido: um campo só ou um campo por ocorrência?
#
# Na versão anterior cada ocorrência virava um campo separado. Mas o "+"
# (Acrescentar) tornou isso sem sentido: o analista adiciona quantos itens o
# caso exigir, e a numeração sai sozinha no documento. Não faz sentido ter três
# campos de descrição quando um basta e o "+" resolve a quantidade.
#
# Agora a regra é mais simples: SEMPRE um campo só por token, independente de
# quantas vezes ele aparece. O valor gerado é replicado em todas as posições.
# Para campo multivalor, a numeração (1., 2., 3...) é acrescentada
# automaticamente na substituição.
_TIPOS_VALOR_UNICO = (TIPO_CADASTRAL, TIPO_INSTRUCAO)


def _texto_puro(html: str) -> str:
    """Trecho de HTML como texto legível: sem tag, sem entidade, sem espaço duplo."""
    return re.sub(r"\s+", " ", _html.unescape(PADRAO_TAG.sub(" ", html))).strip()


def _contexto(html: str, inicio: int, fim: int, largura: int = 75) -> str:
    """Vizinhança da lacuna no documento, com ``___`` no lugar dela.

    É o que resolve a pergunta "qual das descrições é esta?". No termo de
    instauração, as três ocorrências de ``[descrição]`` têm finalidades
    diferentes, escritas logo depois de cada uma ("Citar irregularidades
    segundo relatório de fiscalização", "CITAR se há outro processo em
    andamento"...). Mostrar o texto em volta identifica a lacuna sem o app ter
    de adivinhar o que o colchete vizinho significa — nos modelos ele às vezes é
    instrução, às vezes alternativa, às vezes exemplo.

    A janela é generosa no HTML de origem (as tags ocupam muito espaço) e
    apertada no texto final.
    """
    antes = _texto_puro(html[max(0, inicio - largura * 12):inicio])
    depois = _texto_puro(html[fim:fim + largura * 12])
    esquerda = antes[-largura:].lstrip()
    direita = depois[:largura].rstrip()
    prefixo = "..." if len(antes) > largura else ""
    sufixo = "..." if len(depois) > largura else ""
    return f"{prefixo}{esquerda} ___ {direita}{sufixo}".strip()


def detectar(html: str, item=None, *, link_processo: str = "") -> list[Marcador]:
    """Campos do documento, na ordem da primeira aparição de cada marcador.

    ``item`` é opcional: sem ele o inventário sai sem sugestão de valor, o que
    serve para inspecionar um modelo fora do contexto de um processo.
    """
    if not html:
        return []

    # Ordem de primeira aparição e posição de cada ocorrência.
    ordem: list[str] = []
    posicoes: dict[str, list[tuple[int, int]]] = {}
    for achado in PADRAO_MARCADOR.finditer(html):
        token = achado.group(0)
        if token not in posicoes:
            posicoes[token] = []
            ordem.append(token)
        posicoes[token].append((achado.start(), achado.end()))

    marcadores: list[Marcador] = []
    # Deduplicação: tokens diferentes que representam o mesmo dado cadastral
    # (ex.: [Nome da empresa minúsculo] e [NOME DA EMPRESA] são ambos
    # campo="razao_social") viram um campo só no formulário. O campo guarda
    # todos os tokens associados para a substituição acertar todos eles.
    campo_ja_visto: dict[str, Marcador] = {}

    for token in ordem:
        base = _classificar(token, item, link_processo)
        if base is None:
            continue
        onde = posicoes[token]
        base.total = len(onde)
        base.multivalor = base.tipo == TIPO_TEXTO

        # Se é cadastral e já existe campo com o mesmo dado, agrupa os tokens.
        if base.campo and base.campo in campo_ja_visto:
            existente = campo_ja_visto[base.campo]
            existente.tokens_extras.append(token)
            existente.total += len(onde)
            continue

        base.id = f"m{len(marcadores)}"
        base.indice = None
        base.contexto = _contexto(html, *onde[0])
        marcadores.append(base)

        if base.campo:
            campo_ja_visto[base.campo] = base

    return marcadores


def aplicar(html: str, marcadores: list[Marcador], valores: dict) -> str:
    """Troca cada marcador pelo valor informado.

    Para campo multivalor com token que aparece mais de uma vez no modelo (ex.:
    ``[descrição]`` 3x no termo de instauração): distribui um item por posição
    com numeração sequencial (1., 2., 3...). Se o analista adicionou mais itens
    do que posições no modelo, os excedentes ficam na última posição. Se há
    menos itens do que posições, as sobras são suprimidas em vez de deixar
    lacuna — o analista já definiu a lista que quer.

    Valor vazio (ou campo ausente) deixa o trecho como está, de propósito: a
    lacuna aparente no editor é mais segura que um buraco silencioso no
    documento assinado.
    """
    if not html or not marcadores or not valores:
        return html or ""

    # Agrupa por token — inclui tokens extras para a substituição acertar todos.
    por_token: dict[str, list[Marcador]] = {}
    for marcador in marcadores:
        por_token.setdefault(marcador.token, []).append(marcador)
        for extra in marcador.tokens_extras:
            por_token.setdefault(extra, []).append(marcador)
        for extra in marcador.tokens_extras:
            por_token.setdefault(extra, []).append(marcador)

    resultado = html
    for token, grupo in por_token.items():
        if token not in resultado:
            continue

        m = grupo[0]
        raw = valores.get(m.id)
        texto = texto_do_valor(raw)
        if not texto:
            continue

        partes = resultado.split(token)
        posicoes = len(partes) - 1

        # Campo multivalor com token repetido: numeração sequencial distribuída.
        if m.multivalor and isinstance(raw, list) and posicoes > 1:
            itens = [v.strip() for v in raw if v.strip()]
            if not itens:
                continue
            montado = partes[0]
            for pos in range(1, len(partes)):
                if pos <= len(itens) and pos < posicoes:
                    montado += f"{pos}. {itens[pos - 1]}" + partes[pos]
                elif pos == posicoes:
                    # Última posição reúne o que falta (excedentes ou o último).
                    restantes = itens[pos - 1:]
                    if restantes:
                        montado += "; ".join(
                            f"{i}. {v}" for i, v in enumerate(restantes, start=pos)
                        ) + partes[pos]
                    else:
                        montado += partes[pos]
                else:
                    # Mais posições que itens: suprime.
                    montado += partes[pos]
            resultado = montado
        else:
            resultado = resultado.replace(token, texto)

    return resultado


def texto_do_valor(valor) -> str:
    """Um ou vários valores viram a frase que entra no documento.

    A quantidade sai do caso, não do modelo: uma lacuna de ``[descrição]`` pode
    reunir sete irregularidades, e ``[NOME DO SÓCIO-ADMINISTRADOR]`` pode ter
    dois sócios. A junção é em linguagem natural ("A, B e C") porque a lacuna
    fica dentro de uma frase — quebrar linha ali partiria o período no meio.
    """
    if valor is None:
        return ""
    if isinstance(valor, str):
        return valor.strip()

    itens = [str(v).strip() for v in valor]
    itens = [v for v in itens if v]
    if not itens:
        return ""
    if len(itens) == 1:
        return itens[0]
    return f"{', '.join(itens[:-1])} e {itens[-1]}"


def link_processo_html(item, sei_web_url: str) -> str:
    """Âncora para o processo no SEI, sugestão dos marcadores ``[link sei]``.

    Prefere o processo sancionatório: depois da instauração é ele que o
    documento cita, não o processo de fiscalização de onde o caso veio. O texto
    do link é o número do SEI, como já fazia o preenchimento antigo dos
    despachos.

    A montagem da URL está repetida aqui (também existe em ``despachos_sei``)
    para este módulo não depender do fluxo de despachos — ele serve os dois
    caminhos, o de despacho e o de fase.
    """
    if not sei_web_url:
        return ""
    id_proc = (
        getattr(item, "id_procedimento_processo", None)
        or getattr(item, "id_procedimento", None)
    )
    numero = (
        getattr(item, "numero_processo_sei", None)
        or getattr(item, "numero_sei", None)
        or "Link Direto"
    )
    if not id_proc:
        return ""
    base = sei_web_url.rstrip("/")
    url = f"{base}/controlador.php?acao=procedimento_trabalhar&id_procedimento={id_proc}"
    return f"<a href='{url}' target='_blank'>{numero}</a>"


def serializar(marcadores: list[Marcador]) -> list[dict]:
    """Marcadores no formato que a API devolve para a tela."""
    return [
        {
            "id": m.id,
            "token": m.token,
            "rotulo": m.rotulo,
            "tipo": m.tipo,
            "total": m.total,
            "indice": m.indice,
            "opcoes": m.opcoes,
            "valor_sugerido": m.valor_sugerido,
            "campo": m.campo,
            "contexto": m.contexto,
            "multivalor": m.multivalor,
            "tokens_extras": m.tokens_extras,
            "preenchivel": m.preenchivel,
        }
        for m in marcadores
    ]


def inventario(html: str, item, sei_web_url: str = "") -> list[dict]:
    """Atalho para a API: detecta e já devolve serializado."""
    marcadores = detectar(
        html, item, link_processo=link_processo_html(item, sei_web_url),
    )
    return serializar(marcadores)


def resumo(marcadores: list[Marcador]) -> dict:
    """Contagem por tipo — usada para a tela dizer quantos campos faltam."""
    total_preenchivel = sum(1 for m in marcadores if m.preenchivel)
    sem_valor = sum(
        1 for m in marcadores if m.preenchivel and not m.valor_sugerido
    )
    return {
        "total": len(marcadores),
        "preenchiveis": total_preenchivel,
        "sem_sugestao": sem_valor,
        "instrucoes": sum(1 for m in marcadores if m.tipo == TIPO_INSTRUCAO),
    }
