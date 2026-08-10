import { apiGet } from '../../api/client'

/**
 * Fonte dos dados de uma linha.
 *
 * Não é sinônimo de tipo: "processamento" inclui o que chegou à caixa de
 * entrada e ainda aguarda triagem, ou o que foi arquivado — mais amplo do que
 * "tem processo instaurado".
 */
export type Fonte = 'fiscalizacao' | 'processamento'

/** Uma linha da Consulta Unificada: relatório de fiscalização ou processo. */
export interface LinhaConsulta {
  id: number
  /** "relatorio" (fiscalização) ou "processo" (sancionatório). */
  tipo: 'relatorio' | 'processo'
  /**
   * Origem do registro: "fiscalizacao" quando só existe no app de fiscalização,
   * "processamento" quando já foi tramitado para a nossa caixa de entrada.
   */
  fonte: Fonte
  numero_sei: string | null
  /** ID interno do procedimento no SEI, para o link direto. */
  id_procedimento: string | null
  razao_social: string | null
  cnpj_cpf: string | null
  agente_regulado: string | null
  municipio: string | null
  ano: string | null
  /** statusAndamento da listaDesignacao (Concluído, Avaliado, Em andamento...). */
  situacao: string | null
  /** Fase do processo administrativo — só para tipo "processo". */
  fase_atual: string | null
  /** Data de criação no SEI (último andamento do histórico). */
  data_criacao_sei: string | null
  /** Data da última ação no SEI (primeiro andamento do histórico). */
  data_ultima_acao: string | null
  /** Item da caixa de entrada correspondente, quando existe. */
  caixa_entrada_id: number | null
}

export interface RespostaConsulta {
  total: number
  limit: number
  offset: number
  linhas: LinhaConsulta[]
}

/** Colunas pelas quais a tabela pode ser ordenada. */
export type ColunaOrdenavel =
  | 'criacao'
  | 'ultima_acao'
  | 'razao_social'
  | 'numero_sei'
  | 'cnpj_cpf'
  | 'agente'
  | 'situacao'
  | 'fase'

export interface FiltrosConsulta {
  busca?: string
  tipo?: string
  fonte?: string
  agente?: string
  situacao?: string
  fase?: string
  ano?: string
  /** Período de criação no SEI (formato ISO: aaaa-mm-dd). */
  criacao_de?: string
  criacao_ate?: string
  /** Período da última ação no SEI. */
  acao_de?: string
  acao_ate?: string
  ordenar_por?: ColunaOrdenavel
  ordem?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/** Lista relatórios e processos consolidados, com filtros e paginação. */
export function listarConsultaUnificada(filtros: FiltrosConsulta = {}): Promise<RespostaConsulta> {
  const params = new URLSearchParams()
  const texto: (keyof FiltrosConsulta)[] = [
    'busca', 'tipo', 'fonte', 'agente', 'situacao', 'fase', 'ano',
    'criacao_de', 'criacao_ate', 'acao_de', 'acao_ate',
  ]
  for (const campo of texto) {
    const valor = filtros[campo]
    if (valor) params.set(campo, String(valor))
  }
  params.set('ordenar_por', filtros.ordenar_por ?? 'criacao')
  params.set('ordem', filtros.ordem ?? 'desc')
  params.set('limit', String(filtros.limit ?? 100))
  params.set('offset', String(filtros.offset ?? 0))
  return apiGet<RespostaConsulta>(`/consulta-unificada?${params.toString()}`)
}

/** Recorte usado pelos filtros dependentes (agentes e situações). */
export interface RecorteConsulta {
  tipo?: string
  fonte?: string
}

function paramsRecorte(recorte: RecorteConsulta = {}): string {
  const params = new URLSearchParams()
  if (recorte.tipo) params.set('tipo', recorte.tipo)
  if (recorte.fonte) params.set('fonte', recorte.fonte)
  const query = params.toString()
  return query ? `?${query}` : ''
}

/** Agentes regulados distintos presentes na consulta (para o filtro). */
export function listarAgentesConsulta(recorte: RecorteConsulta = {}): Promise<string[]> {
  return apiGet<string[]>(`/consulta-unificada/agentes${paramsRecorte(recorte)}`)
}

/**
 * Situações distintas presentes na consulta (para o filtro).
 *
 * Recebe tipo e fonte para não oferecer situação impossível: filtrando somente
 * relatórios, "Processo instaurado" não aparece na lista.
 */
export function listarSituacoesConsulta(recorte: RecorteConsulta = {}): Promise<string[]> {
  return apiGet<string[]>(`/consulta-unificada/situacoes${paramsRecorte(recorte)}`)
}

/** Fases presentes na consulta, já na ordem oficial do processo. */
export function listarFasesConsulta(recorte: RecorteConsulta = {}): Promise<string[]> {
  return apiGet<string[]>(`/consulta-unificada/fases${paramsRecorte(recorte)}`)
}
