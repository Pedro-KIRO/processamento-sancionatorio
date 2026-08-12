/*
  Geração de CSV para as exportações de BI.

  Escrito à mão, e não com biblioteca, por ser pouca coisa — mas o escape TEM de
  estar certo: razão social com vírgula ("EMPRESA X, LTDA") partiria a linha em
  duas colunas, e o Power BI leria o CNPJ na coluna do nome sem reclamar de nada.
  É o tipo de erro que aparece semanas depois, como número que não bate.

  Regras do RFC 4180, que é o que o `csv` do Python aplica por padrão:
    - campo com vírgula, aspas ou quebra de linha vai entre aspas duplas;
    - aspas dentro do campo são dobradas;
    - nulo vira campo vazio (não a palavra "None").
*/

/** Valores que uma célula de exportação pode ter depois de serializada. */
export type ValorCelula = string | boolean | null;

const PRECISA_ASPAS = /[",\r\n]/;

function celula(valor: ValorCelula): string {
  if (valor === null || valor === undefined) return "";

  const texto = typeof valor === "boolean" ? String(valor) : valor;

  if (!PRECISA_ASPAS.test(texto)) return texto;

  return `"${texto.replace(/"/g, '""')}"`;
}

/**
 * Monta o CSV com cabeçalho.
 *
 * A ordem das colunas vem de `campos`, e não das chaves do objeto: o Power BI
 * casa coluna por posição em algumas configurações, e a ordem de chave em objeto
 * JavaScript não é garantia de contrato.
 */
export function montarCsv(
  campos: readonly string[],
  linhas: readonly Record<string, ValorCelula>[],
): string {
  const cabecalho = campos.map(celula).join(",");
  const corpo = linhas.map((linha) =>
    campos.map((campo) => celula(linha[campo] ?? null)).join(","),
  );

  // CRLF é o que o `csv` do Python usa por padrão, e é o que o Excel espera no
  // Windows. Com LF sozinho, algumas versões do Excel juntam todas as linhas.
  return [cabecalho, ...corpo].join("\r\n");
}

/**
 * Converte um valor do banco para célula de exportação.
 *
 * Reproduz o `_serializar` do backend Python, incluindo duas escolhas dele que
 * não são óbvias e fazem parte do contrato já consumido pelo BI:
 *
 *   1. **Número vira texto.** `id` sai como "12", não 12. Está assim desde a
 *      primeira versão da exportação; mudar agora alteraria o tipo da coluna no
 *      Power BI e quebraria relacionamento entre tabelas já publicadas.
 *   2. **Booleano continua booleano.** `reiniciado` sai como true/false, não
 *      "True" — o Python testa `bool` depois de `date`, e bool não é `date`.
 *
 * Sobre data e hora: o valor é gravado no fuso de São Paulo numa coluna sem
 * fuso. O `toISOString()` acrescentaria "Z", que afirmaria ser UTC e faria o BI
 * deslocar tudo em três horas. O "Z" é removido para manter o mesmo formato
 * ingênuo que o Python produz.
 */
export function serializar(valor: unknown): ValorCelula {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "boolean") return valor;

  if (valor instanceof Date) {
    return valor.toISOString().replace("Z", "");
  }

  return String(valor);
}

/** Igual a `serializar`, mas para coluna de data pura (sem hora). */
export function serializarData(valor: Date | null): ValorCelula {
  if (!valor) return null;
  return valor.toISOString().slice(0, 10);
}
