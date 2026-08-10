import { apiGet } from '../../api/client'
import type {
  FiltrosPrazos,
  ResponsavelPrazo,
  RespostaPrazos,
  TipoPrazo,
} from './types'

export function listarPrazos(filtros: FiltrosPrazos = {}): Promise<RespostaPrazos> {
  const p = new URLSearchParams()
  if (filtros.busca) p.set('busca', filtros.busca)
  if (filtros.agente) p.set('agente', filtros.agente)
  if (filtros.tipo) p.set('tipo', filtros.tipo)
  if (filtros.situacao) p.set('situacao', filtros.situacao)
  if (filtros.responsavel_id) p.set('responsavel_id', String(filtros.responsavel_id))
  if (filtros.priorizados) p.set('priorizados', 'true')
  if (filtros.venc_de) p.set('venc_de', filtros.venc_de)
  if (filtros.venc_ate) p.set('venc_ate', filtros.venc_ate)
  const qs = p.toString()
  return apiGet<RespostaPrazos>(`/prazos${qs ? `?${qs}` : ''}`)
}

/** Matriz de prazos: duração, base legal, gatilho e ação no vencimento. */
export function listarTiposPrazo(): Promise<TipoPrazo[]> {
  return apiGet<TipoPrazo[]>('/prazos/tipos')
}

export function listarResponsaveisPrazo(): Promise<ResponsavelPrazo[]> {
  return apiGet<ResponsavelPrazo[]>('/prazos/responsaveis')
}
