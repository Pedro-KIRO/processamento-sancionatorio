// Importa de "@jest/globals" em vez de usar as globais do Jest — ver a nota em
// anotacoes.service.spec.ts.
import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { PDFDocument } from "pdf-lib";

import { HtmlParaPdfService } from "../../integrations/pdf/html-para-pdf.service";
import { CacheSeiService } from "../../integrations/sei/cache-sei.service";
import { SeiNaoConfiguradoError } from "../../integrations/sei/sei-errors";
import { SeiService } from "../../integrations/sei/sei.service";
import { PrismaService } from "../../shared/prisma.service";
import { DocumentosService } from "./documentos.service";
import {
  extensaoPorContentType,
  extrairNomeDaDescricao,
  extrairNumeroDocumento,
  nomeArquivoSeguro,
} from "./dto/documento.dto";

/** Andamento como o SEI devolve, no recorte que a listagem usa. */
function andamento(
  idTarefa: string,
  numero: string,
  over: Record<string, unknown> = {},
) {
  return {
    idTarefa,
    descricao: `Gerado documento público ${numero} (RELATORIO DE FISCALIZACAO), assinado`,
    dataHora: "15/03/2026 10:30:00",
    atributoAndamento: [{ nome: "DOCUMENTO", valor: numero }],
    ...over,
  };
}

function prismaFalso() {
  return {
    caixaEntrada: { findUnique: jest.fn() },
    configUnidade: { findFirst: jest.fn() },
  };
}

function seiFalso() {
  return {
    listarAndamentos: jest.fn(),
    consultarDocumento: jest.fn(),
    baixarConteudo: jest.fn(),
    baixarAnexo: jest.fn(),
    enviarArquivo: jest.fn(),
    incluirDocumentoExterno: jest.fn(),
  };
}

/**
 * PDF real de uma página.
 *
 * Os testes de junção precisam de PDF que o pdf-lib consiga abrir — um buffer
 * qualquer cairia no caminho de falha e não exercitaria a concatenação.
 */
let pdfDeUmaPagina: Buffer;

/** Cache dublê que nunca tem nada guardado, para exercitar o caminho real. */
function cacheFalso() {
  return {
    chaveDocumento: (n: string) => `doc:${n}`,
    chaveListaDocumentos: (p: string) => `docs:${p}`,
    chaveHistorico: (p: string, m: string) => `hist:${p}:${m}`,
    obter: jest.fn(async () => null),
    gravar: jest.fn(async () => undefined),
    invalidar: jest.fn(async () => undefined),
    invalidarProcesso: jest.fn(async () => undefined),
  };
}

// ===========================================================================
// Funções puras
// ===========================================================================

describe("extrairNumeroDocumento", () => {
  it("lê o atributo de nome DOCUMENTO", () => {
    expect(
      extrairNumeroDocumento({
        atributoAndamento: [
          { nome: "UNIDADE", valor: "X" },
          { nome: "DOCUMENTO", valor: "12345678" },
        ],
      }),
    ).toBe("12345678");
  });

  it("aceita o nome do atributo em qualquer caixa", () => {
    expect(
      extrairNumeroDocumento({
        atributoAndamento: [{ nome: "documento", valor: "999" }],
      }),
    ).toBe("999");
  });

  /*
    O SEI alterna entre `atributoAndamento` e `atributos` conforme a versão do
    andamento. Ler só um dos dois faria metade dos documentos desaparecer da aba.
  */
  it("aceita a variação `atributos`", () => {
    expect(
      extrairNumeroDocumento({
        atributos: [{ nome: "DOCUMENTO", valor: "555" }],
      }),
    ).toBe("555");
  });

  it("cai para protocoloProcedimento quando não há atributo", () => {
    expect(
      extrairNumeroDocumento({
        atributoAndamento: [],
        documento: [{ protocoloProcedimento: "777" }],
      }),
    ).toBe("777");
  });

  it("devolve nulo quando não há número em lugar nenhum", () => {
    expect(extrairNumeroDocumento({})).toBeNull();
    expect(
      extrairNumeroDocumento({
        atributoAndamento: [{ nome: "DOCUMENTO", valor: "   " }],
      }),
    ).toBeNull();
  });
});

describe("extrairNomeDaDescricao", () => {
  it("usa o trecho entre parênteses", () => {
    expect(
      extrairNomeDaDescricao(
        "Gerado documento público 123 (RELATORIO DE FISCALIZACAO), assinado",
        "123",
      ),
    ).toBe("RELATORIO DE FISCALIZACAO");
  });

  it("cai no número quando não há parênteses", () => {
    expect(extrairNomeDaDescricao("Documento gerado", "123")).toBe(
      "Documento 123",
    );
  });

  it("cai no número quando os parênteses estão vazios", () => {
    expect(extrairNomeDaDescricao("Gerado 123 ()", "123")).toBe("Documento 123");
  });

  it("cai no número quando a descrição não é texto", () => {
    expect(extrairNomeDaDescricao(undefined, "123")).toBe("Documento 123");
  });
});

describe("extensaoPorContentType", () => {
  it("reconhece os tipos comuns do acervo", () => {
    expect(extensaoPorContentType("application/pdf")).toBe(".pdf");
    expect(extensaoPorContentType("text/html; charset=iso-8859-1")).toBe(
      ".html",
    );
    expect(
      extensaoPorContentType(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe(".xlsx");
  });

  it("cai em .bin no tipo desconhecido", () => {
    expect(extensaoPorContentType("application/x-coisa")).toBe(".bin");
  });
});

describe("nomeArquivoSeguro", () => {
  /*
    O nome vem do SEI e entra entre aspas no Content-Disposition. Aspas ou
    quebra de linha permitiriam fechar o cabeçalho e injetar outro; barra
    permitiria escapar do diretório na hora de salvar.
  */
  it("neutraliza aspas, quebra de linha e barra", () => {
    expect(nomeArquivoSeguro('rel"atorio')).toBe("rel_atorio");
    expect(nomeArquivoSeguro("rel\natorio")).toBe("rel_atorio");
    expect(nomeArquivoSeguro("../../etc/passwd")).toBe(".._.._etc_passwd");
  });

  it("preserva acento, espaço, ponto, hífen e sublinhado", () => {
    expect(nomeArquivoSeguro("Relatório de Fiscalização-2024_v1.pdf")).toBe(
      "Relatório de Fiscalização-2024_v1.pdf",
    );
  });

  it("nunca devolve nome vazio", () => {
    expect(nomeArquivoSeguro("///")).toBe("___");
    expect(nomeArquivoSeguro("   ")).toBe("documento");
  });
});

// ===========================================================================
// Service
// ===========================================================================

describe("DocumentosService", () => {
  let prisma: ReturnType<typeof prismaFalso>;
  let sei: ReturnType<typeof seiFalso>;
  let cache: ReturnType<typeof cacheFalso>;
  let html: { converter: ReturnType<typeof jest.fn> };
  let service: DocumentosService;

  beforeAll(async () => {
    const documento = await PDFDocument.create();
    documento.addPage([595, 842]);
    pdfDeUmaPagina = Buffer.from(await documento.save());
  });

  beforeEach(() => {
    prisma = prismaFalso();
    sei = seiFalso();
    cache = cacheFalso();
    html = { converter: jest.fn() };
    service = new DocumentosService(
      prisma as unknown as PrismaService,
      sei as unknown as SeiService,
      cache as unknown as CacheSeiService,
      html as unknown as HtmlParaPdfService,
    );
  });

  describe("listarPorItemCaixaEntrada", () => {
    it("dá 404 quando o item não existe", async () => {
      prisma.caixaEntrada.findUnique.mockResolvedValue(null as never);

      await expect(service.listarPorItemCaixaEntrada(999)).rejects.toThrow(
        NotFoundException,
      );
      expect(sei.listarAndamentos).not.toHaveBeenCalled();
    });

    /*
      Lista vazia, não 404: o item existe e apenas nunca foi vinculado a um
      processo no SEI. Devolver 404 faria a tela dizer que o relatório não
      existe.
    */
    it("devolve lista vazia quando o item não tem procedimento", async () => {
      prisma.caixaEntrada.findUnique.mockResolvedValue({
        id: 1,
        idProcedimento: null,
        idUnidadeSei: null,
        agenteRegulado: null,
      } as never);

      expect(await service.listarPorItemCaixaEntrada(1)).toEqual([]);
      expect(sei.listarAndamentos).not.toHaveBeenCalled();
    });

    it("usa a unidade gravada no item", async () => {
      prisma.caixaEntrada.findUnique.mockResolvedValue({
        id: 1,
        idProcedimento: "PROC-1",
        idUnidadeSei: "110053117",
        agenteRegulado: "Autoescola",
      } as never);
      sei.listarAndamentos.mockResolvedValue({ Andamentos: [] } as never);

      await service.listarPorItemCaixaEntrada(1);

      expect(sei.listarAndamentos).toHaveBeenCalledWith(
        "PROC-1",
        "110053117",
        expect.anything(),
      );
      // Já sabendo a unidade, não consulta a configuração.
      expect(prisma.configUnidade.findFirst).not.toHaveBeenCalled();
    });

    it("cai na unidade configurada para o agente quando o item não tem", async () => {
      prisma.caixaEntrada.findUnique.mockResolvedValue({
        id: 1,
        idProcedimento: "PROC-1",
        idUnidadeSei: null,
        agenteRegulado: "Autoescola",
      } as never);
      prisma.configUnidade.findFirst.mockResolvedValue({
        idUnidade: "110051042",
      } as never);
      sei.listarAndamentos.mockResolvedValue({ Andamentos: [] } as never);

      await service.listarPorItemCaixaEntrada(1);

      expect(sei.listarAndamentos).toHaveBeenCalledWith(
        "PROC-1",
        "110051042",
        expect.anything(),
      );
    });
  });

  describe("listarPorProcedimento", () => {
    it("filtra pelas tarefas de documento", async () => {
      sei.listarAndamentos.mockResolvedValue({ Andamentos: [] } as never);

      await service.listarPorProcedimento("PROC-1", "110053117");

      expect(sei.listarAndamentos).toHaveBeenCalledWith(
        "PROC-1",
        "110053117",
        expect.objectContaining({ tarefas: "2,13,33", tipoHistorico: "Z" }),
      );
    });

    it("classifica tarefa 2 como interno e 13 como externo", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("13", "222"), andamento("2", "111")],
      } as never);

      const docs = await service.listarPorProcedimento("PROC-1", "110053117");

      expect(docs.map((d) => [d.numero, d.tipo])).toEqual([
        ["111", "interno"],
        ["222", "externo"],
      ]);
    });

    /*
      A tarefa 33 é exclusão. Sem removê-la da lista, a aba mostraria documento
      que já não está no processo, e clicar nele daria erro do SEI.
    */
    it("remove da lista o documento excluído pela tarefa 33", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [
          andamento("33", "111"),
          andamento("2", "111"),
          andamento("2", "222"),
        ],
      } as never);

      const docs = await service.listarPorProcedimento("PROC-1", "110053117");

      expect(docs.map((d) => d.numero)).toEqual(["222"]);
    });

    /*
      Os andamentos chegam do mais recente para o mais antigo, e a aba mostra em
      ordem cronológica.
    */
    it("devolve em ordem cronológica", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [
          andamento("2", "333"),
          andamento("2", "222"),
          andamento("2", "111"),
        ],
      } as never);

      const docs = await service.listarPorProcedimento("PROC-1", "110053117");

      expect(docs.map((d) => d.numero)).toEqual(["111", "222", "333"]);
    });

    /*
      Um documento tem mais de um andamento (geração, assinatura). O primeiro
      que aparece é o mais recente; contar todos duplicaria a linha na aba.
    */
    it("não repete documento com vários andamentos", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("2", "111"), andamento("2", "111")],
      } as never);

      const docs = await service.listarPorProcedimento("PROC-1", "110053117");

      expect(docs).toHaveLength(1);
    });

    it("ignora andamento sem número de documento", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [
          { idTarefa: "2", descricao: "sem atributo" },
          andamento("2", "111"),
        ],
      } as never);

      const docs = await service.listarPorProcedimento("PROC-1", "110053117");

      expect(docs.map((d) => d.numero)).toEqual(["111"]);
    });

    /*
      A aba de documentos é uma entre várias na tela de análise. Propagar a falha
      do SEI apagaria a tela inteira; devolver o que já foi montado mostra os
      documentos das páginas anteriores.
    */
    it("devolve o que já montou quando o SEI falha", async () => {
      sei.listarAndamentos
        .mockResolvedValueOnce({
          Andamentos: Array.from({ length: 100 }, (_, i) =>
            andamento("2", String(i + 1)),
          ),
        } as never)
        .mockRejectedValueOnce(new Error("SEI fora do ar") as never);

      const docs = await service.listarPorProcedimento("PROC-1", "110053117");

      expect(docs).toHaveLength(100);
    });

    it("para de paginar quando a página vem incompleta", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("2", "111")],
      } as never);

      await service.listarPorProcedimento("PROC-1", "110053117");

      expect(sei.listarAndamentos).toHaveBeenCalledTimes(1);
    });

    /*
      `start` é índice de PÁGINA na API do SEI, não deslocamento de itens.
      Somar 100 pediria a página 100 e pularia 99 páginas de documentos.
    */
    it("avança a página de um em um", async () => {
      sei.listarAndamentos
        .mockResolvedValueOnce({
          Andamentos: Array.from({ length: 100 }, (_, i) =>
            andamento("2", String(i + 1)),
          ),
        } as never)
        .mockResolvedValueOnce({ Andamentos: [andamento("2", "999")] } as never);

      await service.listarPorProcedimento("PROC-1", "110053117");

      expect(sei.listarAndamentos.mock.calls[0][2]).toMatchObject({ start: 0 });
      expect(sei.listarAndamentos.mock.calls[1][2]).toMatchObject({ start: 1 });
    });

    it("devolve o que está no cache sem chamar o SEI", async () => {
      cache.obter.mockResolvedValue([
        { numero: "111", nome: "X", tipo: "interno", data_geracao: null },
      ] as never);

      const docs = await service.listarPorProcedimento("PROC-1", "110053117");

      expect(docs).toHaveLength(1);
      expect(sei.listarAndamentos).not.toHaveBeenCalled();
    });

    it("não guarda lista vazia no cache", async () => {
      sei.listarAndamentos.mockResolvedValue({ Andamentos: [] } as never);

      await service.listarPorProcedimento("PROC-1", "110053117");

      expect(cache.gravar).not.toHaveBeenCalled();
    });

    /*
      A trava que separa "SEI instável" de "credencial faltando".

      Sem ela, esquecer SEI_CLIENT_ID em homologação apareceria como "este
      processo não tem documentos", e ninguém procuraria variável de ambiente a
      partir desse sintoma. Com ela, a resposta é 503 nomeando o que falta.
    */
    it("propaga falta de configuração em vez de devolver lista vazia", async () => {
      sei.listarAndamentos.mockRejectedValue(
        new SeiNaoConfiguradoError(
          "Integração com o SEI não configurada. Falta preencher no .env: SEI_CLIENT_ID.",
        ) as never,
      );

      await expect(
        service.listarPorProcedimento("PROC-1", "110053117"),
      ).rejects.toMatchObject({ status: 503 });
    });

    it("cita a variável que falta na mensagem de erro", async () => {
      sei.listarAndamentos.mockRejectedValue(
        new SeiNaoConfiguradoError("Falta preencher no .env: SEI_CLIENT_ID.") as never,
      );

      await expect(
        service.listarPorProcedimento("PROC-1", "110053117"),
      ).rejects.toThrow(/SEI_CLIENT_ID/);
    });
  });

  describe("obterConteudo", () => {
    beforeEach(() => {
      sei.consultarDocumento.mockResolvedValue({
        nomeArvore: "RELATORIO DE FISCALIZACAO",
      } as never);
    });

    it("baixa o conteúdo interno e repassa como o SEI devolveu", async () => {
      sei.baixarConteudo.mockResolvedValue({
        idDocumento: "1",
        conteudo: "PGh0bWw+",
      } as never);

      const r = await service.obterConteudo("111", "interno", "110053117");

      expect(r).toEqual({
        numero: "111",
        nome: "RELATORIO DE FISCALIZACAO",
        tipo: "interno",
        conteudo: { idDocumento: "1", conteudo: "PGh0bWw+" },
      });
      expect(sei.baixarAnexo).not.toHaveBeenCalled();
    });

    /*
      O cliente do SEI devolve Buffer para não inflar a memória, mas a tela lê
      base64 no campo `conteudo`. A conversão acontece só aqui.
    */
    it("converte o anexo externo para base64 no formato da tela", async () => {
      sei.baixarAnexo.mockResolvedValue({
        bytes: Buffer.from("%PDF-1.4"),
        contentType: "application/pdf",
      } as never);

      const r = await service.obterConteudo("222", "externo", "110053117");

      expect(r.tipo).toBe("externo");
      expect(r.conteudo).toEqual({
        conteudo: Buffer.from("%PDF-1.4").toString("base64"),
        content_type: "application/pdf",
        tamanho: 8,
      });
    });

    /*
      O frontend manda `tipo=` vazio quando não acha o documento na lista, e o
      controller traduz isso para nulo. Tentar interno e cair para anexo é o que
      mantém o download funcionando nesse caso.
    */
    it("tenta interno e cai para anexo quando o tipo não é informado", async () => {
      sei.baixarConteudo.mockRejectedValue(new Error("não é interno") as never);
      sei.baixarAnexo.mockResolvedValue({
        bytes: Buffer.from("x"),
        contentType: "application/pdf",
      } as never);

      const r = await service.obterConteudo("222", null, "110053117");

      expect(r.tipo).toBe("externo");
      expect(sei.baixarConteudo).toHaveBeenCalled();
    });

    it("devolve o que está no cache sem chamar o SEI", async () => {
      cache.obter.mockResolvedValue({
        numero: "111",
        nome: "X",
        tipo: "interno",
        conteudo: "abc",
      } as never);

      const r = await service.obterConteudo("111", "interno", "110053117");

      expect(r.nome).toBe("X");
      expect(sei.consultarDocumento).not.toHaveBeenCalled();
    });
  });

  describe("resolução de unidade", () => {
    /*
      O SEI só entrega documento à unidade em que o processo está aberto, e não
      informa qual é. Sem a tentativa em sequência, todo documento de unidade
      diferente da primeira falharia.
    */
    it("tenta as demais unidades quando o palpite falha", async () => {
      sei.consultarDocumento
        .mockRejectedValueOnce(new Error("500") as never)
        .mockRejectedValueOnce(new Error("500") as never)
        .mockResolvedValueOnce({ nomeArvore: "DOC" } as never);
      sei.baixarConteudo.mockResolvedValue({ conteudo: "eA==" } as never);

      const r = await service.obterConteudo("111", "interno", "110099999");

      expect(r.nome).toBe("DOC");
      expect(sei.consultarDocumento).toHaveBeenCalledTimes(3);
    });

    /*
      502 e não 404: o documento pode existir numa unidade fora da lista. Dizer
      "não encontrado" mandaria o analista procurar o documento errado em vez de
      reportar falha de acesso.
    */
    it("dá 502 quando nenhuma unidade responde", async () => {
      sei.consultarDocumento.mockRejectedValue(new Error("500") as never);

      await expect(
        service.obterConteudo("111", "interno", null),
      ).rejects.toMatchObject({ status: 502 });
    });

    /*
      Sem credencial nenhuma unidade responderia: insistir nas seis só atrasa a
      mensagem que diz qual variável preencher. E o código é 503, não 502 — o
      problema é da nossa instalação, não do SEI.
    */
    it("desiste na primeira unidade quando falta configuração", async () => {
      sei.consultarDocumento.mockRejectedValue(
        new SeiNaoConfiguradoError("Falta preencher no .env: SEI_API_BASE.") as never,
      );

      await expect(
        service.obterConteudo("111", "interno", null),
      ).rejects.toMatchObject({ status: 503 });
      expect(sei.consultarDocumento).toHaveBeenCalledTimes(1);
    });

    /*
      Documentos de um mesmo processo ficam na mesma unidade, e os processos são
      abertos em sequência pelo mesmo analista. Sem o palpite, cada documento
      recomeçaria a tentativa do zero.
    */
    it("reaproveita a última unidade que funcionou", async () => {
      // Terceira da lista: a primeira busca gasta duas tentativas antes de
      // acertar, o que dá o que medir na segunda.
      const UNIDADE_BOA = "110053117";

      sei.consultarDocumento.mockImplementation((async (
        _numero: unknown,
        unidade: unknown,
      ) =>
        unidade === UNIDADE_BOA
          ? { nomeArvore: "DOC" }
          : Promise.reject(new Error("500"))) as never);
      sei.baixarConteudo.mockResolvedValue({ conteudo: "eA==" } as never);

      await service.obterConteudo("111", "interno", null);
      const tentativasPrimeira = sei.consultarDocumento.mock.calls.length;

      await service.obterConteudo("222", "interno", null);

      // A primeira tentou até achar; a segunda acerta de primeira.
      expect(tentativasPrimeira).toBeGreaterThan(1);
      expect(sei.consultarDocumento).toHaveBeenCalledTimes(
        tentativasPrimeira + 1,
      );
      expect(sei.consultarDocumento.mock.calls[tentativasPrimeira][1]).toBe(
        UNIDADE_BOA,
      );
    });
  });

  describe("gerarZip", () => {
    beforeEach(() => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("2", "111"), andamento("13", "222")],
      } as never);
      sei.consultarDocumento.mockResolvedValue({ nomeArvore: "DOC" } as never);
      sei.baixarConteudo.mockResolvedValue({ conteudo: "PGh0bWw+" } as never);
      sei.baixarAnexo.mockResolvedValue({
        bytes: Buffer.from("%PDF-1.4"),
        contentType: "application/pdf",
      } as never);
    });

    it("monta um ZIP de verdade", async () => {
      const zip = await service.gerarZip("PROC-1", "110053117", "docs.zip");

      // "PK" é a assinatura do formato ZIP.
      expect(zip.subarray(0, 2).toString()).toBe("PK");
      expect(zip.length).toBeGreaterThan(0);
    });

    /*
      Documento que não baixa entra como .txt com o motivo, em vez de faltar.

      Um ZIP com 12 dos 15 documentos e nenhuma explicação parece completo, e quem
      confere o processo não tem como notar a ausência.
    */
    it("inclui um arquivo de erro para o documento que não baixa", async () => {
      sei.baixarAnexo.mockRejectedValue(new Error("sem acesso") as never);
      sei.baixarConteudo
        .mockResolvedValueOnce({ conteudo: "PGh0bWw+" } as never)
        .mockRejectedValue(new Error("sem acesso") as never);

      const zip = await service.gerarZip("PROC-1", "110053117", "docs.zip");
      const texto = zip.toString("latin1");

      // O nome do arquivo aparece no índice do ZIP mesmo com o conteúdo
      // comprimido.
      expect(texto).toContain("ERRO_222.txt");
    });

    it("dá 404 quando o processo não tem documento", async () => {
      sei.listarAndamentos.mockResolvedValue({ Andamentos: [] } as never);

      await expect(
        service.gerarZip("PROC-1", "110053117", "docs.zip"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("gerarPdfUnificado", () => {
    beforeEach(() => {
      sei.consultarDocumento.mockResolvedValue({ nomeArvore: "DOC" } as never);
      html.converter.mockResolvedValue(pdfDeUmaPagina as never);
    });

    it("converte documento interno e concatena com o externo", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("13", "222"), andamento("2", "111")],
      } as never);
      sei.baixarConteudo.mockResolvedValue({
        // "<html>x</html>" em base64.
        conteudo: Buffer.from("<html>x</html>").toString("base64"),
      } as never);
      sei.baixarAnexo.mockResolvedValue({
        bytes: pdfDeUmaPagina,
        contentType: "application/pdf",
      } as never);

      const r = await service.gerarPdfUnificado("PROC-1", "110053117");

      expect(r.incluidos).toBe(2);
      expect(r.paginas).toBe(2);
      expect(html.converter).toHaveBeenCalledTimes(1);
    });

    /*
      Formato que não é PDF nem HTML não tem como ser concatenado. Precisa ser
      reportado, não descartado em silêncio: é peça que talvez tenha de ser
      anexada à mão.
    */
    it("reporta formato não concatenável em vez de descartar", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("13", "222"), andamento("2", "111")],
      } as never);
      sei.baixarConteudo.mockResolvedValue({
        conteudo: Buffer.from("<html>x</html>").toString("base64"),
      } as never);
      sei.baixarAnexo.mockResolvedValue({
        bytes: Buffer.from("PK planilha"),
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      } as never);

      const r = await service.gerarPdfUnificado("PROC-1", "110053117");

      expect(r.incluidos).toBe(1);
      expect(r.falhas).toHaveLength(1);
      expect(r.falhas[0].motivo).toContain("não concatenável");
    });

    /*
      Falha da conversão é por documento: derrubar o conjunto entregaria nada
      quando o que se quer é o que deu para reunir.
    */
    it("segue quando a conversão de um documento falha", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("2", "111"), andamento("2", "222")],
      } as never);
      sei.baixarConteudo.mockResolvedValue({
        conteudo: Buffer.from("<html>x</html>").toString("base64"),
      } as never);
      html.converter
        .mockResolvedValueOnce(pdfDeUmaPagina as never)
        .mockRejectedValueOnce(new Error("PDF sairia em branco") as never);

      const r = await service.gerarPdfUnificado("PROC-1", "110053117");

      expect(r.incluidos).toBe(1);
      expect(r.falhas).toHaveLength(1);
      expect(r.falhas[0].motivo).toContain("em branco");
    });

    /*
      Trava contra o desfecho pior: nenhum documento incluído tem de virar erro,
      nunca um PDF de uma folha em branco apresentado como conjunto probatório.
    */
    it("dá 404 quando nenhum documento pôde ser convertido", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("2", "111")],
      } as never);
      sei.baixarConteudo.mockResolvedValue({
        conteudo: Buffer.from("<html>x</html>").toString("base64"),
      } as never);
      html.converter.mockRejectedValue(new Error("falhou") as never);

      await expect(
        service.gerarPdfUnificado("PROC-1", "110053117"),
      ).rejects.toThrow(NotFoundException);
    });

    /*
      Documento antigo do SEI vem em ISO-8859-1. Ler como UTF-8 trocaria cada
      acento por caractere de substituição, e o PDF sairia com "FISCALIZA??O".
    */
    it("decodifica ISO-8859-1 quando o documento declara esse charset", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("2", "111")],
      } as never);
      const htmlLatino = Buffer.from(
        '<html><head><meta charset="iso-8859-1"></head><body>FISCALIZAÇÃO</body></html>',
        "latin1",
      );
      sei.baixarConteudo.mockResolvedValue({
        conteudo: htmlLatino.toString("base64"),
      } as never);

      await service.gerarPdfUnificado("PROC-1", "110053117");

      expect(html.converter.mock.calls[0][0]).toContain("FISCALIZAÇÃO");
    });

    /*
      Documento interno do SEI às vezes chega como application/octet-stream.
      Confiar só no cabeçalho classificaria como formato desconhecido e deixaria
      de fora justamente o corpo do processo.
    */
    it("reconhece HTML pelos bytes quando o content-type não diz", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("13", "222")],
      } as never);
      sei.baixarAnexo.mockResolvedValue({
        bytes: Buffer.from("<html><body>x</body></html>"),
        contentType: "application/octet-stream",
      } as never);

      const r = await service.gerarPdfUnificado("PROC-1", "110053117");

      expect(r.incluidos).toBe(1);
      expect(html.converter).toHaveBeenCalled();
    });
  });

  describe("incluirConjuntoProbatorio", () => {
    beforeEach(() => {
      prisma.caixaEntrada.findUnique.mockResolvedValue({
        id: 1,
        numeroSei: "140.001/2024",
        idProcedimento: "PROC-FISC",
        idProcedimentoProcesso: "PROC-SANC",
        idUnidadeSei: "110053117",
      } as never);
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("2", "111")],
      } as never);
      sei.consultarDocumento.mockResolvedValue({ nomeArvore: "DOC" } as never);
      sei.baixarConteudo.mockResolvedValue({
        conteudo: Buffer.from("<html>x</html>").toString("base64"),
      } as never);
      html.converter.mockResolvedValue(pdfDeUmaPagina as never);
      sei.enviarArquivo.mockResolvedValue("ARQ-1" as never);
      sei.incluirDocumentoExterno.mockResolvedValue({
        idDocumento: "DOC-9",
        documentoFormatado: "9999999",
        linkAcesso: "https://sei/9999999",
      } as never);
    });

    /*
      O upload e a inclusão precisam usar a MESMA unidade: o SEI valida e recusa
      o vínculo se divergirem, com erro que não menciona unidade.
    */
    it("usa a mesma unidade no upload e na inclusão", async () => {
      await service.incluirConjuntoProbatorio(1);

      expect(sei.enviarArquivo.mock.calls[0][0]).toBe("110053117");
      expect(sei.incluirDocumentoExterno.mock.calls[0][1]).toBe("110053117");
    });

    /*
      Reúne os documentos do processo de FISCALIZAÇÃO e junta ao processo
      SANCIONATÓRIO. Trocar a ordem anexaria o conjunto ao processo errado.
    */
    it("lê da fiscalização e escreve no processo instaurado", async () => {
      await service.incluirConjuntoProbatorio(1);

      expect(sei.listarAndamentos.mock.calls[0][0]).toBe("PROC-FISC");
      expect(sei.incluirDocumentoExterno.mock.calls[0][0]).toBe("PROC-SANC");
    });

    it("devolve os identificadores do documento criado", async () => {
      const r = await service.incluirConjuntoProbatorio(1);

      expect(r).toMatchObject({
        sucesso: true,
        id_documento: "DOC-9",
        documento_formatado: "9999999",
        link_acesso: "https://sei/9999999",
        docs_incluidos: 1,
        total_docs: 1,
      });
      expect(r.aviso).toBeUndefined();
    });

    /*
      O aviso não é enfeite: conjunto probatório incompleto que se apresenta como
      completo é pior do que erro, porque quem assina não sabe o que ficou fora.
    */
    it("avisa quando algum documento ficou de fora", async () => {
      sei.listarAndamentos.mockResolvedValue({
        Andamentos: [andamento("2", "111"), andamento("2", "222")],
      } as never);
      html.converter
        .mockResolvedValueOnce(pdfDeUmaPagina as never)
        .mockRejectedValueOnce(new Error("falhou") as never);

      const r = await service.incluirConjuntoProbatorio(1);

      expect(r.docs_incluidos).toBe(1);
      expect(r.total_docs).toBe(2);
      expect(r.docs_falha).toHaveLength(1);
      // Compara com o que falhou de fato, e não com um número fixo: a lista sai
      // em ordem cronológica, então qual dos dois falha depende da ordenação — e
      // o que importa é o aviso nomear o documento certo.
      expect(r.aviso).toContain(r.docs_falha[0].numero);
    });

    /*
      A lista de documentos do processo mudou. Sem invalidar, o usuário não veria
      o documento que acabou de gerar e tentaria de novo, duplicando no SEI.
    */
    it("invalida o cache do processo instaurado", async () => {
      await service.incluirConjuntoProbatorio(1);

      expect(cache.invalidarProcesso).toHaveBeenCalledWith("PROC-SANC");
    });

    it("dá 400 quando o processo ainda não foi instaurado", async () => {
      prisma.caixaEntrada.findUnique.mockResolvedValue({
        id: 1,
        numeroSei: "140.001/2024",
        idProcedimento: "PROC-FISC",
        idProcedimentoProcesso: null,
        idUnidadeSei: "110053117",
      } as never);

      await expect(service.incluirConjuntoProbatorio(1)).rejects.toThrow(
        BadRequestException,
      );
      expect(sei.enviarArquivo).not.toHaveBeenCalled();
    });

    it("dá 404 quando o item não existe", async () => {
      prisma.caixaEntrada.findUnique.mockResolvedValue(null as never);

      await expect(service.incluirConjuntoProbatorio(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    /*
      Falha no upload não pode virar inclusão: sem idArquivo não há o que
      vincular, e prosseguir criaria documento vazio no processo.
    */
    it("não tenta incluir quando o upload falha", async () => {
      sei.enviarArquivo.mockRejectedValue(new Error("timeout") as never);

      await expect(service.incluirConjuntoProbatorio(1)).rejects.toMatchObject({
        status: 502,
      });
      expect(sei.incluirDocumentoExterno).not.toHaveBeenCalled();
    });
  });

  describe("obterBytes", () => {
    it("nomeia o arquivo interno com .html", async () => {
      sei.consultarDocumento.mockResolvedValue({
        nomeArvore: "RELATORIO",
      } as never);
      sei.baixarConteudo.mockResolvedValue({ conteudo: "PGh0bWw+" } as never);

      const r = await service.obterBytes("111", "interno", "110053117");

      expect(r.nomeArquivo).toBe("RELATORIO.html");
      expect(r.contentType).toBe("text/html; charset=utf-8");
      expect(r.bytes.toString()).toBe("<html>");
    });

    it("usa a extensão do content-type no anexo externo", async () => {
      sei.consultarDocumento.mockResolvedValue({ nomeArvore: "ANEXO" } as never);
      sei.baixarAnexo.mockResolvedValue({
        bytes: Buffer.from("%PDF"),
        contentType: "application/pdf",
      } as never);

      const r = await service.obterBytes("222", "externo", "110053117");

      expect(r.nomeArquivo).toBe("ANEXO.pdf");
    });

    it("não duplica a extensão quando o nome já termina nela", async () => {
      sei.consultarDocumento.mockResolvedValue({
        nomeArvore: "laudo.pdf",
      } as never);
      sei.baixarAnexo.mockResolvedValue({
        bytes: Buffer.from("%PDF"),
        contentType: "application/pdf",
      } as never);

      const r = await service.obterBytes("222", "externo", "110053117");

      expect(r.nomeArquivo).toBe("laudo.pdf");
    });

    it("neutraliza o nome vindo do SEI", async () => {
      sei.consultarDocumento.mockResolvedValue({
        nomeArvore: 'rel"atorio/2024',
      } as never);
      sei.baixarAnexo.mockResolvedValue({
        bytes: Buffer.from("%PDF"),
        contentType: "application/pdf",
      } as never);

      const r = await service.obterBytes("222", "externo", "110053117");

      expect(r.nomeArquivo).toBe("rel_atorio_2024.pdf");
    });
  });
});
