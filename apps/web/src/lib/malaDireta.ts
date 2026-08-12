/**
 * Mala direta: preenchimento das lacunas do modelo antes de abrir o editor.
 *
 * O inventário das lacunas vem do backend (`app/services/mala_direta.py`), que
 * é quem sabe classificar cada marcador. Aqui ficam o tipo devolvido pela API e
 * a substituição.
 *
 * Um mesmo marcador pode gerar mais de um campo. `[NOME DA EMPRESA]` repetido
 * quatro vezes é o mesmo dado nas quatro posições, então é um campo só; já
 * `[descrição]` repetido três vezes no termo de instauração são os itens "1.",
 * "2." e "3.", condutas diferentes, e aí cada posição tem o seu campo. Quem
 * decide isso é o backend — daqui em diante a diferença aparece em `indice`.
 */

export type TipoMarcador = 'cadastral' | 'escolha' | 'data' | 'texto' | 'instrucao'

/** Uma lacuna do modelo, como o backend a devolve. */
export interface Marcador {
  /** Chave do campo no formulário. Não é o token: um token pode virar N campos. */
  id: string
  /** Trecho literal do documento — é por ele que a substituição casa. */
  token: string
  /** Texto legível, sem tag nem entidade HTML. */
  rotulo: string
  tipo: TipoMarcador
  /** Quantas vezes o token aparece no documento. */
  total: number
  /** Qual ocorrência este campo preenche (1-based). `null` = todas elas. */
  indice: number | null
  /** Alternativas, quando `tipo === 'escolha'`. */
  opcoes: string[]
  /** Valor vindo do cadastro, quando houver. */
  valor_sugerido: string | null
  /** Campo de origem da sugestão (rastreabilidade). */
  campo: string | null
  /** Trecho do documento em volta da lacuna, com `___` no lugar dela. */
  contexto: string | null
  /** true quando o campo aceita mais de um valor (vários sócios, várias condutas). */
  multivalor: boolean
  /** Tokens adicionais que representam o mesmo dado (ex.: [Nome da empresa
   *  minúsculo] e [NOME DA EMPRESA] são ambos a razão social). */
  tokens_extras: string[]
  /** false para instrução de edição, que não é campo de formulário. */
  preenchivel: boolean
}

/** Valor de um campo: um texto, ou vários quando o campo é multivalor. */
export type ValorCampo = string | string[]

/** Valores de um campo sempre como lista, para a tela iterar sem ramificar. */
export function listaDeValores(valor: ValorCampo | undefined): string[] {
  if (Array.isArray(valor)) return valor.length > 0 ? valor : ['']
  return [valor ?? '']
}

/**
 * Um ou vários valores viram a frase que entra no documento.
 *
 * A quantidade sai do caso, não do modelo: uma lacuna de `[descrição]` pode
 * reunir sete irregularidades, e `[NOME DO SÓCIO-ADMINISTRADOR]` pode ter dois
 * sócios. A junção é em linguagem natural ("A, B e C") porque a lacuna fica
 * dentro de uma frase — quebrar linha ali partiria o período no meio.
 */
export function textoDoValor(valor: ValorCampo | undefined): string {
  if (valor === undefined || valor === null) return ''
  if (typeof valor === 'string') return valor.trim()
  const itens = valor.map((v) => v.trim()).filter(Boolean)
  if (itens.length === 0) return ''
  if (itens.length === 1) return itens[0]
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`
}

/**
 * Troca cada marcador pelo valor informado, ocorrência por ocorrência.
 *
 * `valores` é indexado pelo `id` do marcador. Valor vazio deixa aquela
 * ocorrência como está, de propósito: a lacuna aparente no editor é mais segura
 * que um buraco silencioso no documento assinado. Preencher a 1ª e a 3ª
 * descrição, deixando a 2ª em branco, mantém só a 2ª marcada.
 *
 * A troca é literal (`split`/`join`) e não por expressão regular — os
 * marcadores têm colchete, ponto e barra, que em regex teriam outro sentido.
 */
export function aplicarMarcadores(
  html: string,
  marcadores: Marcador[],
  valores: Record<string, ValorCampo>,
): string {
  if (!html || marcadores.length === 0) return html ?? ''

  // Agrupa por token: inclui tokens extras para a substituição acertar todos.
  const porToken = new Map<string, Marcador[]>()
  for (const marcador of marcadores) {
    const grupo = porToken.get(marcador.token)
    if (grupo) grupo.push(marcador)
    else porToken.set(marcador.token, [marcador])
    for (const extra of marcador.tokens_extras ?? []) {
      const g = porToken.get(extra)
      if (g) g.push(marcador)
      else porToken.set(extra, [marcador])
    }
  }

  let resultado = html
  for (const [token, grupo] of porToken) {
    if (!resultado.includes(token)) continue

    const geral = textoDoValor(valores[grupo.find((m) => m.indice === null)?.id ?? ''])
    const porPosicao = new Map<number, string>()
    for (const m of grupo) {
      if (m.indice !== null) porPosicao.set(m.indice, textoDoValor(valores[m.id]))
    }
    const temAlgum = geral || [...porPosicao.values()].some(Boolean)
    if (!temAlgum) continue

    const partes = resultado.split(token)
    let montado = partes[0]
    for (let i = 1; i < partes.length; i++) {
      const valor = porPosicao.has(i) ? porPosicao.get(i)! : geral
      montado += (valor || token) + partes[i]
    }
    resultado = montado
  }
  return resultado
}

/** Marcadores que viram campo de formulário, na ordem do documento. */
export function camposPreenchiveis(marcadores: Marcador[]): Marcador[] {
  return marcadores.filter((m) => m.preenchivel)
}

/** Instruções de edição do modelo — mostradas como aviso, não como campo. */
export function instrucoesDoModelo(marcadores: Marcador[]): Marcador[] {
  return marcadores.filter((m) => !m.preenchivel)
}

/**
 * Valores iniciais do formulário: o que o cadastro já sabe.
 *
 * Marcador de escolha começa vazio de propósito — deixar a primeira alternativa
 * pré-selecionada faria o analista aceitar sem ler, e a escolha errada entre
 * "tempestiva" e "intempestiva" muda o sentido do ato.
 */
export function valoresIniciais(marcadores: Marcador[]): Record<string, ValorCampo> {
  const valores: Record<string, ValorCampo> = {}
  for (const m of camposPreenchiveis(marcadores)) {
    valores[m.id] = m.tipo === 'escolha' ? '' : (m.valor_sugerido ?? '')
  }
  return valores
}

/** Quantos campos ainda estão sem valor (para avisar, não para bloquear). */
export function totalPendentes(
  marcadores: Marcador[], valores: Record<string, ValorCampo>,
): number {
  return camposPreenchiveis(marcadores).filter(
    (m) => !textoDoValor(valores[m.id]),
  ).length
}
