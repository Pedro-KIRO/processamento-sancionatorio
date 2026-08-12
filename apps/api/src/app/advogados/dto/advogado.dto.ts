import type { Advogado } from "@prisma/client";
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

import {
  Trim,
  TrimMaiusculas,
  TrimOuNulo,
} from "../../../shared/transformacoes";

export class SalvarAdvogadoDto {
  // Trim antes de IsNotEmpty: sem isso, nome só com espaços ("   ") passaria a
  // validação e seria gravado como texto vazio.
  @Trim()
  @IsString()
  @IsNotEmpty({ message: "Informe o nome do advogado." })
  @MaxLength(255)
  nome!: string;

  /**
   * OAB sempre em maiúsculas — é a chave de deduplicação. Sem normalizar,
   * "sp123456" e "SP123456" criariam dois cadastros para o mesmo advogado e a
   * busca por OAB deixaria de encontrar o que já existe.
   */
  @TrimMaiusculas()
  @IsString()
  @IsNotEmpty({ message: "Informe o número da OAB." })
  @MaxLength(30)
  oab!: string;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string | null;
}

export class VincularAdvogadoDto {
  @IsInt()
  @Min(1)
  advogado_id!: number;

  @IsInt()
  @Min(1)
  caixa_entrada_id!: number;
}

/** Saída em snake_case, como a tela espera. */
export interface AdvogadoResposta {
  id: number;
  nome: string;
  oab: string;
  email: string | null;
  criado_em: string | null;
}

export function paraResposta(advogado: Advogado): AdvogadoResposta {
  return {
    id: advogado.id,
    nome: advogado.nome,
    oab: advogado.oab,
    email: advogado.email,
    criado_em: advogado.criadoEm ? advogado.criadoEm.toISOString() : null,
  };
}

/** Resposta de GET /advogados/buscar-oab. */
export interface BuscaOabResposta {
  encontrado: boolean;
  advogado: AdvogadoResposta | null;
}
