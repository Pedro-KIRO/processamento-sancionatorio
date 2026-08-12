import { apiDelete, apiGet, apiPost, apiPut } from '../../api/client'
import type {
  FiltrosTextosPadroes,
  FuncaoResumo,
  TextoPadraoDetalhe,
  TextoPadraoResumo,
} from './types'

const BASE = '/textos-padroes'

export function listarTextosPadroes(
  filtros: FiltrosTextosPadroes = {},
): Promise<TextoPadraoResumo[]> {
  const params = new URLSearchParams()
  if (filtros.agente) params.set('agente', filtros.agente)
  if (filtros.funcao) params.set('funcao', filtros.funcao)
  if (filtros.busca?.trim()) params.set('busca', filtros.busca.trim())
  if (filtros.somenteEditados) params.set('somente_editados', 'true')

  const query = params.toString()
  return apiGet<TextoPadraoResumo[]>(query ? `${BASE}?${query}` : BASE)
}

export function listarAgentes(): Promise<string[]> {
  return apiGet<string[]>(`${BASE}/agentes`)
}

export function listarFuncoes(agente?: string): Promise<FuncaoResumo[]> {
  const query = agente ? `?agente=${encodeURIComponent(agente)}` : ''
  return apiGet<FuncaoResumo[]>(`${BASE}/funcoes${query}`)
}

export function obterTextoPadrao(id: number): Promise<TextoPadraoDetalhe> {
  return apiGet<TextoPadraoDetalhe>(`${BASE}/${id}`)
}

export function salvarTextoPadrao(
  id: number,
  templateHtml: string,
): Promise<TextoPadraoDetalhe> {
  return apiPut<TextoPadraoDetalhe>(`${BASE}/${id}`, { template_html: templateHtml })
}

/** Fixa a variante como padrão. Devolve as irmãs já atualizadas. */
export function definirPadrao(id: number): Promise<TextoPadraoResumo[]> {
  return apiPost<TextoPadraoResumo[]>(`${BASE}/${id}/padrao`, {})
}

export function removerPadrao(id: number): Promise<void> {
  return apiDelete(`${BASE}/${id}/padrao`)
}

/** Volta ao texto como veio do SEI e libera a reimportação. */
export function restaurarOriginal(id: number): Promise<TextoPadraoDetalhe> {
  return apiPost<TextoPadraoDetalhe>(`${BASE}/${id}/restaurar`, {})
}

/** Altera o agente regulado de um texto-padrão. Use 'Qualquer' para global. */
export function alterarAgente(id: number, novoAgente: string): Promise<TextoPadraoResumo> {
  return apiPut<TextoPadraoResumo>(
    `${BASE}/${id}/agente?novo_agente=${encodeURIComponent(novoAgente)}`,
    {},
  )
}

/** Renomeia o rótulo (nome legível) do texto-padrão. */
export function renomearRotulo(id: number, novoRotulo: string): Promise<TextoPadraoResumo> {
  return apiPut<TextoPadraoResumo>(
    `${BASE}/${id}/rotulo?novo_rotulo=${encodeURIComponent(novoRotulo)}`,
    {},
  )
}

/** Altera o nome na árvore do SEI (tipo de documento). */
export function alterarNomeArvore(id: number, novoNome: string): Promise<TextoPadraoResumo> {
  return apiPut<TextoPadraoResumo>(
    `${BASE}/${id}/nome-arvore?novo_nome=${encodeURIComponent(novoNome)}`,
    {},
  )
}
