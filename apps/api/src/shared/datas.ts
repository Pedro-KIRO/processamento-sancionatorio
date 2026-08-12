/*
  Datas sem hora, no fuso de São Paulo.

  POR QUE ESTE ARQUIVO EXISTE

  O `Date` do JavaScript é um instante no tempo; o `date` do Python é um dia do
  calendário. Prazo processual é dia do calendário — "vence em 16/08" não tem
  hora. Misturar os dois conceitos produz erro de um dia, que em prazo legal é a
  diferença entre a certidão de decurso ser válida ou não.

  Dois cuidados que este módulo centraliza:

  1. **"Hoje" é hoje em São Paulo, não em UTC.** Às 22h de São Paulo já é o dia
     seguinte em UTC. Sem tratar isso, todo cálculo feito no fim da tarde
     apontaria um dia a mais de decurso.

  2. **Aritmética de dias em UTC.** O Prisma devolve coluna `@db.Date` como Date
     à meia-noite UTC. Somar dias usando os métodos locais atravessaria mudança
     de horário de verão e poderia devolver 23h ou 25h de diferença, movendo a
     data. Os métodos UTC não têm esse problema.
*/

const FUSO_SAO_PAULO = "America/Sao_Paulo";
const UM_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * O dia de hoje em São Paulo, como Date à meia-noite UTC.
 *
 * Usa `en-CA` porque esse locale formata como `AAAA-MM-DD`, que é exatamente o
 * que o construtor de Date interpreta como data UTC.
 */
export function hojeEmSaoPaulo(): Date {
  const formatado = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_SAO_PAULO,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return new Date(`${formatado}T00:00:00.000Z`);
}

/** Zera a hora, mantendo o dia do calendário em UTC. */
export function apenasData(valor: Date): Date {
  return new Date(
    Date.UTC(valor.getUTCFullYear(), valor.getUTCMonth(), valor.getUTCDate()),
  );
}

/** Soma dias sem risco de deslocamento por horário de verão. */
export function somarDias(data: Date, dias: number): Date {
  return new Date(data.getTime() + dias * UM_DIA_MS);
}

/**
 * Diferença em dias inteiros entre duas datas (fim - inicio).
 * Negativo quando `fim` é anterior a `inicio`.
 */
export function diferencaEmDias(inicio: Date, fim: Date): number {
  return Math.round(
    (apenasData(fim).getTime() - apenasData(inicio).getTime()) / UM_DIA_MS,
  );
}

/**
 * Sábado ou domingo?
 *
 * ATENÇÃO NA TRADUÇÃO DO PYTHON: lá `weekday()` conta 0=segunda ... 5=sábado,
 * 6=domingo, e o teste era `weekday() >= 5`. Em JavaScript `getUTCDay()` conta
 * 0=domingo ... 6=sábado. Copiar o `>= 5` daria sexta e sábado como fim de
 * semana, e domingo como dia útil.
 */
export function ehFimDeSemana(data: Date): boolean {
  const dia = data.getUTCDay();
  return dia === 0 || dia === 6;
}

/** Formata como AAAA-MM-DD, para comparar com chave de conjunto. */
export function chaveDoDia(data: Date): string {
  return apenasData(data).toISOString().slice(0, 10);
}
