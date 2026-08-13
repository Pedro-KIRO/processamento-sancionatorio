/**
 * Propriedades CSS que o conversor transforma em NÚMERO.
 *
 * Só estas interessam: é nelas que um valor não numérico vira `NaN` e chega até
 * o desenho do PDF.
 */
const PROPRIEDADES_NUMERICAS = new Set([
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "width",
  "max-width",
  "min-width",
  "height",
  "max-height",
  "min-height",
  "font-size",
  "border-width",
]);

/**
 * Número com unidade CSS de comprimento, ou sem unidade.
 *
 * As unidades são uma LISTA FECHADA. Aceitar qualquer sequência de letras
 * (`[a-z]*`) deixaria passar `50%x` e `12foo`, que não são comprimento válido e
 * viram `NaN` no conversor — exatamente o que esta higienização existe para
 * impedir.
 */
const VALOR_NUMERICO =
  /^-?(\d+\.?\d*|\.\d+)(px|pt|pc|em|rem|ex|ch|cm|mm|in|q|vw|vh|vmin|vmax|%)?$/i;

/**
 * Remove das declarações de estilo os valores que não podem virar número.
 *
 * MOTIVO
 *
 * `margin:auto` é o caso que aparece em todo documento do SEI, porque é como se
 * centraliza um bloco em HTML. O conversor faz `parseFloat("auto")`, obtém
 * `NaN`, e o `NaN` só estoura mais tarde, quando o renderizador vai desenhar a
 * borda de uma tabela — o erro que chega é `unsupported number: NaN`, sem dizer
 * qual propriedade nem qual elemento.
 *
 * A limpeza é por CLASSE de problema, não por caso: `auto`, `inherit`,
 * `initial`, `unset`, `fit-content` e qualquer outra palavra-chave caem na mesma
 * regra. Enumerar os valores conhecidos deixaria o próximo a descobrir em
 * produção, num documento que alguém precisa.
 *
 * O que NÃO é numérico fica intacto: `text-align:center`, `background-color`,
 * `border:1px solid #000` e `font-weight:bold` seguem para o conversor.
 */
export function sanitizarEstilo(estilo: string): string {
  return estilo
    .split(";")
    .map((declaracao) => declaracao.trim())
    .filter(Boolean)
    .filter((declaracao) => {
      const separador = declaracao.indexOf(":");
      if (separador < 0) {
        return false;
      }

      const propriedade = declaracao.slice(0, separador).trim().toLowerCase();
      if (!PROPRIEDADES_NUMERICAS.has(propriedade)) {
        return true;
      }

      // Atalho como `margin: 15pt 0` tem vários valores; um só inválido
      // contamina o conjunto, então todos precisam ser numéricos.
      const valores = declaracao
        .slice(separador + 1)
        .trim()
        .split(/\s+/)
        .filter(Boolean);

      return (
        valores.length > 0 && valores.every((v) => VALOR_NUMERICO.test(v))
      );
    })
    .join("; ");
}

/**
 * Aplica `sanitizarEstilo` em todo elemento com atributo `style`.
 *
 * Trabalha no DOM em vez de no texto porque o HTML vem do SEI, escrito ao longo
 * de anos por versões diferentes do sistema: atributo sem aspas, aspas simples e
 * `>` dentro de valor são todos possíveis, e uma expressão regular sobre o texto
 * erraria em algum deles. O `document` já existe de qualquer forma — o conversor
 * precisa de um.
 */
export function sanitizarDocumento(documento: Document): void {
  for (const elemento of Array.from(documento.querySelectorAll("[style]"))) {
    const original = elemento.getAttribute("style") ?? "";
    const limpo = sanitizarEstilo(original);

    if (limpo) {
      elemento.setAttribute("style", limpo);
    } else {
      elemento.removeAttribute("style");
    }
  }
}
