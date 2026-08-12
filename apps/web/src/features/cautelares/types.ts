import type { Semaforo } from '../prazos/types'

/** Estado do bloqueio do agente. `revisar` = decisão pendente. */
export type StatusBloqueio = 'ativo' | 'revisar' | 'revogado'

/** Concordância do Coordenador Geral com a medida. */
export type AprovacaoCautelar = 'pendente' | 'aprovada' | 'recusada'

export interface Cautelar {
  id: number
  processo_id: number | null
  caixa_entrada_id: number | null
  agente_id: number | null
  tipo: string | null
  data_inicio: string | null
  data_fim: string | null
  prazo_dias: number | null
  /** vigente | vencendo | vencida | renovada | revogada */
  situacao: string | null
  fundamentacao: string | null
  unidade_responsavel: string | null
  numero_sei_certidao: string | null
  renovada_de_id: number | null
  criado_em: string | null

  // Concordância do Coordenador Geral
  aprovacao: AprovacaoCautelar | null
  aprovada_por: string | null
  motivo_recusa: string | null
  pendente_assinatura: boolean
  link_bloco_sei: string | null

  // Revogação
  data_revogacao: string | null
  revogada_por: string | null
  motivo_revogacao: string | null
  numero_sei_certidao_desbloqueio: string | null

  // Campos computados
  dias_restantes: number | null
  semaforo: Semaforo | null
  status_bloqueio: StatusBloqueio | null
  /** ⚑ Agente bloqueado apresentou defesa: revisar a medida de imediato. */
  defesa_apresentada: boolean
  numero_sei_processo: string | null
  razao_social: string | null
  cnpj_cpf: string | null
  agente_regulado: string | null
  prioritario: boolean
}

export interface CautelarResumo {
  vigentes: number
  vencendo: number
  vencidas: number
  defesa_apresentada: number
  aguardando_aprovacao: number
}

export interface CautelarCreatePayload {
  processo_id?: number | null
  caixa_entrada_id?: number | null
  agente_id?: number | null
  tipo: string
  prazo_dias: number // 30, 45, 60 ou 90
  data_inicio: string // YYYY-MM-DD
  fundamentacao?: string | null
  unidade_responsavel?: string | null
}

export interface CautelarRenovarPayload {
  prazo_dias: number // 30, 45, 60 ou 90
}

export interface FiltrosCautelares {
  situacao?: string
  unidade?: string
  aprovacao?: AprovacaoCautelar | ''
  somente_com_defesa?: boolean
}
