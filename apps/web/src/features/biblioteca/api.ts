import { apiDelete, apiDeleteJson, apiGet, apiGetBlob, apiPost, apiPostForm, apiPut } from '../../api/client'
import type { FormularioBiblioteca, ItemBiblioteca } from './types'

export interface FiltrosBiblioteca {
  classificacao?: string
  tema?: string
  busca?: string
}

export function listarBiblioteca(filtros: FiltrosBiblioteca = {}): Promise<ItemBiblioteca[]> {
  const params = new URLSearchParams()
  if (filtros.classificacao) params.set('classificacao', filtros.classificacao)
  if (filtros.tema) params.set('tema', filtros.tema)
  if (filtros.busca) params.set('busca', filtros.busca)
  const query = params.toString()
  return apiGet<ItemBiblioteca[]>(`/biblioteca${query ? `?${query}` : ''}`)
}

export function obterItemBiblioteca(id: number): Promise<ItemBiblioteca> {
  return apiGet<ItemBiblioteca>(`/biblioteca/${id}`)
}

export function listarTemas(classificacao?: string): Promise<string[]> {
  const query = classificacao ? `?classificacao=${encodeURIComponent(classificacao)}` : ''
  return apiGet<string[]>(`/biblioteca/temas${query}`)
}

/** Monta o multipart do cadastro. Campo vazio não é enviado. */
function montarCorpo(dados: FormularioBiblioteca, arquivo?: File | null): FormData {
  const corpo = new FormData()
  corpo.append('classificacao', dados.classificacao)
  corpo.append('titulo', dados.titulo.trim())
  if (dados.tema.trim()) corpo.append('tema', dados.tema.trim())
  if (dados.data_referencia) corpo.append('data_referencia', dados.data_referencia)
  if (dados.link.trim()) corpo.append('link', dados.link.trim())
  if (dados.texto.trim()) corpo.append('texto', dados.texto.trim())
  if (arquivo) corpo.append('arquivo', arquivo)
  return corpo
}

/** Cadastra o item com os campos e o PDF numa única requisição. */
export function criarItemBiblioteca(
  dados: FormularioBiblioteca, arquivo?: File | null,
): Promise<ItemBiblioteca> {
  return apiPostForm<ItemBiblioteca>('/biblioteca', montarCorpo(dados, arquivo))
}

export function atualizarItemBiblioteca(
  id: number, dados: FormularioBiblioteca,
): Promise<ItemBiblioteca> {
  return apiPut<ItemBiblioteca>(`/biblioteca/${id}`, {
    classificacao: dados.classificacao,
    titulo: dados.titulo.trim(),
    tema: dados.tema.trim() || null,
    data_referencia: dados.data_referencia || null,
    link: dados.link.trim() || null,
    texto: dados.texto.trim() || null,
  })
}

export function excluirItemBiblioteca(id: number): Promise<void> {
  return apiDelete(`/biblioteca/${id}`)
}

/** Anexa ou substitui o PDF de um item já cadastrado. */
export function enviarArquivoBiblioteca(id: number, arquivo: File): Promise<ItemBiblioteca> {
  const corpo = new FormData()
  corpo.append('arquivo', arquivo)
  return apiPostForm<ItemBiblioteca>(`/biblioteca/${id}/arquivo`, corpo)
}

export function removerArquivoBiblioteca(id: number): Promise<ItemBiblioteca> {
  return apiDeleteJson<ItemBiblioteca>(`/biblioteca/${id}/arquivo`)
}

/**
 * Blob URL do PDF, para exibir no visualizador da tela.
 *
 * Quem chama é responsável por revogar a URL (URL.revokeObjectURL) ao trocar de
 * item, senão o blob fica na memória da aba até recarregar a página.
 */
export async function urlPdfBiblioteca(id: number): Promise<string> {
  const blob = await apiGetBlob(`/biblioteca/${id}/arquivo`)
  return URL.createObjectURL(blob)
}

import type { VersaoBiblioteca } from './types'

export function listarVersoes(id: number): Promise<VersaoBiblioteca[]> {
  return apiGet<VersaoBiblioteca[]>(`/biblioteca/${id}/versoes`)
}

export function restaurarVersao(id: number, numero: number): Promise<ItemBiblioteca> {
  return apiPost<ItemBiblioteca>(`/biblioteca/${id}/versoes/${numero}/restaurar`, {})
}
