import { apiGet } from '../../api/client'

/** Um candidato da pesquisa global, já classificado pelo backend. */
export interface ResultadoBusca {
  caixa_entrada_id: number
  /** "relatorio" = processo de fiscalização; "processo" = sancionatório. */
  tipo: 'relatorio' | 'processo'
  numero_sei: string | null
  id_procedimento: string | null
  razao_social: string | null
  cnpj_cpf: string | null
  agente_regulado: string | null
  status_triagem: string | null
}

export interface RespostaBusca {
  termo: string
  total: number
  resultados: ResultadoBusca[]
}

/** Procura relatórios e processos por Nº SEI, CNPJ/CPF ou razão social. */
export function buscar(termo: string, limit = 8): Promise<RespostaBusca> {
  const params = new URLSearchParams({ termo, limit: String(limit) })
  return apiGet<RespostaBusca>(`/busca?${params.toString()}`)
}

/**
 * Tela de destino de um resultado da pesquisa.
 *
 * Era exatamente isso que faltava: a pesquisa mandava tudo para "Processos em
 * Andamento", então um número de relatório que estava na Caixa de Entrada caía
 * na tela errada. Agora o destino segue o tipo do que foi encontrado.
 */
export function rotaDoResultado(r: ResultadoBusca): string {
  return r.tipo === 'processo'
    ? `/processos/${r.caixa_entrada_id}`
    : `/analise/${r.caixa_entrada_id}`
}
