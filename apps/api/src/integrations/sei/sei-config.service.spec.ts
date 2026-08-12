import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import { SeiConfigService } from "./sei-config.service";

/*
  O SEI publica três hosts com o mesmo padrão de nome, mudando só o trecho do
  meio. Chamar o host errado devolve 404, que parece "processo não existe" e manda
  quem investiga para o lado errado — por isso a derivação é testada.
*/
describe("SeiConfigService", () => {
  const ambienteOriginal = { ...process.env };

  beforeEach(() => {
    process.env.SEI_TOKEN_URL = "https://idp.sp.gov.br/token";
    process.env.SEI_CLIENT_ID = "cliente";
    process.env.SEI_CLIENT_SECRET = "segredo";
    process.env.SEI_API_BASE = "https://sei-processos.api.rota.sp.gov.br";
  });

  afterEach(() => {
    process.env = { ...ambienteOriginal };
  });

  describe("baseDa", () => {
    it("processos usa a base configurada", () => {
      const config = new SeiConfigService();

      expect(config.baseDa("processos")).toBe(
        "https://sei-processos.api.rota.sp.gov.br",
      );
    });

    it("documentos e parametros derivam trocando o trecho do nome", () => {
      const config = new SeiConfigService();

      expect(config.baseDa("documentos")).toBe(
        "https://sei-documentos.api.rota.sp.gov.br",
      );
      expect(config.baseDa("parametros")).toBe(
        "https://sei-parametros.api.rota.sp.gov.br",
      );
    });

    /*
      A derivação preserva o ambiente: apontar a base para homologação tem de
      levar os três hosts para homologação. Se documentos caísse em produção
      enquanto processos está em homologação, o teste leria documento real de
      processo de teste — o tipo de erro que ninguém percebe até acontecer.
    */
    it("preserva o ambiente de homologação nos três hosts", () => {
      process.env.SEI_API_BASE = "https://sei-processos.api-hml.rota.sp.gov.br";
      const config = new SeiConfigService();

      expect(config.baseDa("documentos")).toContain("api-hml");
      expect(config.baseDa("parametros")).toContain("api-hml");
    });
  });

  describe("configurado", () => {
    it("reconhece configuração completa", () => {
      expect(new SeiConfigService().configurado).toBe(true);
    });

    it("falta de credencial deixa a integração como não configurada", () => {
      delete process.env.SEI_CLIENT_SECRET;

      expect(new SeiConfigService().configurado).toBe(false);
    });

    /*
      A API precisa SUBIR sem as credenciais do SEI: vários domínios já migrados
      não tocam o SEI (biblioteca, usuários, auditoria) e precisam funcionar em
      desenvolvimento. Por isso o construtor não lança.
    */
    it("construir sem credencial não lança — a API tem de subir", () => {
      delete process.env.SEI_CLIENT_ID;
      delete process.env.SEI_CLIENT_SECRET;

      expect(() => new SeiConfigService()).not.toThrow();
    });

    /*
      A mensagem lista o que falta, e não apenas "não configurado": quem recebe o
      erro precisa saber qual variável preencher.
    */
    it("exigirConfigurado nomeia as variáveis que faltam", () => {
      delete process.env.SEI_CLIENT_SECRET;
      delete process.env.SEI_API_BASE;

      expect(() => new SeiConfigService().exigirConfigurado()).toThrow(
        /SEI_CLIENT_SECRET.*SEI_API_BASE|SEI_API_BASE.*SEI_CLIENT_SECRET/,
      );
    });

    it("exigirConfigurado não reclama quando está tudo preenchido", () => {
      expect(() => new SeiConfigService().exigirConfigurado()).not.toThrow();
    });
  });

  /*
    Barra no fim da base produz "//caminho" na URL montada, e o SEI responde 404.
  */
  it("remove barra no fim da base", () => {
    process.env.SEI_API_BASE = "https://sei-processos.api.rota.sp.gov.br/";

    expect(new SeiConfigService().apiBase).toBe(
      "https://sei-processos.api.rota.sp.gov.br",
    );
  });
});
