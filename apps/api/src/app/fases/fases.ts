/*
  Fases do processo administrativo sancionatório, em ordem obrigatória.

  A ordem é sequencial e não pode ser pulada — quem controla isso é o backend, e
  não a tela. A fonte da verdade do fluxo é
  docs/negocio/fluxo-oficial-processo-sancionatorio.md; leia antes de mexer aqui.

  ATENÇÃO ao nome das fases: os códigos não coincidem com o que a tela mostra.
  `instrucao` é "Aguardando Alegações" e `aguardando_alegacoes` é "Elaborar
  Decisão I" — a numeração no comentário abaixo é a do fluxo oficial, e é por ela
  que a ordem se lê. Renomear parece tentador e quebraria os registros já
  gravados em `fase_processo_andamento`.
*/
export const FASES_PROCESSO = [
  "instauracao", //          1. Instauração (Termo + Citação + Cautelar)
  "aguardando_defesa", //    2. Aguardando Defesa Prévia (15 dias)
  "defesa_apresentada", //   3. Análise de Defesa (saneador)
  "instrucao", //            4. Aguardando Alegações (intimação + 7 dias)
  "aguardando_alegacoes", // 5. Elaborar Decisão I (julgamento)
  "julgamento", //           6. Aguardando Recurso (notificação + 15 dias)
  "recurso", //              7. Decisão II
  "encerramento", //         8. Encerramento
  "encerrado", //            Processo finalizado
] as const;

export type FaseProcesso = (typeof FASES_PROCESSO)[number];

/**
 * Fases que fazem sentido como destino de retorno da Decisão II.
 *
 * Só as anteriores ao recurso: devolver para "encerrado" ou para o próprio
 * "recurso" não é retorno, é outra coisa.
 */
export function fasesParaRetorno(): string[] {
  return FASES_PROCESSO.filter(
    (f) => f !== "recurso" && f !== "encerramento" && f !== "encerrado",
  );
}

export function ehFaseValida(valor: string): valor is FaseProcesso {
  return (FASES_PROCESSO as readonly string[]).includes(valor);
}
