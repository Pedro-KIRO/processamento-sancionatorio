/**
 * Semáforo de prazos, compartilhado pelas telas de Prazos e de Cautelares.
 *
 * O documento de negócio é explícito: "o mesmo código de cores é usado na tela
 * de prazos e na tela de cautelar, para leitura imediata da urgência". Mesmo
 * assim os mapas estavam duplicados nas duas telas, e cada cópia pintava o
 * amarelo com `secondary` — que nesta paleta é azul (#006497). Resultado: a
 * legenda dizia "Amarelo" e a tela mostrava azul, nos dois lugares.
 *
 * A faixa âmbar usa três tons do tema por um motivo prático: `atencao` tem
 * contraste suficiente para texto pequeno, `atencao-dim` é o tom saturado que
 * de fato lê como amarelo em bolinha e borda, e `atencao-container` é o fundo
 * claro das etiquetas. Um tom só não atende as três funções sem ou virar
 * ilegível ou deixar de parecer amarelo.
 *
 * Regra das faixas (Lei 10.177/1998 + documento): verde a partir de 4 dias,
 * amarelo do dia do vencimento até 3 dias antes, vermelho depois de vencido.
 */
export type Semaforo = 'verde' | 'amarelo' | 'vermelho'

/** Etiqueta de situação: fundo claro com texto escuro. */
export const CLASSE_SEMAFORO: Record<Semaforo, string> = {
  verde: 'bg-tertiary-fixed/30 text-tertiary',
  amarelo: 'bg-atencao-container text-atencao',
  vermelho: 'bg-error-container text-on-error-container',
}

/** Bolinha do semáforo — sinal puro, sem texto em cima. */
export const PONTO_SEMAFORO: Record<Semaforo, string> = {
  verde: 'bg-tertiary',
  amarelo: 'bg-atencao-dim',
  vermelho: 'bg-error',
}

/** Faixa colorida na borda esquerda da linha da tabela. */
export const BORDA_SEMAFORO: Record<Semaforo, string> = {
  verde: 'border-l-tertiary',
  amarelo: 'border-l-atencao-dim',
  vermelho: 'border-l-error',
}

/** Cor do texto da contagem regressiva. */
export const TEXTO_SEMAFORO: Record<Semaforo, string> = {
  verde: 'text-tertiary',
  amarelo: 'text-atencao',
  vermelho: 'text-error',
}

/** Fundo suave da linha inteira, para destacar quem está em atenção. */
export const FUNDO_LINHA_SEMAFORO: Record<Semaforo, string> = {
  verde: '',
  amarelo: 'bg-atencao-container/25',
  vermelho: 'bg-error-container/10',
}
