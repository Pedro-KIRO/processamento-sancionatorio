import { describe, expect, it } from "@jest/globals";

import { montarCsv, serializar, serializarData } from "./csv";

describe("exportação para BI", () => {
  describe("montarCsv", () => {
    it("gera cabeçalho e linhas na ordem dos campos declarados", () => {
      const csv = montarCsv(
        ["id", "nome"],
        [{ id: "1", nome: "ALFA" }, { id: "2", nome: "BETA" }],
      );

      expect(csv).toBe("id,nome\r\n1,ALFA\r\n2,BETA");
    });

    /*
      A razão social com vírgula é o caso que mais aparece na base
      ("EMPRESA X, LTDA"). Sem aspas, a linha ganharia uma coluna extra e o BI
      leria o campo seguinte na coluna errada — sem erro nenhum, só número que
      não bate semanas depois.
    */
    it("põe entre aspas o campo que tem vírgula", () => {
      const csv = montarCsv(
        ["nome", "cnpj"],
        [{ nome: "EMPRESA X, LTDA", cnpj: "12345678000190" }],
      );

      expect(csv).toBe('nome,cnpj\r\n"EMPRESA X, LTDA",12345678000190');
    });

    it("dobra as aspas de dentro do campo", () => {
      const csv = montarCsv(
        ["obs"],
        [{ obs: 'Consta a expressão "sem efeito"' }],
      );

      expect(csv).toBe('obs\r\n"Consta a expressão ""sem efeito"""');
    });

    it("põe entre aspas o campo com quebra de linha", () => {
      const csv = montarCsv(["obs"], [{ obs: "linha 1\nlinha 2" }]);

      expect(csv).toBe('obs\r\n"linha 1\nlinha 2"');
    });

    it("nulo vira campo vazio, não a palavra nula", () => {
      const csv = montarCsv(["a", "b"], [{ a: null, b: "x" }]);

      expect(csv).toBe("a,b\r\n,x");
    });

    it("campo ausente no objeto também vira vazio", () => {
      const csv = montarCsv(["a", "b"], [{ a: "x" }]);

      expect(csv).toBe("a,b\r\nx,");
    });

    it("usa CRLF, que é o que o Excel no Windows espera", () => {
      const csv = montarCsv(["a"], [{ a: "1" }]);

      expect(csv).toContain("\r\n");
    });

    it("com lista vazia devolve só o cabeçalho", () => {
      expect(montarCsv(["a", "b"], [])).toBe("a,b");
    });
  });

  describe("serializar", () => {
    it("nulo continua nulo", () => {
      expect(serializar(null)).toBeNull();
      expect(serializar(undefined)).toBeNull();
    });

    /*
      Duas escolhas herdadas do backend Python que fazem parte do contrato já
      consumido pelo Power BI. Mudar qualquer uma alteraria o tipo da coluna e
      quebraria relacionamento entre tabelas já publicadas.
    */
    it("número vira texto, como no backend Python", () => {
      expect(serializar(12)).toBe("12");
      expect(serializar(0)).toBe("0");
    });

    it("booleano continua booleano, não vira texto", () => {
      expect(serializar(true)).toBe(true);
      expect(serializar(false)).toBe(false);
    });

    /*
      O valor é gravado no fuso de São Paulo em coluna sem fuso. Acrescentar "Z"
      afirmaria ser UTC, e o BI deslocaria tudo em três horas.
    */
    it("data e hora saem sem o sufixo Z", () => {
      const resultado = serializar(new Date("2026-08-12T13:24:49.810Z"));

      expect(resultado).toBe("2026-08-12T13:24:49.810");
      expect(resultado).not.toContain("Z");
    });
  });

  describe("serializarData", () => {
    it("coluna de data pura sai como AAAA-MM-DD", () => {
      expect(serializarData(new Date("2026-08-12T00:00:00.000Z"))).toBe(
        "2026-08-12",
      );
    });

    it("nulo continua nulo", () => {
      expect(serializarData(null)).toBeNull();
    });
  });
});
