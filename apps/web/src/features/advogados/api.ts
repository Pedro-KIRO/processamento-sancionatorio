import { apiDelete, apiGet, apiPost, apiPut } from '../../api/client'

export interface Advogado {
  id: number
  nome: string
  oab: string
  email: string | null
  criado_em: string | null
}

export interface BuscaOabResult {
  encontrado: boolean
  advogado: Advogado | null
}

export function listarAdvogados(busca?: string): Promise<Advogado[]> {
  const params = busca ? `?busca=${encodeURIComponent(busca)}` : ''
  return apiGet<Advogado[]>(`/advogados${params}`)
}

export function buscarPorOab(oab: string): Promise<BuscaOabResult> {
  return apiGet<BuscaOabResult>(`/advogados/buscar-oab?oab=${encodeURIComponent(oab)}`)
}

export function criarAdvogado(nome: string, oab: string, email?: string): Promise<Advogado> {
  return apiPost<Advogado>('/advogados', { nome, oab, email: email || null })
}

export function atualizarAdvogado(id: number, nome: string, oab: string, email?: string): Promise<Advogado> {
  return apiPut<Advogado>(`/advogados/${id}`, { nome, oab, email: email || null })
}

export function excluirAdvogado(id: number): Promise<void> {
  return apiDelete(`/advogados/${id}`)
}

export function vincularAdvogadoProcesso(advogadoId: number, caixaEntradaId: number): Promise<Advogado> {
  return apiPost<Advogado>('/advogados/vincular', { advogado_id: advogadoId, caixa_entrada_id: caixaEntradaId })
}

export function listarAdvogadosProcesso(caixaEntradaId: number | string): Promise<Advogado[]> {
  return apiGet<Advogado[]>(`/advogados/processo/${caixaEntradaId}`)
}

export function desvincularAdvogadoProcesso(caixaEntradaId: number | string, advogadoId: number): Promise<void> {
  return apiDelete(`/advogados/processo/${caixaEntradaId}/${advogadoId}`)
}
