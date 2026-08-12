import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

import { Trim, TrimOuNulo } from "../../../shared/transformacoes";
import type { CorSemaforo } from "../../prazos/calculo-prazos";

export const RESULTADO_MANTIDA = "mantida";
export const RESULTADO_REFORMADA = "reformada";
export const RESULTADO_RETORNO = "retorno_fase";

export const RESULTADOS = [
  RESULTADO_MANTIDA,
  RESULTADO_REFORMADA,
  RESULTADO_RETORNO,
] as const;

export type ResultadoDecisao = (typeof RESULTADOS)[number];

export class InterposicaoDto {
  @IsBoolean({ message: "Informe se houve interposição de recurso." })
  interposto!: boolean;

  /** Data do protocolo. Ausente, usa hoje — é dela que correm os prazos. */
  @IsOptional()
  @IsString()
  data_interposicao?: string | null;
}

export class ParecerDto {
  @TrimOuNulo()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  numero_sei?: string | null;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  resumo?: string | null;
}

export class DecisaoIIDto {
  @Trim()
  @IsIn(RESULTADOS, {
    message: `Resultado inválido. Use um de: ${RESULTADOS.join(", ")}.`,
  })
  resultado!: ResultadoDecisao;

  /** Obrigatória quando o resultado é `retorno_fase`. */
  @TrimOuNulo()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  fase_retorno?: string | null;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  fundamentacao?: string | null;
}

export interface PrazoRecursoResposta {
  chave: string;
  rotulo: string;
  dias: number;
  base_legal: string;
  data_vencimento: string | null;
  dias_restantes: number | null;
  semaforo: CorSemaforo | null;
}

/** Estado do painel de recurso — snake_case, datas como "AAAA-MM-DD". */
export interface RecursoResposta {
  caixa_entrada_id: number;
  existe: boolean;
  interposto: boolean | null;
  data_interposicao: string | null;
  registrado_por: string | null;

  parecer_numero_sei: string | null;
  parecer_em: string | null;
  parecer_por: string | null;
  parecer_resumo: string | null;

  decisao_resultado: string | null;
  decisao_fase_retorno: string | null;
  decisao_fundamentacao: string | null;
  decisao_em: string | null;
  decisao_por: string | null;

  /** Prazos do recurso com semáforo, para o painel mostrar a urgência. */
  prazos: PrazoRecursoResposta[];
  /** Fases para as quais a Decisão II pode devolver o processo. */
  fases_disponiveis: string[];

  // Permissões já resolvidas, para a tela não deduzir regra.
  pode_registrar_interposicao: boolean;
  pode_emitir_parecer: boolean;
  pode_decidir: boolean;
}
