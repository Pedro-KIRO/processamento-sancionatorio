import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

import { Trim, TrimOuNulo } from "../../../shared/transformacoes";
import type { CorSemaforo } from "../../prazos/calculo-prazos";

export class CriarCautelarDto {
  /**
   * Um dos dois vínculos é obrigatório (verificado no service, porque depende
   * de um em relação ao outro). `caixa_entrada_id` é o do fluxo real do app;
   * `processo_id` fica para a base migrada do SharePoint.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  processo_id?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  caixa_entrada_id?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  agente_id?: number | null;

  @Trim()
  @IsString()
  @IsNotEmpty({ message: "Informe o tipo da medida cautelar." })
  @MaxLength(120)
  tipo!: string;

  /** 30, 45, 60 ou 90 — validado no service contra PRAZOS_CAUTELAR. */
  @IsInt()
  prazo_dias!: number;

  @IsString()
  @IsNotEmpty({ message: "Informe a data de início da medida." })
  data_inicio!: string;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  fundamentacao?: string | null;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  unidade_responsavel?: string | null;
}

export class RenovarCautelarDto {
  /** Novo prazo: 30, 45, 60 ou 90. */
  @IsInt()
  prazo_dias!: number;
}

export class RecusarCautelarDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: "Informe o motivo da recusa." })
  motivo!: string;
}

export class RevogarCautelarDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: "Informe a fundamentação da revogação." })
  motivo!: string;
}

/** Uma cautelar como a tela consome — snake_case, datas "AAAA-MM-DD". */
export interface CautelarResposta {
  id: number;
  processo_id: number | null;
  caixa_entrada_id: number | null;
  agente_id: number | null;
  tipo: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  prazo_dias: number | null;
  situacao: string | null;
  fundamentacao: string | null;
  unidade_responsavel: string | null;
  numero_sei_certidao: string | null;
  renovada_de_id: number | null;
  criado_em: string | null;

  // Concordância do Coordenador Geral
  aprovacao: string | null;
  aprovada_por: string | null;
  motivo_recusa: string | null;
  pendente_assinatura: boolean;
  link_bloco_sei: string | null;

  // Revogação
  data_revogacao: string | null;
  revogada_por: string | null;
  motivo_revogacao: string | null;
  numero_sei_certidao_desbloqueio: string | null;

  // Campos computados
  dias_restantes: number | null;
  /** verde | amarelo | vermelho — mesmo semáforo da tela de prazos. */
  semaforo: CorSemaforo | null;
  /** ativo | revisar | revogado — estado do bloqueio do agente. */
  status_bloqueio: string | null;
  /** ⚑ Agente bloqueado apresentou defesa: exige revisão imediata da medida. */
  defesa_apresentada: boolean;
  numero_sei_processo: string | null;
  razao_social: string | null;
  cnpj_cpf: string | null;
  agente_regulado: string | null;
  prioritario: boolean;
}

/** Cartões do painel, conforme a Figura 2 do documento de negócio. */
export interface ResumoCautelares {
  vigentes: number;
  /** Vencendo em até 3 dias (mesmo limiar do semáforo de prazos). */
  vencendo: number;
  /** Vencidas e sem renovação. */
  vencidas: number;
  /** ⚑ Defesa apresentada — revisar cautelar. */
  defesa_apresentada: number;
  /** Aguardando concordância do Coordenador Geral. */
  aguardando_aprovacao: number;
}

/** Resposta das rotas de certidão. */
export interface RespostaCertidao {
  sucesso: boolean;
  mensagem: string;
  cautelar_id: number;
}
