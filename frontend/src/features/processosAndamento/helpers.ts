import type { ItemProcessoAndamento } from './types'

export const STATUS_LABEL: Record<string, string> = {
  arquivado: 'Arquivado',
  tac: 'TAC',
  instaurado: 'Instaurado',
}

export const STATUS_CLASSE: Record<string, string> = {
  arquivado: 'bg-outline-variant/40 text-on-surface-variant',
  tac: 'bg-secondary-container/30 text-secondary',
  instaurado: 'bg-primary-fixed/40 text-on-primary-fixed-variant',
}

/**
 * Rota de análise de um processo em andamento, conforme o tipo de despacho
 * que tirou o item da Caixa de Entrada:
 * - instaurado: processo NOVO criado no SEI → tela de análise dedicada.
 * - tac: os documentos ficam no MESMO processo de fiscalização → continua
 *   sendo a tela de análise do relatório original (não muda).
 * - arquivado: ainda não existe uma tela de arquivamento dedicada (null).
 */
export function rotaAnaliseProcesso(item: ItemProcessoAndamento): string | null {
  if (item.status_triagem === 'instaurado') return `/processos/${item.id}`
  if (item.status_triagem === 'tac') return `/analise/${item.id}`
  return null
}

/** Número do processo a exibir: o processo NOVO quando Instaurado, ou o
 *  processo original (de fiscalização) em qualquer outro caso. */
export function numeroExibidoProcesso(item: ItemProcessoAndamento): string | null {
  if (item.status_triagem === 'instaurado' && item.numero_processo_sei) return item.numero_processo_sei
  return item.numero_sei
}

/** id_procedimento correspondente ao número exibido (ver numeroExibidoProcesso). */
export function idProcedimentoExibidoProcesso(item: ItemProcessoAndamento): string | null {
  if (item.status_triagem === 'instaurado' && item.id_procedimento_processo) return item.id_procedimento_processo
  return item.id_procedimento
}
