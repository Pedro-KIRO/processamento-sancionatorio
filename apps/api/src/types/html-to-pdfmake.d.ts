/**
 * Declaração local de `html-to-pdfmake`, que não publica tipos e não tem
 * pacote em `@types`.
 *
 * Declara só o que este projeto usa, em vez de `any` no módulo inteiro: assim o
 * modo estrito continua valendo na chamada, e trocar a biblioteca ou a versão
 * quebra a compilação em vez de quebrar em produção.
 */
declare module "html-to-pdfmake" {
  interface OpcoesHtmlParaPdfmake {
    /** Objeto `window` — no servidor, o do jsdom. */
    window: Window;
    /** Remove os espaços em branco que virariam linha vazia no PDF. */
    removeExtraBlanks?: boolean;
    /** Propriedades CSS a descartar, ex.: `["font-family"]`. */
    ignoreStyles?: string[];
    defaultStyles?: Record<string, unknown>;
    fontSizes?: number[];
  }

  /**
   * Converte HTML na definição de conteúdo do pdfmake.
   *
   * O retorno é a estrutura que vai em `content`; a forma exata depende do HTML,
   * por isso `unknown` em vez de um tipo inventado.
   */
  export default function htmlParaPdfmake(
    html: string,
    opcoes: OpcoesHtmlParaPdfmake,
  ): unknown;
}
