import { describe, expect, it } from "@jest/globals";

import { escaparControlesEmStrings, jsonTolerante } from "./json-tolerante";

/*
  O SEI devolve JSON com quebra de linha crua dentro de string quando alguém
  cadastrou o nome de um documento apertando Enter no meio do texto.

  Sem este tratamento, a leitura do documento falhava com erro de JSON e o
  analista via "documento não encontrado" para um documento que estava lá.
*/
describe("JSON tolerante do SEI", () => {
  describe("jsonTolerante", () => {
    it("interpreta JSON normal sem alterar nada", () => {
      expect(jsonTolerante('{"a":1,"b":"texto"}')).toEqual({
        a: 1,
        b: "texto",
      });
    });

    it("aceita quebra de linha crua dentro de string", () => {
      const cru = '{"nome":"Termo de\nInstauração"}';

      expect(jsonTolerante(cru)).toEqual({ nome: "Termo de\nInstauração" });
    });

    it("aceita retorno de carro e tabulação crus", () => {
      const cru = '{"a":"x\ry","b":"p\tq"}';

      expect(jsonTolerante(cru)).toEqual({ a: "x\ry", b: "p\tq" });
    });

    /*
      Em JSON formatado, a quebra de linha ENTRE campos é espaço em branco
      legítimo. Escapar tudo produziria texto inválido — é por isso que o
      tratamento distingue dentro e fora de string.
    */
    it("não mexe na quebra de linha entre campos", () => {
      const formatado = '{\n  "a": 1,\n  "b": 2\n}';

      expect(jsonTolerante(formatado)).toEqual({ a: 1, b: 2 });
    });

    it("preserva escape que já vinha correto", () => {
      const escapado = '{"nome":"linha 1\\nlinha 2"}';

      expect(jsonTolerante(escapado)).toEqual({ nome: "linha 1\nlinha 2" });
    });

    /*
      Aspas escapadas não podem ser confundidas com fim de string: se fossem, o
      controle de estado inverteria e o restante do texto seria tratado como se
      estivesse fora de string.
    */
    it("não confunde aspas escapadas com fim de string", () => {
      const comAspas = '{"nome":"documento \\"anexo\\"","outro":"x\ny"}';

      expect(jsonTolerante(comAspas)).toEqual({
        nome: 'documento "anexo"',
        outro: "x\ny",
      });
    });

    /*
      Quando o problema não é caractere de controle, o erro devolvido tem de ser
      o original — ele descreve a falha real, e não a da tentativa de conserto.
    */
    it("JSON genuinamente inválido continua lançando erro", () => {
      expect(() => jsonTolerante("{isso nao e json")).toThrow();
    });
  });

  describe("escaparControlesEmStrings", () => {
    it("escapa controle sem forma curta como \\u00XX", () => {
      // \u0001 é caractere de controle sem representação curta em JSON.
      const cru = '{"a":"x\u0001y"}';

      expect(escaparControlesEmStrings(cru)).toBe('{"a":"x\\u0001y"}');
    });

    it("não altera texto que já está válido", () => {
      const valido = '{"a":"tudo certo"}';

      expect(escaparControlesEmStrings(valido)).toBe(valido);
    });
  });
});
