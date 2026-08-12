// Os seis perfis da Documentação de Negócio v3.0.
//
// ATENÇÃO — o que estes perfis são e o que NÃO são:
//
// Eles servem para a tela decidir o que MOSTRAR. A autorização de verdade é do
// PermissionGuard, contra o catálogo do Gestão de Acessos
// (.kiro/steering/permissionamento.md). Esconder botão é só para não oferecer
// ação que vai ser recusada — nunca a proteção em si.
//
// Por isso nenhum endpoint deve decidir acesso lendo perfil daqui. Use
// @RequirePermission.

export const PERFIL_ANALISTA = "analista";
export const PERFIL_CHEFE_SERVICO = "chefe_servico";
export const PERFIL_CHEFE_DIVISAO = "chefe_divisao";
export const PERFIL_COORDENADOR = "coordenador";
export const PERFIL_COORDENADOR_GERAL = "coordenador_geral";
export const PERFIL_CONSULTORIA_JURIDICA = "consultoria_juridica";

export type Perfil =
  | typeof PERFIL_ANALISTA
  | typeof PERFIL_CHEFE_SERVICO
  | typeof PERFIL_CHEFE_DIVISAO
  | typeof PERFIL_COORDENADOR
  | typeof PERFIL_COORDENADOR_GERAL
  | typeof PERFIL_CONSULTORIA_JURIDICA;

/** Rótulos de exibição, na ordem hierárquica. */
export const PERFIS: Record<Perfil, string> = {
  [PERFIL_ANALISTA]: "Conferente / Analista",
  [PERFIL_CHEFE_SERVICO]: "Chefe de Serviço",
  [PERFIL_CHEFE_DIVISAO]: "Chefe de Divisão",
  [PERFIL_COORDENADOR]: "Coordenador",
  [PERFIL_COORDENADOR_GERAL]: "Coordenador Geral",
  [PERFIL_CONSULTORIA_JURIDICA]: "Consultoria Jurídica",
};

/**
 * Perfis da Coordenação.
 *
 * Os dois níveis ficam separados porque aplicar medida cautelar é competência
 * exclusiva do Coordenador Geral (art. 62, § único, da Lei 10.177/1998).
 */
export const PERFIS_COORDENACAO: ReadonlySet<Perfil> = new Set<Perfil>([
  PERFIL_COORDENADOR,
  PERFIL_COORDENADOR_GERAL,
]);

/** Chefias. Conduzem a instrução e redistribuem trabalho na equipe. */
export const PERFIS_CHEFIA: ReadonlySet<Perfil> = new Set<Perfil>([
  PERFIL_CHEFE_SERVICO,
  PERFIL_CHEFE_DIVISAO,
]);

export function ehPerfilValido(valor: string): valor is Perfil {
  return Object.prototype.hasOwnProperty.call(PERFIS, valor);
}
