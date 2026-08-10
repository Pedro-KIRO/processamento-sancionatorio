"""Textos-padrão do SEI: extração do corpo e preenchimento de variáveis.

Os modelos de documento entregues pela área são páginas HTML exportadas do SEI
(``textos_padroes/*.txt``). Cada arquivo traz, além do texto que interessa:

- **cabeçalho**: timbre em base64, "Governo do Estado de São Paulo",
  "DEPARTAMENTO ESTADUAL DE TRÂNSITO" e a coordenadoria/divisão;
- **rodapé**: a faixa "Criado por ..., versão N por ... em dd/mm/aaaa".

Nada disso pode ir para o documento novo: quando a API do SEI cria um documento
interno, ela mesma aplica cabeçalho e rodapé. Repetir aqui produziria dois
timbres e um "criado por" falso, com o nome de quem redigiu o modelo.

Este módulo isola essa limpeza e a substituição das variáveis, para o
importador e o restante do app usarem o mesmo tratamento.
"""
from __future__ import annotations

import html as html_lib
import re
import unicodedata
from datetime import date

MESES = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

# Número de processo/documento do SEI: 140.00146432/2026-18
PADRAO_NUMERO_SEI = re.compile(r"\b\d{3}\.\d{8}/\d{4}-\d{2}\b")

# Numeração do próprio documento no modelo: "Despacho nº 77/2026-DETRAN/DGR/CPSAR".
# É o número do documento de onde o modelo foi exportado; mantê-lo faria todo
# saneador sair como "nº 77". Restrito aos tipos de documento para não pegar
# citações de norma ("Resolução CONTRAN nº 941, de 2022").
PADRAO_NUMERO_DOCUMENTO = re.compile(
    r"\b(Despacho|Decisão|Decisao|Portaria|Parecer|Certidão|Certidao)\s+n[º°o]\s*\d+\s*/\s*\d{4}",
    re.IGNORECASE,
)

# Marcador de preenchimento usado pela área nos modelos: uma corrida de "X" no
# lugar do nome do agente.
PADRAO_XIS = re.compile(r"X{6,}")

# Rodapé de autoria que o SEI acrescenta ao exportar.
PADRAO_RODAPE = re.compile(
    r"<div[^>]*unselectable\s*=\s*[\"']on[\"'][^>]*>.*?</div>",
    re.IGNORECASE | re.DOTALL,
)

# Marca d'água de minuta do editor do SEI. Aparece nas três minutas de portaria
# de autoescola como um <span class="minutaAncora"> com um <style> dentro, que
# estampa "MINUTA" na diagonal sobre a página inteira (``body:after`` com
# ``position: fixed``). Não é conteúdo: o próprio CSS embutido instrui a
# "delete isto para remover a marca d'agua". Levado para um ato assinado,
# marcaria o documento oficial como minuta.
PADRAO_ANCORA_MINUTA = re.compile(
    r"<span\b[^>]*class\s*=\s*[\"'][^\"']*minutaAncora[^\"']*[\"'][^>]*>.*?</span>",
    re.IGNORECASE | re.DOTALL,
)

# Folha de estilo solta no corpo. A formatação oficial vem das classes do SEI
# (``Texto_Justificado_Recuo_Primeira_Linha`` e afins), aplicadas por ele.
PADRAO_STYLE = re.compile(r"<style\b[^>]*>.*?</style>", re.IGNORECASE | re.DOTALL)

# Linhas fixas do cabeçalho institucional. Comparadas sem acento e em
# minúsculas, então basta a forma simples aqui.
INICIOS_CABECALHO = (
    "governo do estado de sao paulo",
    "departamento estadual de transito",
    "coordenadoria de",
    "divisao de",
    "servico de",
    "secretaria de",
)

# Título do documento escrito solto na primeira linha ("TERMO de instauração",
# "Certidão", "NOTIFICAÇÃO"). É o nome da série: o SEI o aplica sozinho quando
# o documento é criado com o `idSerie`, então repeti-lo no texto produziria o
# título duas vezes.
#
# Vale para o nome puro e para a linha numerada do ato, que é a mesma coisa com
# a identificação atrás ("DECISÃO DETRAN-SP nº 2500, de 29 de julho de 2026",
# "Despacho nº 47/2026-DETRAN/DGR/CPSAR/DSPSD/DPSARC").
#
# Comparado sem acento e em minúsculas, ignorando pontuação.
TITULOS_DOCUMENTO = (
    "certidao",
    "citacao",
    "citacao em processo administrativo sancionatorio",
    "decisao",
    "despacho",
    "edital",
    "intimacao",
    "notificacao",
    "oficio",
    "parecer de merito",
    "portaria",
    "relatorio",
    "relatorio de fiscalizacao",
    "termo de ajustamento de conduta",
    "termo de ajuste de conduta",
    "termo de encerramento",
    "termo de instauracao",
)

# Bloco de assinatura no fim do documento. O SEI o monta sozinho a partir de
# quem assina, então o texto do modelo termina na linha "São Paulo, <data>".
# Mantê-lo produziria duas assinaturas: uma escrita no corpo e outra aplicada
# pelo SEI.
#
# Rótulos exatos que aparecem no lugar do nome ou do cargo.
ROTULOS_ASSINATURA = (
    "responsavel",
    "reponsavel",  # erro de digitação presente em um dos modelos
    "nome",
    "nome completo",
    "cargo",
    "cargo do servidor",
    "compromissario",
)

# Começos de cargo. Prefixo, e não igualdade, porque os títulos completos
# variam ("Coordenador", "Coordenador Geral de Gestão de Agentes e Atividades
# Reguladas", "Chefe de Serviço", "Chefe da Divisão", "Diretor de Gestão
# Regulatória").
INICIOS_CARGO = (
    "chefe de ",
    "chefe da ",
    "chefe do ",
    "coordenador",
    "diretor",
)

# Variável do próprio modelo no lugar do cargo (@cargo_usuario@).
PADRAO_VARIAVEL_SOZINHA = re.compile(r"^@[a-z_]+@$", re.IGNORECASE)

# Nome de pessoa em maiúsculas ("ALINE DAISY CRISTINA MOTA MARQUES"). Só
# letras e espaços, entre duas e seis palavras: exclui título de seção de uma
# palavra ("CITAÇÃO") e frase com pontuação ("PUBLIQUE-SE", "ARQUIVE-SE").
PADRAO_NOME_MAIUSCULO = re.compile(r"^[^\W\d_]+(?: [^\W\d_]+){1,5}$", re.UNICODE)

# Parágrafos de nível superior, para varrer o documento bloco a bloco.
PADRAO_PARAGRAFO = re.compile(r"<p\b[^>]*>.*?</p>", re.IGNORECASE | re.DOTALL)

# Quebra de linha. Aceita atributos: alguns modelos trazem <br style="..."> e
# <br _ngcontent-ng-c2732587861="" />.
PADRAO_BR = re.compile(r"<br\b[^>]*>", re.IGNORECASE)

# Fechamentos no começo do corpo cujas aberturas ficaram no cabeçalho removido.
PADRAO_FECHAMENTO_ORFAO = re.compile(
    r"^(?:\s|</(?:div|p|span|td|tr|table)>)+", re.IGNORECASE
)

# Identificação do ato depois do nome da série, no título numerado. Comparada
# com o texto já sem acento e em minúsculas. Cobre as formas encontradas nos
# modelos: "DETRAN-SP nº 2500, de 29 de julho de 2026", "nº 47/2026-DETRAN/DGR/
# CPSAR/DSPSD/DPSARC" e "DETRAN-SP Nº xxxxxxx, DE 29 DE julho DE 2026" (número
# ainda por preencher).
PADRAO_IDENTIFICACAO_ATO = re.compile(
    r"^(?:detran-sp\s*)?"                                    # DETRAN-SP / deTRAN-SP
    r"n\s*[º°o]?\s*"                                         # nº, n°, n
    r"[\dx]+(?:\s*/\s*\d{4})?"                               # 2500, xxxxxxx, 47/2026
    r"(?:\s*-\s*[a-z/]+)?"                                   # -detran/dgr/cpsar/...
    r"(?:\s*,?\s*de\s+\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4})?"  # , de 29 de julho de 2026
    r"$",
    re.IGNORECASE,
)


def _sem_acento(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    )


def _texto_visivel(bloco_html: str) -> str:
    """Texto de um trecho de HTML, sem tags e sem espaços duplicados.

    Desfaz as entidades HTML antes de comparar: os documentos baixados da API do
    SEI vêm com ``S&atilde;o Paulo`` e ``TR&Acirc;NSITO``, e sem essa conversão
    o cabeçalho institucional não era reconhecido — passava inteiro para o
    documento novo, que saía com dois timbres.
    """
    sem_tags = re.sub(r"<[^>]+>", " ", bloco_html)
    sem_entidades = html_lib.unescape(sem_tags).replace("\xa0", " ")
    return re.sub(r"\s+", " ", sem_entidades).strip()


def _e_linha_de_cabecalho(bloco_html: str) -> bool:
    """Diz se o bloco é parte do cabeçalho institucional (ou está vazio).

    Só faz sentido aplicar aos primeiros blocos do documento: "Coordenadoria de
    Processamento Sancionatório" também aparece no meio do texto de vários
    modelos, e ali não deve ser removida.
    """
    if 'alt="Timbre"' in bloco_html or "alt='Timbre'" in bloco_html:
        return True

    texto = _texto_visivel(bloco_html)
    if not texto:
        return True  # parágrafo de espaçamento (&nbsp;)

    # Número do processo isolado no topo do documento
    if PADRAO_NUMERO_SEI.fullmatch(texto):
        return True

    normalizado = _sem_acento(texto).lower()
    return any(normalizado.startswith(inicio) for inicio in INICIOS_CABECALHO)


def _e_titulo_de_documento(bloco_html: str) -> bool:
    """Diz se o bloco é só o título do documento.

    Vale tanto para o nome puro da série ("Certidão") quanto para a linha
    numerada do ato ("DECISÃO DETRAN-SP nº 2500, de 29 de julho de 2026"): as
    duas formas o SEI aplica sozinho a partir do ``idSerie``.
    """
    texto = _texto_visivel(bloco_html).strip(" .:").strip()
    normalizado = _sem_acento(texto).lower()
    if normalizado in TITULOS_DOCUMENTO:
        return True

    # Descasca o nome da série e vê se o que sobra é só a identificação do ato.
    # O casamento é ancorado no parágrafo inteiro: assim "Certidão nº 4 juntada
    # aos autos", que é texto, não é confundida com título.
    for titulo in TITULOS_DOCUMENTO:
        if normalizado.startswith(titulo):
            resto = normalizado[len(titulo) :].strip()
            if resto and PADRAO_IDENTIFICACAO_ATO.match(resto):
                return True
    return False


# Marca a quebra de linha no lugar do <br> antes de reduzir o parágrafo a
# texto. Não pode ser "\n": _texto_visivel colapsa espaço em branco, e a
# separação entre "RESPONSÁVEL" e o cargo se perderia.
SEPARADOR_LINHA = " | "


def _e_linha_de_assinatura(linha: str) -> bool:
    """Diz se uma linha isolada é nome, cargo ou rótulo de assinatura."""
    if PADRAO_VARIAVEL_SOZINHA.match(linha):
        return True

    normalizado = _sem_acento(linha).lower()
    if normalizado in ROTULOS_ASSINATURA:
        return True
    if any(normalizado.startswith(inicio) for inicio in INICIOS_CARGO):
        return True
    if linha == linha.upper() and PADRAO_NOME_MAIUSCULO.match(linha):
        return True

    # "RESPONSÁVEL Chefe de Divisão" numa linha só: em parte dos modelos o
    # rótulo e o cargo estão no mesmo parágrafo, separados apenas por <span>,
    # sem <br> que permitisse dividir. Descasca o rótulo e testa o resto.
    for rotulo in ROTULOS_ASSINATURA:
        if normalizado.startswith(rotulo + " "):
            return _e_linha_de_assinatura(linha[len(rotulo) :].strip())
    return False


def _e_assinatura(texto: str) -> bool:
    """Diz se o texto de um parágrafo é só bloco de assinatura.

    Cobre as três formas encontradas nos modelos: nome e cargo em parágrafos
    separados, os dois no mesmo parágrafo separados por ``<br>``, e os dois
    juntos num único trecho de texto.
    """
    linhas = [parte.strip() for parte in re.split(r"[\n·|]+", texto) if parte.strip()]
    if not linhas:
        return False
    return all(_e_linha_de_assinatura(linha) for linha in linhas)


def remover_assinatura(corpo: str) -> str:
    """Remove o bloco de assinatura do fim do documento.

    Varre de trás para frente e para no primeiro parágrafo que não é assinatura
    — em geral a linha "São Paulo, <data>", que fica. Assim os despachos de dois
    níveis não são mutilados: neles um "À vista da manifestação do Chefe de
    Serviço, a qual acolho, ARQUIVE-SE." vem depois da primeira assinatura, e
    cortar o documento a partir da data levaria embora esse texto.

    Parágrafos vazios são atravessados, mas preservados: são o espaçamento
    entre a data e a assinatura. Só os parágrafos saem; as ``<div>`` que os
    envolviam ficam, vazias, porque cortar o HTML a partir de um ponto deixaria
    tags de abertura sem fechamento (os modelos têm divs aninhadas).
    """
    blocos = list(PADRAO_PARAGRAFO.finditer(corpo))
    remover: list[re.Match[str]] = []

    for bloco in reversed(blocos):
        # O <br> separa nome e cargo dentro do mesmo parágrafo; vira um
        # separador que sobrevive à limpeza de espaços de _texto_visivel.
        marcado = PADRAO_BR.sub(SEPARADOR_LINHA, bloco.group(0))
        texto = _texto_visivel(marcado)
        # Sem letra nem dígito é espaçamento — inclusive o <p><br></p>, que
        # depois da troca fica só com o separador. Atravessa sem remover.
        if not any(caractere.isalnum() for caractere in texto):
            continue
        if not _e_assinatura(texto):
            break
        remover.append(bloco)

    resultado = corpo
    for bloco in remover:  # já está de trás para frente: as posições seguem válidas
        resultado = resultado[: bloco.start()] + resultado[bloco.end() :]
    return resultado


def extrair_corpo(html: str) -> str:
    """Devolve só o corpo do texto-padrão, sem cabeçalho nem assinatura.

    Sai do modelo tudo o que o SEI aplica sozinho ao criar o documento:

    - **cabeçalho**: timbre, "Governo do Estado", órgão e unidade — vêm do tipo
      de documento escolhido;
    - **título**: o nome da série escrito solto na primeira linha ("TERMO de
      instauração", "Certidão") ou com a identificação do ato atrás ("DECISÃO
      DETRAN-SP nº 2500, de 29 de julho de 2026"), que o SEI aplica a partir do
      ``idSerie``;
    - **rodapé de autoria** ("Criado por ..., versão N");
    - **marca d'água de minuta** do editor, que estamparia "MINUTA" sobre o
      documento assinado;
    - **bloco de assinatura** ("RESPONSÁVEL" e o cargo), que o SEI monta a
      partir de quem assina. O texto do modelo termina na linha "São Paulo,
      <data>".



    A linha "São Paulo, <data>" fica: é onde o texto do modelo termina.

    O que fica é preservado como está, inclusive as classes de estilo do SEI
    (``Texto_Justificado_Recuo_Primeira_Linha`` e afins), que são o que dá ao
    documento a formatação oficial.
    """
    if not html:
        return ""

    conteudo = html
    corpo = re.search(r"<body[^>]*>(.*?)</body>", conteudo, re.IGNORECASE | re.DOTALL)
    if corpo:
        conteudo = corpo.group(1)

    conteudo = PADRAO_RODAPE.sub("", conteudo)
    conteudo = PADRAO_ANCORA_MINUTA.sub("", conteudo)
    conteudo = PADRAO_STYLE.sub("", conteudo)
    conteudo = remover_assinatura(conteudo)

    # Procura onde termina o cabeçalho e corta ali, devolvendo o resto do HTML
    # intacto. O corte é por posição, não por remontagem de pedaços: juntar
    # trechos casados por expressão regular perdia os "<" das tags de
    # fechamento que sobravam entre os pedaços, e o documento saía com "/div>"
    # como texto visível.
    paragrafos = list(PADRAO_PARAGRAFO.finditer(conteudo))
    if not paragrafos:
        return conteudo.strip()  # modelo sem <p>: não há cabeçalho a tirar

    indice = next(
        (
            i
            for i, p in enumerate(paragrafos)
            if not _e_linha_de_cabecalho(p.group(0))
            and not _e_titulo_de_documento(p.group(0))
        ),
        None,
    )
    if indice is None:
        return ""  # só cabeçalho e título

    # Corta no fim do último parágrafo de cabeçalho, não no início do primeiro
    # parágrafo do corpo, para não perder as <div> que abrem entre os dois.
    corte = paragrafos[indice - 1].end() if indice else 0
    return PADRAO_FECHAMENTO_ORFAO.sub("", conteudo[corte:]).strip()


def preencher_variaveis(
    html: str,
    *,
    numero_processo: str | None = None,
    razao_social: str | None = None,
    cnpj_cpf: str | None = None,
    hoje: date | None = None,
    dias_prazo: int | None = None,
) -> str:
    """Troca as variáveis do texto-padrão pelos dados do processo.

    Reconhece os marcadores que a própria área já usa nos modelos (``@dia@``,
    ``@mes_extenso@``, ``@ano@``) e substitui números de processo escritos no
    exemplo original pelo número real — os modelos foram exportados de um
    processo verdadeiro e trazem o número dele no texto.

    O que não tiver correspondência fica como está, de propósito: o analista vê
    o marcador no editor e sabe que precisa preencher.
    """
    if not html:
        return ""

    referencia = hoje or date.today()
    resultado = html

    if numero_processo:
        resultado = PADRAO_NUMERO_SEI.sub(numero_processo, resultado)

    # O número do documento no modelo é o do documento original. Vira marcador
    # visível: melhor o analista preencher do que o documento sair com o número
    # de outro processo.
    resultado = PADRAO_NUMERO_DOCUMENTO.sub(
        lambda achado: f"{achado.group(1)} nº @numero_documento@/{referencia.year}", resultado,
    )

    if razao_social:
        resultado = PADRAO_XIS.sub(razao_social.upper(), resultado)

    substituicoes = {
        "@dia@": f"{referencia.day:02d}",
        "@mes@": f"{referencia.month:02d}",
        "@mes_extenso@": MESES[referencia.month - 1],
        "@ano@": str(referencia.year),
        "@data_extenso@": f"{referencia.day} de {MESES[referencia.month - 1]} de {referencia.year}",
        "@numero_processo@": numero_processo or "",
        "@razao_social@": (razao_social or "").upper(),
        "@cnpj_cpf@": cnpj_cpf or "",
        "@dias_prazo@": str(dias_prazo) if dias_prazo is not None else "",
    }
    for marcador, valor in substituicoes.items():
        if valor or marcador in ("@numero_processo@", "@razao_social@", "@cnpj_cpf@"):
            resultado = resultado.replace(marcador, valor)

    return resultado
