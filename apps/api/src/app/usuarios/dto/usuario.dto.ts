import type { Usuario } from "@prisma/client";
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

import { TrimMinusculas, TrimOuNulo } from "../../../shared/transformacoes";

export class SalvarUsuarioDto {
  // TrimMinusculas vem antes de IsEmail de propósito: sem isso, e-mail com
  // espaço na ponta (comum ao copiar de planilha) seria recusado com 400.
  @TrimMinusculas()
  @IsEmail({}, { message: "Informe um e-mail válido." })
  @MaxLength(255)
  email!: string;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nome?: string | null;

  /**
   * Um dos seis perfis de perfis.ts.
   *
   * Não é validado contra a lista de propósito, para reproduzir o backend
   * Python: ele gravava o texto como veio. Perfil desconhecido é tratado como
   * analista na leitura (ver PerfisService.resolver), então valor inválido
   * degrada para o menor privilégio em vez de derrubar a requisição.
   */
  @TrimMinusculas()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  perfil?: string | null;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  id_unidade?: string | null;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

/** Saída em snake_case, como a tela espera. */
export interface UsuarioResposta {
  id: number;
  email: string;
  nome: string | null;
  perfil: string | null;
  id_unidade: string | null;
  ativo: boolean;
}

export function paraResposta(usuario: Usuario): UsuarioResposta {
  return {
    id: usuario.id,
    email: usuario.email,
    nome: usuario.nome,
    perfil: usuario.perfil,
    id_unidade: usuario.idUnidade,
    ativo: usuario.ativo,
  };
}
