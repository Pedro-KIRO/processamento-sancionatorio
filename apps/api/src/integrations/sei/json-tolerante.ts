/*
  Interpretação de JSON tolerante a caractere de controle cru.

  POR QUE EXISTE

  O SEI às vezes devolve JSON com quebra de linha crua DENTRO de uma string —
  aparece quando alguém cadastrou o nome de um documento apertando Enter no meio
  do texto. O `JSON.parse` recusa, porque o padrão exige que caractere de
  controle venha escapado.

  O sintoma era cruel: a leitura do documento falhava com erro de JSON inválido,
  indistinguível — para quem chamava — de documento inexistente. O analista via
  "documento não encontrado" para um documento que estava lá.

  O backend Python resolve com `json.loads(texto, strict=False)`. O JavaScript
  não tem equivalente, então o conserto é escapar os caracteres de controle que
  estejam dentro de string antes de interpretar.
*/

/**
 * Escapa caracteres de controle que aparecem DENTRO de strings do JSON.
 *
 * Precisa distinguir dentro e fora de string: em JSON formatado, a quebra de
 * linha entre dois campos é espaço em branco legítimo. Escapar tudo produziria
 * um texto inválido.
 *
 * Percorre caractere por caractere acompanhando o estado (dentro de string, após
 * barra invertida) — é o único jeito confiável, porque expressão regular não
 * distingue as duas situações.
 */
export function escaparControlesEmStrings(texto: string): string {
  let saida = "";
  let dentroDeString = false;
  let escapado = false;

  for (const caractere of texto) {
    if (escapado) {
      // Caractere já precedido de barra: passa direto, seja qual for.
      saida += caractere;
      escapado = false;
      continue;
    }

    if (caractere === "\\" && dentroDeString) {
      saida += caractere;
      escapado = true;
      continue;
    }

    if (caractere === '"') {
      dentroDeString = !dentroDeString;
      saida += caractere;
      continue;
    }

    const codigo = caractere.codePointAt(0) ?? 0;

    if (dentroDeString && codigo < 0x20) {
      switch (caractere) {
        case "\n":
          saida += "\\n";
          break;
        case "\r":
          saida += "\\r";
          break;
        case "\t":
          saida += "\\t";
          break;
        case "\b":
          saida += "\\b";
          break;
        case "\f":
          saida += "\\f";
          break;
        default:
          // Controle sem forma curta: vai como \u00XX.
          saida += `\\u${codigo.toString(16).padStart(4, "0")}`;
      }
      continue;
    }

    saida += caractere;
  }

  return saida;
}

/**
 * Interpreta JSON tolerando caractere de controle cru dentro de string.
 *
 * Tenta o caminho normal primeiro: o conserto só entra quando o texto realmente
 * tem o problema, para não pagar o custo da varredura em toda resposta.
 */
export function jsonTolerante<T>(texto: string): T {
  try {
    return JSON.parse(texto) as T;
  } catch (erro) {
    try {
      return JSON.parse(escaparControlesEmStrings(texto)) as T;
    } catch {
      // Não era caractere de controle: devolve o erro original, que descreve o
      // problema real melhor que o da segunda tentativa.
      throw erro;
    }
  }
}
