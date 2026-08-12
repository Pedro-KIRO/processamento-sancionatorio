/** Valores aceitos no filtro "Fonte dos dados" da tela. */
export const FONTE_FISCALIZACAO = "fiscalizacao";
export const FONTE_PROCESSAMENTO = "processamento";

/**
 * Uma linha da Consulta Unificada — snake_case, datas como "AAAA-MM-DD".
 */
export interface LinhaConsulta {
  id: number;
  tipo: string;
  /**
   * De onde o registro veio. NÃO é a mesma coisa que `tipo`:
   * `fiscalizacao` só existe no app de fiscalização; `processamento` já chegou à
   * nossa caixa de entrada — o que inclui o que aguarda triagem e o que foi
   * arquivado, sendo mais amplo que "tem processo instaurado".
   */
  fonte: string;
  numero_sei: string | null;
  id_procedimento: string | null;
  razao_social: string | null;
  cnpj_cpf: string | null;
  agente_regulado: string | null;
  municipio: string | null;
  ano: string | null;
  situacao: string | null;
  fase_atual: string | null;
  data_criacao_sei: string | null;
  data_ultima_acao: string | null;
  caixa_entrada_id: number | null;
}

/**
 * Página de resultados.
 *
 * `total` é a contagem COM os filtros aplicados, não só o tamanho da página —
 * a tela mostra quantos itens existem no recorte.
 */
export interface RespostaConsultaUnificada {
  total: number;
  limit: number;
  offset: number;
  linhas: LinhaConsulta[];
}

export interface FiltrosConsulta {
  busca?: string;
  tipo?: string;
  fonte?: string;
  agente?: string;
  situacao?: string;
  fase?: string;
  ano?: string;
  criacao_de?: string;
  criacao_ate?: string;
  acao_de?: string;
  acao_ate?: string;
  ordenar_por?: string;
  ordem?: string;
  limit?: number;
  offset?: number;
}
