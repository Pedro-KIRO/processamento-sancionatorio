import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { SeiConfigService } from "./sei-config.service";
import {
  SeiAuthError,
  SeiErroDefinitivoError,
  SeiIndisponivelError,
} from "./sei-errors";
import { SeiHttpService } from "./sei-http.service";

/** Config completa, sem depender de variável de ambiente no teste. */
function configFalsa(): SeiConfigService {
  const apiBase = "https://sei-processos.example";

  return {
    tokenUrl: "https://idp.example/token",
    clientId: "cliente",
    clientSecret: "segredo-de-teste",
    apiBase,
    siglaSistema: "TESTE",
    identificacaoServico: "SERVICO",
    traceId: "TRACE",
    configurado: true,
    exigirConfigurado: () => undefined,
    baseDa: (api: string) =>
      api === "processos"
        ? apiBase
        : apiBase.replace("sei-processos", `sei-${api}`),
  } as unknown as SeiConfigService;
}

function resposta(
  status: number,
  corpo: unknown = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof corpo === "string" ? corpo : JSON.stringify(corpo)),
    json: async () => corpo,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

const RESPOSTA_TOKEN = resposta(200, {
  access_token: "token-de-teste",
  expires_in: 3600,
});

/**
 * Assinatura do fetch para o dublê.
 *
 * `jest.fn()` sem tipo infere os argumentos como `never`, e qualquer
 * `mockResolvedValue` passa a ser erro de compilação. Declarar a assinatura
 * resolve e ainda dá autocompletar nas asserções.
 */
type FetchFalso = jest.Mock<
  (url: string | URL, init?: RequestInit) => Promise<Response>
>;

describe("SeiHttpService", () => {
  let servico: SeiHttpService;
  let fetchFalso: FetchFalso;

  beforeEach(() => {
    servico = new SeiHttpService(configFalsa());
    fetchFalso = jest.fn<
      (url: string | URL, init?: RequestInit) => Promise<Response>
    >();
    global.fetch = fetchFalso as unknown as typeof fetch;

    // Espera instantânea: sem isso o backoff faria o teste levar 4,5s.
    jest
      .spyOn(
        servico as unknown as { esperar: (ms: number) => Promise<void> },
        "esperar",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
    ESTA É A TRAVA MAIS IMPORTANTE DO ARQUIVO.

    Uma escrita que falhou por timeout pode ter sido concluída no servidor — o
    que se perdeu foi a resposta, não a ação. Repetir criaria um segundo processo
    ou um documento duplicado no SEI, e desfazer isso é trabalho manual do
    analista.
  */
  describe("política de repetição", () => {
    it("NÃO repete escrita, mesmo em erro temporário", async () => {
      fetchFalso
        .mockResolvedValueOnce(RESPOSTA_TOKEN)
        .mockResolvedValue(resposta(503, "indisponivel"));

      await expect(
        servico.executar({
          caminho: "/processos",
          idUnidade: 1,
          metodo: "POST",
          corpo: { x: 1 },
          podeRepetir: false,
        }),
      ).rejects.toBeInstanceOf(SeiIndisponivelError);

      // 1 chamada de token + 1 única tentativa da escrita.
      expect(fetchFalso).toHaveBeenCalledTimes(2);
    });

    it("repete leitura até três vezes em erro temporário", async () => {
      fetchFalso
        .mockResolvedValueOnce(RESPOSTA_TOKEN)
        .mockResolvedValue(resposta(503, "indisponivel"));

      await expect(
        servico.executar({
          caminho: "/processos",
          idUnidade: 1,
          podeRepetir: true,
        }),
      ).rejects.toBeInstanceOf(SeiIndisponivelError);

      // 1 token + 3 tentativas.
      expect(fetchFalso).toHaveBeenCalledTimes(4);
    });

    it("para de repetir assim que a leitura tem sucesso", async () => {
      fetchFalso
        .mockResolvedValueOnce(RESPOSTA_TOKEN)
        .mockResolvedValueOnce(resposta(503))
        .mockResolvedValueOnce(resposta(200, { ok: true }));

      const saida = await servico.executar<{ ok: boolean }>({
        caminho: "/processos",
        idUnidade: 1,
        podeRepetir: true,
      });

      expect(saida).toEqual({ ok: true });
      expect(fetchFalso).toHaveBeenCalledTimes(3);
    });

    /*
      Erro definitivo não melhora com espera: repetir só atrasaria a resposta ao
      usuário em 4,5 segundos sem chance de sucesso.
    */
    it("não repete leitura em erro definitivo", async () => {
      fetchFalso
        .mockResolvedValueOnce(RESPOSTA_TOKEN)
        .mockResolvedValue(resposta(404, "não encontrado"));

      await expect(
        servico.executar({
          caminho: "/processos/1",
          idUnidade: 1,
          podeRepetir: true,
        }),
      ).rejects.toBeInstanceOf(SeiErroDefinitivoError);

      expect(fetchFalso).toHaveBeenCalledTimes(2);
    });
  });

  describe("token", () => {
    it("reaproveita o token entre chamadas", async () => {
      fetchFalso
        .mockResolvedValueOnce(RESPOSTA_TOKEN)
        .mockResolvedValue(resposta(200, {}));

      await servico.executar({ caminho: "/a", idUnidade: 1, podeRepetir: false });
      await servico.executar({ caminho: "/b", idUnidade: 1, podeRepetir: false });

      // 1 token + 2 chamadas: não autenticou duas vezes.
      expect(fetchFalso).toHaveBeenCalledTimes(3);
      expect(String(fetchFalso.mock.calls[0][0])).toBe(
        "https://idp.example/token",
      );
    });

    /*
      Dez requisições que chegam juntas com o token expirado não podem disparar
      dez autenticações. O backend Python resolve com lock de thread; aqui o
      equivalente é compartilhar a promessa em curso.
    */
    it("chamadas simultâneas autenticam uma vez só", async () => {
      fetchFalso.mockImplementation(async (url) =>
        String(url).includes("/token") ? RESPOSTA_TOKEN : resposta(200, {}),
      );

      await Promise.all([
        servico.executar({ caminho: "/a", idUnidade: 1, podeRepetir: false }),
        servico.executar({ caminho: "/b", idUnidade: 1, podeRepetir: false }),
        servico.executar({ caminho: "/c", idUnidade: 1, podeRepetir: false }),
      ]);

      const autenticacoes = fetchFalso.mock.calls.filter((c) =>
        String(c[0]).includes("/token"),
      );

      expect(autenticacoes).toHaveLength(1);
    });

    it("resposta de token sem access_token é erro de autenticação", async () => {
      fetchFalso.mockResolvedValue(resposta(200, { expires_in: 3600 }));

      await expect(
        servico.executar({ caminho: "/a", idUnidade: 1, podeRepetir: false }),
      ).rejects.toBeInstanceOf(SeiAuthError);
    });
  });

  describe("cabeçalhos e URL", () => {
    it("envia os cabeçalhos exigidos pelo SEI", async () => {
      fetchFalso
        .mockResolvedValueOnce(RESPOSTA_TOKEN)
        .mockResolvedValue(resposta(200, {}));

      await servico.executar({
        caminho: "/processos",
        idUnidade: 110053117,
        podeRepetir: false,
      });

      const cabecalhos = fetchFalso.mock.calls[1][1]?.headers as Record<
        string,
        string
      >;

      expect(cabecalhos["X-SiglaSistema"]).toBe("TESTE");
      expect(cabecalhos["X-IdentificacaoServico"]).toBe("SERVICO");
      expect(cabecalhos["X-IdUnidade"]).toBe("110053117");
      expect(cabecalhos["X-TraceId-SP"]).toBe("TRACE");
      expect(cabecalhos.Authorization).toBe("Bearer token-de-teste");
    });

    /*
      Sem esta filtragem, `?limit=undefined` chegaria ao SEI com o texto
      "undefined" e a chamada seria recusada.
    */
    it("omite parâmetro de query indefinido", async () => {
      fetchFalso
        .mockResolvedValueOnce(RESPOSTA_TOKEN)
        .mockResolvedValue(resposta(200, {}));

      await servico.executar({
        caminho: "/processos",
        idUnidade: 1,
        query: { limit: 500, start: undefined },
        podeRepetir: false,
      });

      const url = String(fetchFalso.mock.calls[1][0]);

      expect(url).toContain("limit=500");
      expect(url).not.toContain("start");
    });
  });

  /*
    Alguns endpoints do SEI respondem 204 sem corpo (receber processo, excluir
    documento). Tentar interpretar como JSON faria uma operação bem-sucedida
    parecer falha.
  */
  describe("leitura do corpo", () => {
    it("aceita 204 sem corpo", async () => {
      fetchFalso
        .mockResolvedValueOnce(RESPOSTA_TOKEN)
        .mockResolvedValue(resposta(204, ""));

      await expect(
        servico.executar({
          caminho: "/processos/1/receber",
          idUnidade: 1,
          metodo: "POST",
          podeRepetir: false,
        }),
      ).resolves.toBeUndefined();
    });

    it("aceita 200 com corpo vazio", async () => {
      fetchFalso
        .mockResolvedValueOnce(RESPOSTA_TOKEN)
        .mockResolvedValue(resposta(200, ""));

      await expect(
        servico.executar({ caminho: "/a", idUnidade: 1, podeRepetir: false }),
      ).resolves.toBeUndefined();
    });

    it("resposta não-JSON é erro claro, não dado inválido", async () => {
      fetchFalso
        .mockResolvedValueOnce(RESPOSTA_TOKEN)
        .mockResolvedValue(resposta(200, "<html>proxy</html>"));

      await expect(
        servico.executar({ caminho: "/a", idUnidade: 1, podeRepetir: false }),
      ).rejects.toThrow(/não é JSON/);
    });
  });
});
