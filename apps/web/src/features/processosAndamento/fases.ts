/**
 * Rótulos das fases do processo administrativo sancionatório.
 *
 * O banco guarda a fase em formato de código (``aguardando_defesa``); aqui fica
 * a versão legível. Compartilhado entre a timeline da tela de análise e a
 * Consulta Unificada, para as duas mostrarem o mesmo texto.
 *
 * A ordem segue a sequência obrigatória das fases.
 */
export const LABELS_FASE: Record<string, string> = {
  instauracao: 'Instauração',
  aguardando_defesa: 'Aguardando Defesa Prévia',
  defesa_apresentada: 'Análise de Defesa',
  instrucao: 'Aguardando Alegações',
  aguardando_alegacoes: 'Elaborar Decisão I',
  julgamento: 'Aguardando Recurso',
  recurso: 'Decisão II',
  encerramento: 'Encerramento',
}

/** Nome legível de uma fase. Devolve o próprio código quando desconhecido. */
export function rotuloFase(fase: string | null | undefined): string {
  if (!fase) return '-'
  return LABELS_FASE[fase] ?? fase
}
