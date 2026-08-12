import { describe, expect, it } from "@jest/globals";

import {
  classificar,
  CODIGOS_TEMPORARIOS,
  deRespostaHttp,
  ehFalhaDeRede,
  SeiApiError,
  SeiErroDefinitivoError,
  SeiIndisponivelError,
} from "./sei-errors";

/*
  A classificação temporário x definitivo atravessa a aplicação até a tela: o
  DespachoModal lê `detail.temporario` para decidir se mantém o botão Confirmar
  habilitado.

  Classificar errado tem consequência direta. Temporário tratado como definitivo
  faz o usuário perder o texto já digitado. Definitivo tratado como temporário
  faz o usuário tentar de novo várias vezes, e cada tentativa pode criar processo
  ou documento duplicado no SEI.
*/
describe("classificação de erros do SEI", () => {
  describe("deRespostaHttp", () => {
    it.each([429, 500, 502, 503, 504])(
      "trata HTTP %i como instabilidade temporária",
      (status) => {
        const erro = deRespostaHttp(status);

        expect(erro).toBeInstanceOf(SeiIndisponivelError);
        expect(erro.statusCode).toBe(status);
      },
    );

    it.each([400, 401, 403, 404, 409, 422])(
      "trata HTTP %i como erro definitivo",
      (status) => {
        const erro = deRespostaHttp(status);

        expect(erro).toBeInstanceOf(SeiErroDefinitivoError);
        expect(erro.statusCode).toBe(status);
      },
    );

    /*
      429 fica junto dos 5xx porque pedido recusado por excesso de chamadas volta
      a funcionar sozinho depois da espera. Tratá-lo como definitivo faria o
      analista desistir de uma operação que só precisava de alguns segundos.
    */
    it("inclui 429 entre os temporários", () => {
      expect(CODIGOS_TEMPORARIOS.has(429)).toBe(true);
    });

    it("preserva o corpo da resposta, que traz a mensagem do SEI", () => {
      const erro = deRespostaHttp(400, '{"erro":"unidade sem permissao"}');

      expect(erro.resposta).toContain("unidade sem permissao");
    });
  });

  describe("ehFalhaDeRede", () => {
    it("reconhece o timeout do AbortSignal", () => {
      const erro = new Error("The operation was aborted");
      erro.name = "AbortError";

      expect(ehFalhaDeRede(erro)).toBe(true);
    });

    it("reconhece a falha de conexão do fetch do Node", () => {
      expect(ehFalhaDeRede(new TypeError("fetch failed"))).toBe(true);
    });

    it("não confunde erro de programação com falha de rede", () => {
      expect(ehFalhaDeRede(new TypeError("x is not a function"))).toBe(false);
      expect(ehFalhaDeRede(new Error("qualquer coisa"))).toBe(false);
    });
  });

  describe("classificar", () => {
    it("falha de rede é temporária", () => {
      const erro = classificar(new TypeError("fetch failed"));

      expect(erro).toBeInstanceOf(SeiIndisponivelError);
    });

    /*
      Reclassificar um erro que já é do SEI perderia o status e o corpo que a
      camada de baixo apurou — e um definitivo poderia virar temporário.
    */
    it("erro que já é do SEI passa intacto", () => {
      const original = deRespostaHttp(404, "não encontrado");

      expect(classificar(original)).toBe(original);
    });

    it("erro inesperado não é classificado como temporário", () => {
      const erro = classificar(new Error("bug interno"));

      expect(erro).toBeInstanceOf(SeiApiError);
      expect(erro).not.toBeInstanceOf(SeiIndisponivelError);
      expect(erro).not.toBeInstanceOf(SeiErroDefinitivoError);
    });
  });
});
