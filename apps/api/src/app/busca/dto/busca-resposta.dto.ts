/**
 * Formato de saída da pesquisa global — em **snake_case**, como o FastAPI
 * devolvia. O consumidor é `apps/web/src/components/PesquisaGlobal.tsx`, que lê
 * `caixa_entrada_id`, `numero_sei`, `razao_social` e `cnpj_cpf` direto do JSON.
 */

/** Um candidato da pesquisa, já identificado como relatório ou processo. */
export interface ResultadoBusca {
  caixa_entrada_id: number;
  /**
   * `"relatorio"` (relatório de fiscalização, ainda na triagem) ou
   * `"processo"` (processo sancionatório instaurado).
   *
   * O frontend usa este campo para decidir a tela de destino e o rótulo da
   * sugestão. Antes da existência deste endpoint a pesquisa mandava todo mundo
   * para "Processos em Andamento", o que levava à tela errada quando o número
   * pesquisado era de um relatório ainda na Caixa de Entrada.
   */
  tipo: TipoResultado;
  numero_sei: string | null;
  id_procedimento: string | null;
  razao_social: string | null;
  cnpj_cpf: string | null;
  agente_regulado: string | null;
  /** Define em qual tela o item vive — o frontend usa para montar a rota. */
  status_triagem: string | null;
}

export type TipoResultado = "relatorio" | "processo";

export const TIPO_RELATORIO: TipoResultado = "relatorio";
export const TIPO_PROCESSO: TipoResultado = "processo";

export interface RespostaBusca {
  termo: string;
  /**
   * Quantidade de itens em `resultados`, NÃO o total de registros que casam com
   * o termo.
   *
   * É o que o FastAPI devolvia (`total=len(resultados)`), então com o limite
   * padrão de 10 este número nunca passa de 10. Parece um dado de paginação e
   * não é: a pesquisa global é uma caixa de sugestões, não uma listagem
   * paginada, e o frontend só percorre `resultados`. Trocar por um COUNT real
   * mudaria o significado do campo sem que nada passasse a usá-lo.
   */
  total: number;
  resultados: ResultadoBusca[];
}

/**
 * Linha crua vinda do SQL.
 *
 * `data_recebimento` entra na consulta apenas para ordenar e não é devolvida.
 */
export interface LinhaBusca {
  id: number;
  numero_sei: string | null;
  numero_processo_sei: string | null;
  id_procedimento: string | null;
  id_procedimento_processo: string | null;
  razao_social: string | null;
  cnpj_cpf: string | null;
  agente_regulado: string | null;
  status_triagem: string | null;
}

/**
 * Remove a pontuação de máscara (`.`, `/`, `-` e espaço) de um texto.
 *
 * Note que NÃO descarta letras: normalizar `"Auto Escola"` devolve
 * `"AutoEscola"`, e é isso que faz a classificação abaixo funcionar para termos
 * textuais — nenhum número de processo contém letras, então a comparação
 * simplesmente não casa e o item é classificado como relatório.
 */
export function semMascara(texto: string | null | undefined): string {
  return (texto ?? "").replace(/[./\-\s]/g, "");
}

/** Mantém apenas os dígitos de um texto. */
export function soDigitos(texto: string | null | undefined): string {
  return String(texto ?? "").replace(/\D/g, "");
}

/**
 * Decide se a linha responde como processo sancionatório ou como relatório de
 * fiscalização.
 *
 * Um mesmo item da caixa de entrada pode ter dois números SEI: o do relatório
 * (`numero_sei`) e, se houve instauração, o do processo (`numero_processo_sei`).
 * Quem pesquisa o número do processo quer a tela do processo; quem pesquisa o
 * número do relatório quer o relatório. Sem esta desambiguação o item apareceria
 * sempre com o número do relatório, e clicar na sugestão abriria a tela errada
 * justamente no caso em que o usuário digitou o número certo.
 *
 * `termoSemMascara` vazio (pesquisa que não tem nada além de pontuação) cai em
 * relatório, que é o padrão.
 */
export function classificar(
  linha: LinhaBusca,
  termoSemMascara: string,
): ResultadoBusca {
  const casouProcesso =
    termoSemMascara.length > 0 &&
    !!linha.numero_processo_sei &&
    semMascara(linha.numero_processo_sei).includes(termoSemMascara);

  return {
    caixa_entrada_id: linha.id,
    tipo: casouProcesso ? TIPO_PROCESSO : TIPO_RELATORIO,
    numero_sei: casouProcesso ? linha.numero_processo_sei : linha.numero_sei,
    id_procedimento: casouProcesso
      ? linha.id_procedimento_processo
      : linha.id_procedimento,
    razao_social: linha.razao_social,
    cnpj_cpf: linha.cnpj_cpf,
    agente_regulado: linha.agente_regulado,
    status_triagem: linha.status_triagem,
  };
}
