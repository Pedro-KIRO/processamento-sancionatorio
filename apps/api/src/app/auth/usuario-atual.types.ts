// Identidade do usuário autenticado, resolvida a partir de gestao_acessos_v2.tb_usuarios.
//
// Este é o único formato de identidade que circula na aplicação. Nunca confie em
// e-mail, unidade ou perfil vindos do corpo/query da requisição — sempre use os
// dados deste objeto, que vêm do banco de identidade.
export interface UsuarioAtualInfo {
  /** Id oficial do usuário no Gestão de Acessos. */
  id: number;
  /** Mesmo valor de `id`, mantido pelo nome usado no contrato da plataforma. */
  usuarioGaId: number;
  /** Nome completo do usuário. */
  nome: string;
  /** E-mail corporativo. */
  email: string;
  /** Object ID do usuário no Microsoft Entra ID (nulo em modo dev). */
  userAd: string | null;
}

// Extensão do Request do Express para carregar a identidade resolvida.
declare module "express" {
  interface Request {
    usuario?: UsuarioAtualInfo;
    /** E-mail candidato injetado pelo DevIdentityMiddleware (só em AUTH_MODE=dev). */
    devUserEmail?: string;
  }
}
