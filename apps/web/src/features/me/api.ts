import { apiGet } from '../../api/client'

/** Os seis perfis da Documentação de Negócio v3.0. */
export type Perfil =
  | 'analista'
  | 'chefe_servico'
  | 'chefe_divisao'
  | 'coordenador'
  | 'coordenador_geral'
  | 'consultoria_juridica'

export interface Usuario {
  email: string | null
  nome: string | null
  roles: string[]
  /**
   * Perfil de coordenação. Decide a exibição do menu "Textos-padrão"; a
   * autorização de verdade está no backend (`exigir_coordenador`).
   */
  coordenador: boolean
  /**
   * Permissões já resolvidas pelo backend. A tela usa isso só para não
   * oferecer botão que vai ser recusado — quem autoriza é o endpoint.
   */
  perfil: Perfil | null
  perfil_rotulo: string | null
  /** Coordenador ou Coordenador Geral. */
  coordenacao: boolean
  /** Aplicação, renovação e revogação de cautelar são exclusivas dele. */
  coordenador_geral: boolean
  /** Marcar processo como prioritário para a equipe (★). */
  pode_priorizar: boolean
  /** Atribuir/redistribuir processos e prazos entre a equipe. */
  pode_redistribuir: boolean
}

export function getMe(): Promise<Usuario> {
  return apiGet<Usuario>('/me')
}
