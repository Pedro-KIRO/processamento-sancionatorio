import { apiDelete, apiGet, apiPost, apiPut } from '../../api/client'

export interface Usuario {
  id: number
  email: string
  nome: string | null
  perfil: string | null
  id_unidade: string | null
  ativo: boolean
}

export function listarUsuarios(busca?: string, somenteAtivos = true): Promise<Usuario[]> {
  const params = new URLSearchParams()
  if (busca) params.set('busca', busca)
  if (!somenteAtivos) params.set('somente_ativos', 'false')
  const qs = params.toString()
  return apiGet<Usuario[]>(`/usuarios${qs ? `?${qs}` : ''}`)
}

export function criarUsuario(dados: Omit<Usuario, 'id'>): Promise<Usuario> {
  return apiPost<Usuario>('/usuarios', dados)
}

export function atualizarUsuario(id: number, dados: Omit<Usuario, 'id'>): Promise<Usuario> {
  return apiPut<Usuario>(`/usuarios/${id}`, dados)
}

export function desativarUsuario(id: number): Promise<void> {
  return apiDelete(`/usuarios/${id}`)
}
