import type { Auditoria } from "@prisma/client";

/** Uma linha da trilha de auditoria — snake_case. */
export interface LinhaAuditoria {
  id: number;
  usuario: string | null;
  momento: string;
  operacao: string;
  metodo: string | null;
  caminho: string | null;
  entidade: string | null;
  registro_id: number | null;
  documento: string | null;
  status_http: number | null;
}

export interface RespostaAuditoria {
  total: number;
  registros: LinhaAuditoria[];
}

export function paraLinha(registro: Auditoria): LinhaAuditoria {
  return {
    id: registro.id,
    usuario: registro.usuario,
    momento: registro.momento.toISOString(),
    operacao: registro.operacao,
    metodo: registro.metodo,
    caminho: registro.caminho,
    entidade: registro.entidade,
    registro_id: registro.registroId,
    documento: registro.documento,
    status_http: registro.statusHttp,
  };
}

/** Severidade orienta o destaque do cartão na tela inicial. */
export type Severidade = "baixa" | "media" | "alta";

/**
 * Alerta interno. Espelha a interface `Alerta` de
 * apps/web/src/features/home/AlertasInternos.tsx — todos os campos são
 * obrigatórios lá, inclusive `itens`.
 */
export interface Alerta {
  chave: string;
  rotulo: string;
  total: number;
  severidade: Severidade;
  descricao: string;
  /** Amostra dos ids de itens da caixa de entrada envolvidos (no máximo 50). */
  itens: number[];
}
