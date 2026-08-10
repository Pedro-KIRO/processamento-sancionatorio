/*
  O semáforo vive em `lib/semaforo.ts` porque as telas de Prazos e de Cautelares
  usam exatamente o mesmo código de cores, por exigência do documento. Fica
  reexportado aqui para os imports desta feature continuarem curtos.
*/
export {
  BORDA_SEMAFORO,
  CLASSE_SEMAFORO,
  FUNDO_LINHA_SEMAFORO,
  PONTO_SEMAFORO,
  TEXTO_SEMAFORO,
  type Semaforo,
} from '../../lib/semaforo'

import type { Semaforo } from '../../lib/semaforo'

/** Modos de visualização da tela de Controle de Prazos. */
export type ModoVisualizacao = 'lista' | 'calendario' | 'semana'

export interface PrazoLinha {
  id: number
  caixa_entrada_id: number
  prioritario: boolean
  prioridade_justificativa: string | null
  numero_sei: string | null
  id_procedimento: string | null
  interessado: string | null
  cnpj_cpf: string | null
  agente_regulado: string | null
  fase: string | null
  tipo_prazo: string | null
  base_legal: string | null
  dias: number | null
  data_inicio: string | null
  data_vencimento: string | null
  dias_restantes: number | null
  restante_rotulo: string | null
  semaforo: Semaforo | null
  situacao_rotulo: string | null
  responsavel: string | null
  status: string | null
}

export interface ResumoPrazos {
  vencidos: number
  vence_em_3_dias: number
  no_prazo: number
  priorizados: number
}

export interface RespostaPrazos {
  resumo: ResumoPrazos
  prazos: PrazoLinha[]
  total: number
  pode_priorizar: boolean
}

export interface TipoPrazo {
  chave: string
  rotulo: string
  dias: number
  base_legal: string
  gatilho: string
  no_vencimento: string
  fase: string | null
  gerencial: boolean
}

export interface ResponsavelPrazo {
  id: number
  nome: string
}

export interface FiltrosPrazos {
  busca?: string
  agente?: string
  tipo?: string
  situacao?: Semaforo | ''
  responsavel_id?: number | null
  priorizados?: boolean
  venc_de?: string
  venc_ate?: string
}


