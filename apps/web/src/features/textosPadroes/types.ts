/** Tipos da tela de textos-padrão (ver backend/app/schemas/textos_padroes.py). */

export interface TextoPadraoResumo {
  id: number
  agente_regulado: string
  /** Papel do documento no fluxo (`saneador`, `arquivamento_relatorio`...). */
  funcao: string
  /** A função em texto legível ("Arquivamento do Relatório"). */
  funcao_titulo: string
  /** O que diferencia esta variante ("Despacho 47 - Sem irregular"). */
  rotulo: string
  nome_arvore: string | null
  /** Variante escolhida como padrão do app para a função e o agente. */
  padrao: boolean
  editado: boolean
  editado_em: string | null
  editado_por: string | null
  /** O texto oficial mudou no SEI depois da edição feita aqui. */
  divergente_do_original: boolean
}

export interface TextoPadraoDetalhe extends TextoPadraoResumo {
  template_html: string
  html_original: string | null
}

export interface FuncaoResumo {
  funcao: string
  titulo: string
  quantidade: number
}

export interface FiltrosTextosPadroes {
  agente?: string
  funcao?: string
  busca?: string
  somenteEditados?: boolean
}
