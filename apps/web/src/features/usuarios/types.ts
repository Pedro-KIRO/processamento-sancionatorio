export interface Usuario {
  id: number
  email: string
  nome: string | null
  perfil: string | null
  id_unidade: string | null
  ativo: boolean
}

export interface UsuarioForm {
  email: string
  nome: string
  perfil: string
  id_unidade: string
  ativo: boolean
}
