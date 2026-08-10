import { apiGet } from '../../api/client'
import type { FiltrosCaixa, ItemCaixaEntrada } from './types'

export function listarCaixaEntrada(filtros: FiltrosCaixa = {}): Promise<ItemCaixaEntrada[]> {
  const p = new URLSearchParams()
  if (filtros.busca) p.set('busca', filtros.busca)
  if (filtros.agente) p.set('agente', filtros.agente)
  if (filtros.dataInicio) p.set('data_inicio', filtros.dataInicio)
  if (filtros.dataFim) p.set('data_fim', filtros.dataFim)
  if (filtros.ordenarPor) p.set('ordenar_por', filtros.ordenarPor)
  if (filtros.ordem) p.set('ordem', filtros.ordem)
  const qs = p.toString()
  return apiGet<ItemCaixaEntrada[]>(`/caixa-entrada${qs ? `?${qs}` : ''}`)
}

export function listarAgentes(): Promise<string[]> {
  return apiGet<string[]>('/caixa-entrada/agentes')
}
