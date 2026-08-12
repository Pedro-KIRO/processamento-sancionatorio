import { IsOptional, IsString } from "class-validator";

import { TrimOuNulo } from "../../../shared/transformacoes";

/**
 * Classificações aceitas, com o rótulo que a tela mostra.
 *
 * São fixas porque correspondem a fontes distintas de autoridade: o que a norma
 * manda, como a Consultoria Jurídica leu a norma, a posição técnica da área e o
 * que já foi decidido administrativamente.
 *
 * A ordem do objeto é a ordem em que a tela lista — o endpoint de
 * classificações devolve nesta sequência, não em ordem alfabética.
 *
 * ATENÇÃO: são QUATRO. A docstring do backend Python diz "três classificações",
 * mas o código de lá tem quatro — `decisao_administrativa` entrou depois e o
 * comentário não acompanhou. O código é a fonte da verdade.
 */
export const CLASSIFICACOES: Record<string, string> = {
  estoque_normativo: "Estoque normativo",
  parecer_cj: "Pareceres da Consultoria Jurídica",
  nota_tecnica: "Notas técnicas",
  decisao_administrativa: "Decisões Administrativas",
};

/** Teto do PDF anexado. Mesmo limite do upload de medida cautelar. */
export const TAMANHO_MAXIMO_ARQUIVO = 10 * 1024 * 1024;

export const MIMES_PDF = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/acrobat",
]);

/**
 * Edição de um item do acervo.
 *
 * O cadastro é multipart (por causa do PDF) e por isso não usa este DTO — as
 * regras de título, link e classificação valem para os dois caminhos e ficam em
 * `validarCampos`, no service, em vez de em metade deles.
 */
export class AtualizarItemDto {
  @IsString()
  classificacao!: string;

  @IsString()
  titulo!: string;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  tema?: string | null;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  data_referencia?: string | null;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  link?: string | null;

  @TrimOuNulo()
  @IsOptional()
  @IsString()
  texto?: string | null;
}

/** Item na listagem: SEM o texto e SEM os bytes do PDF. */
export interface ItemResumo {
  id: number;
  classificacao: string;
  classificacao_label: string;
  titulo: string;
  tema: string | null;
  data_referencia: string | null;
  link: string | null;
  arquivo_nome: string | null;
  arquivo_tamanho: number | null;
  tem_texto: boolean;
  tem_arquivo: boolean;
  autor: string | null;
  versao_atual: number;
  criado_em: string | null;
  atualizado_em: string | null;
}

/** Item aberto na tela: inclui o texto. */
export interface ItemDetalhe extends ItemResumo {
  texto: string | null;
}

/** Uma versão no histórico de edições. */
export interface VersaoResposta {
  id: number;
  numero: number;
  autor: string | null;
  criado_em: string | null;
  titulo: string | null;
  classificacao: string | null;
  tema: string | null;
  data_referencia: string | null;
  link: string | null;
  texto: string | null;
}
