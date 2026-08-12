import type { Perfil } from "../../perfis/perfis";

/**
 * Formato de saída de GET /me — em snake_case.
 *
 * Espelha o tipo `Usuario` de apps/web/src/features/me/api.ts. Todos os campos
 * são obrigatórios lá, então nenhum pode ser omitido aqui: campo ausente vira
 * `undefined` na tela e o botão correspondente desaparece sem erro nenhum.
 */
export interface MeResposta {
  email: string | null;
  nome: string | null;
  /** Vazio desde a migração: as app roles do Entra deixaram de ser a fonte. */
  roles: string[];
  /** Perfil de coordenação — decide a exibição do menu "Textos-padrão". */
  coordenador: boolean;
  perfil: Perfil | null;
  perfil_rotulo: string | null;
  /** Coordenador ou Coordenador Geral. */
  coordenacao: boolean;
  /** Aplicação, renovação e revogação de cautelar são exclusivas dele. */
  coordenador_geral: boolean;
  /** Marcar processo como prioritário para a equipe (★). */
  pode_priorizar: boolean;
  /** Atribuir/redistribuir processos e prazos entre a equipe. */
  pode_redistribuir: boolean;
}
