import type { CorSemaforo } from "../calculo-prazos";

/**
 * Uma linha da tela de Controle de Prazos — snake_case.
 *
 * `data_inicio` e `data_vencimento` saem como "AAAA-MM-DD", NÃO como ISO
 * completo. O Pydantic serializa `date` assim, e o tipo `PrazoLinha` do
 * frontend declara `string | null`. Mandar "2026-08-17T00:00:00.000Z" faria o
 * agrupamento do calendário comparar textos diferentes para o mesmo dia, e os
 * prazos sumiriam da grade sem erro nenhum.
 */
export interface PrazoLinha {
  id: number;
  caixa_entrada_id: number;
  /** ★ Priorização da Coordenação. */
  prioritario: boolean;
  prioridade_justificativa: string | null;
  numero_sei: string | null;
  id_procedimento: string | null;
  interessado: string | null;
  cnpj_cpf: string | null;
  agente_regulado: string | null;
  fase: string | null;
  tipo_prazo: string | null;
  base_legal: string | null;
  dias: number | null;
  data_inicio: string | null;
  data_vencimento: string | null;
  dias_restantes: number | null;
  restante_rotulo: string | null;
  semaforo: CorSemaforo | null;
  situacao_rotulo: string | null;
  responsavel: string | null;
  status: string | null;
}

export interface ResumoPrazos {
  vencidos: number;
  vence_em_3_dias: number;
  no_prazo: number;
  priorizados: number;
}

export interface RespostaPrazos {
  resumo: ResumoPrazos;
  prazos: PrazoLinha[];
  total: number;
  /** Se o usuário pode marcar/desmarcar a estrela de priorização. */
  pode_priorizar: boolean;
}

/** Filtros aceitos pela listagem. Todos opcionais. */
export interface FiltrosPrazos {
  busca?: string;
  agente?: string;
  tipo?: string;
  situacao?: string;
  responsavel_id?: number;
  priorizados?: boolean;
  venc_de?: string;
  venc_ate?: string;
  limit?: number;
  offset?: number;
}
