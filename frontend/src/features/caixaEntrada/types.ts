export interface ItemCaixaEntrada {
  id: number
  id_relatorio: string | null
  numero_sei: string | null
  id_procedimento: string | null
  razao_social: string | null
  agente_regulado: string | null
  segmento: string | null
  tipo_documento: string | null
  cnpj_cpf: string | null
  data_recebimento: string | null
  data_remetido: string | null
  status_triagem: string | null
}

/** Colunas pelas quais a listagem pode ser ordenada (o backend faz a ordem). */
export type ColunaOrdenavelCaixa = 'data_recebimento' | 'razao_social'

export type SentidoOrdem = 'asc' | 'desc'

export interface FiltrosCaixa {
  busca?: string
  agente?: string
  dataInicio?: string
  dataFim?: string
  ordenarPor?: ColunaOrdenavelCaixa
  ordem?: SentidoOrdem
}
