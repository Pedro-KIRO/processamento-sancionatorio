import { describe, expect, it } from "@jest/globals";

import {
  deveAuditar,
  entidadeDoCaminho,
  idDoCaminho,
  semPrefixo,
} from "./trilha";

describe("trilha de auditoria", () => {
  describe("semPrefixo", () => {
    /*
      Quando a API passou a viver sob /api, toda linha da trilha começou a ser
      gravada com entidade "api" e o filtro por área do GET /auditoria deixou de
      encontrar qualquer coisa. A trilha continuava sendo escrita — só ficava
      impossível de consultar, que é o pior tipo de defeito em registro de
      controle interno.
    */
    it("remove o prefixo /api", () => {
      expect(semPrefixo("/api/cautelares/12/revogar")).toBe(
        "/cautelares/12/revogar",
      );
    });

    it("devolve a raiz quando o caminho é só o prefixo", () => {
      expect(semPrefixo("/api")).toBe("/");
    });

    it("não mexe em caminho que já vem sem o prefixo", () => {
      expect(semPrefixo("/health")).toBe("/health");
    });

    /*
      "/apiculture" começa com o texto "/api" mas não é uma rota sob o prefixo.
      Cortar por comparação de texto solta removeria os quatro primeiros
      caracteres e produziria entidade errada.
    */
    it("não corta caminho que apenas começa com as letras de /api", () => {
      expect(semPrefixo("/apiculture/1")).toBe("/apiculture/1");
    });
  });

  describe("entidadeDoCaminho", () => {
    it("usa o primeiro segmento depois do prefixo", () => {
      expect(entidadeDoCaminho("/api/cautelares/12/revogar")).toBe("cautelares");
      expect(entidadeDoCaminho("/api/processos-andamento/5")).toBe(
        "processos-andamento",
      );
    });

    it("devolve nulo quando não há segmento", () => {
      expect(entidadeDoCaminho("/api")).toBeNull();
      expect(entidadeDoCaminho("/")).toBeNull();
    });
  });

  describe("idDoCaminho", () => {
    it("pega o primeiro id numérico do caminho", () => {
      expect(idDoCaminho("/api/cautelares/12/revogar")).toBe(12);
      expect(idDoCaminho("/api/caixa-entrada/7/anotacoes/3")).toBe(7);
    });

    it("devolve nulo quando não há id", () => {
      expect(idDoCaminho("/api/usuarios")).toBeNull();
    });

    /*
      "processos-andamento" tem dígitos em nenhum lugar, mas nomes de rota com
      número no meio existiriam; o padrão exige a barra antes e barra ou fim
      depois, para não capturar dígito colado em palavra.
    */
    it("não confunde dígito colado em nome de rota com id", () => {
      expect(idDoCaminho("/api/relatorio2024")).toBeNull();
    });
  });

  describe("deveAuditar", () => {
    it("audita os métodos que alteram dados", () => {
      for (const metodo of ["POST", "PUT", "PATCH", "DELETE"]) {
        expect(deveAuditar(metodo, "/api/usuarios")).toBe(true);
      }
    });

    it("não audita leitura", () => {
      expect(deveAuditar("GET", "/api/usuarios")).toBe(false);
      expect(deveAuditar("HEAD", "/api/usuarios")).toBe(false);
      expect(deveAuditar("OPTIONS", "/api/usuarios")).toBe(false);
    });

    it("aceita método em minúsculas", () => {
      expect(deveAuditar("post", "/api/usuarios")).toBe(true);
    });

    /*
      /health é consultado pelo healthcheck do contêiner a cada 30 segundos. Sem
      esta exclusão, a trilha encheria de linhas sem valor de negócio e a
      consulta por período ficaria inutilizável.
    */
    it("ignora caminhos sem valor de negócio", () => {
      expect(deveAuditar("POST", "/api/health")).toBe(false);
      expect(deveAuditar("POST", "/health")).toBe(false);
      expect(deveAuditar("POST", "/api/docs")).toBe(false);
      expect(deveAuditar("POST", "/api/openapi.json")).toBe(false);
    });
  });
});
