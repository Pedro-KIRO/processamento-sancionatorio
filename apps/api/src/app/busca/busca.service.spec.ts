// Importa de "@jest/globals" em vez de usar as globais do Jest — ver a nota em
// anotacoes.service.spec.ts.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { PrismaService } from "../../shared/prisma.service";
import { BuscaService } from "./busca.service";
import {
  classificar,
  LinhaBusca,
  semMascara,
  soDigitos,
} from "./dto/busca-resposta.dto";

function linhaFalsa(over: Partial<LinhaBusca> = {}): LinhaBusca {
  return {
    id: 10,
    numero_sei: "140.001/2024",
    numero_processo_sei: null,
    id_procedimento: "PROC-1",
    id_procedimento_processo: null,
    razao_social: "AUTO ESCOLA MODELO LTDA",
    cnpj_cpf: "12.345.678/0001-99",
    agente_regulado: "Autoescola",
    status_triagem: "pendente",
    ...over,
  };
}

/** Prisma dublê: o service só usa `$queryRaw`. */
function prismaFalso() {
  return { $queryRaw: jest.fn() };
}

/**
 * Reconstrói a SQL gerada por uma chamada de `$queryRaw`.
 *
 * `$queryRaw` é uma tagged template, então o dublê recebe
 * `(partesLiterais, ...interpolados)`. Os interpolados são de dois tipos: um
 * `Prisma.Sql` (trecho de SQL montado pelo service) ou um valor solto, que o
 * driver envia parametrizado. A distinção é justamente o que os testes de
 * injeção abaixo verificam, então ela é reconstruída aqui em vez de conferida
 * de olho.
 */
function sqlGerada(chamada: unknown[]): { texto: string; valores: unknown[] } {
  const [partes, ...interpolados] = chamada as [string[], ...unknown[]];

  let texto = partes[0] ?? "";
  const valores: unknown[] = [];

  interpolados.forEach((item, indice) => {
    if (ehSql(item)) {
      // `strings`/`values` de um Prisma.Sql já vêm achatados: um placeholder
      // entre cada par de literais.
      texto += item.strings.join("?");
      valores.push(...item.values);
    } else {
      texto += "?";
      valores.push(item);
    }
    texto += partes[indice + 1] ?? "";
  });

  return { texto, valores };
}

function ehSql(v: unknown): v is { strings: string[]; values: unknown[] } {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as { strings?: unknown }).strings) &&
    Array.isArray((v as { values?: unknown }).values)
  );
}

// ===========================================================================
// Classificação — a regra de negócio do módulo
// ===========================================================================

describe("classificar", () => {
  /*
    Esta é a razão de o endpoint existir. Antes, a pesquisa mandava todo mundo
    para "Processos em Andamento", o que abria a tela errada quando o número
    digitado era de um relatório ainda na triagem.
  */
  it("devolve o processo quando o termo casa com o número do processo", () => {
    const r = classificar(
      linhaFalsa({
        numero_processo_sei: "999.888/2025",
        id_procedimento_processo: "PROC-999",
      }),
      "9998882025",
    );

    expect(r.tipo).toBe("processo");
    expect(r.numero_sei).toBe("999.888/2025");
    expect(r.id_procedimento).toBe("PROC-999");
  });

  it("devolve o relatório quando o termo casa com o número do relatório", () => {
    const r = classificar(
      linhaFalsa({
        numero_processo_sei: "999.888/2025",
        id_procedimento_processo: "PROC-999",
      }),
      "1400012024",
    );

    expect(r.tipo).toBe("relatorio");
    expect(r.numero_sei).toBe("140.001/2024");
    expect(r.id_procedimento).toBe("PROC-1");
  });

  it("devolve o relatório quando o item nunca foi instaurado", () => {
    expect(classificar(linhaFalsa(), "1400012024").tipo).toBe("relatorio");
  });

  /*
    O usuário digita com pontuação e a coluna guarda com pontuação, mas as duas
    pontuações podem divergir. A comparação acontece sem máscara nos dois lados.
  */
  it("ignora a máscara ao comparar", () => {
    const r = classificar(
      linhaFalsa({ numero_processo_sei: "999.888/2025" }),
      semMascara("999-888 2025"),
    );

    expect(r.tipo).toBe("processo");
  });

  /*
    Pesquisa por nome não tem número nenhum. Cair em "processo" aqui faria a
    sugestão levar para a tela de processo mesmo em item ainda na triagem.
  */
  it("cai em relatório quando o termo é textual", () => {
    const r = classificar(
      linhaFalsa({ numero_processo_sei: "999.888/2025" }),
      semMascara("Auto Escola"),
    );

    expect(r.tipo).toBe("relatorio");
  });

  it("preserva os campos de identificação do agente independente do tipo", () => {
    const r = classificar(linhaFalsa(), "1400012024");

    expect(r).toEqual({
      caixa_entrada_id: 10,
      tipo: "relatorio",
      numero_sei: "140.001/2024",
      id_procedimento: "PROC-1",
      razao_social: "AUTO ESCOLA MODELO LTDA",
      cnpj_cpf: "12.345.678/0001-99",
      agente_regulado: "Autoescola",
      status_triagem: "pendente",
    });
  });
});

describe("normalização do termo", () => {
  it("semMascara remove pontuação e espaço, mas preserva letras", () => {
    expect(semMascara("140.001/2024")).toBe("1400012024");
    expect(semMascara("Auto Escola")).toBe("AutoEscola");
    expect(semMascara(null)).toBe("");
  });

  it("soDigitos descarta tudo que não é dígito", () => {
    expect(soDigitos("12.345.678/0001-99")).toBe("12345678000199");
    expect(soDigitos("Auto Escola")).toBe("");
  });
});

// ===========================================================================
// Service
// ===========================================================================

describe("BuscaService", () => {
  let prisma: ReturnType<typeof prismaFalso>;
  let service: BuscaService;

  beforeEach(() => {
    prisma = prismaFalso();
    service = new BuscaService(prisma as unknown as PrismaService);
    prisma.$queryRaw.mockResolvedValue([] as never);
  });

  describe("termo curto", () => {
    /*
      Um caractere casaria com quase toda a tabela e o frontend consulta a cada
      300 ms de digitação — a consulta sairia a cada tecla das primeiras letras.
    */
    it("não consulta o banco com menos de dois caracteres", async () => {
      const r = await service.buscar("a", 10);

      expect(r).toEqual({ termo: "a", total: 0, resultados: [] });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("conta o termo já sem os espaços das pontas", async () => {
      const r = await service.buscar("   a   ", 10);

      expect(r.termo).toBe("a");
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it("consulta a partir de dois caracteres", async () => {
      await service.buscar("ab", 10);

      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });

  describe("formato da resposta", () => {
    /*
      Trava de contrato: a tela foi escrita contra o FastAPI e lê
      `caixa_entrada_id`. Enquanto a ponte faz os dois backends atenderem o
      mesmo /api, divergir de formato não dá erro de rede — a sugestão aparece
      em branco.
    */
    it("devolve os campos em snake_case", async () => {
      prisma.$queryRaw.mockResolvedValue([linhaFalsa()] as never);

      const r = await service.buscar("140.001", 10);

      expect(r.resultados[0]).toEqual({
        caixa_entrada_id: 10,
        tipo: "relatorio",
        numero_sei: "140.001/2024",
        id_procedimento: "PROC-1",
        razao_social: "AUTO ESCOLA MODELO LTDA",
        cnpj_cpf: "12.345.678/0001-99",
        agente_regulado: "Autoescola",
        status_triagem: "pendente",
      });
    });

    /*
      `total` é o tamanho da página, não a contagem de correspondências — é o
      que o FastAPI devolvia. Ver a nota no DTO.
    */
    it("usa o tamanho da lista como total", async () => {
      prisma.$queryRaw.mockResolvedValue([
        linhaFalsa({ id: 1 }),
        linhaFalsa({ id: 2 }),
      ] as never);

      const r = await service.buscar("auto", 10);

      expect(r.total).toBe(2);
    });
  });

  describe("limite", () => {
    it("respeita o limite pedido", async () => {
      await service.buscar("auto", 10);

      expect(sqlGerada(prisma.$queryRaw.mock.calls[0]).valores).toContain(10);
    });

    it("corta em 50 quando pedem mais", async () => {
      await service.buscar("auto", 5000);

      const { valores } = sqlGerada(prisma.$queryRaw.mock.calls[0]);
      expect(valores).toContain(50);
      expect(valores).not.toContain(5000);
    });

    /*
      LIMIT 0 devolveria lista vazia para um termo que casa, e LIMIT negativo é
      erro de sintaxe no PostgreSQL — os dois apareceriam como "a pesquisa
      parou de funcionar".
    */
    it("usa no mínimo 1 quando pedem zero ou negativo", async () => {
      await service.buscar("auto", 0);
      expect(sqlGerada(prisma.$queryRaw.mock.calls[0]).valores).toContain(1);

      await service.buscar("auto", -5);
      expect(sqlGerada(prisma.$queryRaw.mock.calls[1]).valores).toContain(1);
    });
  });

  describe("condições de busca", () => {
    it("compara razão social sem diferenciar maiúsculas", async () => {
      await service.buscar("Auto Escola", 10);

      const { texto, valores } = sqlGerada(prisma.$queryRaw.mock.calls[0]);
      expect(texto).toContain("LOWER(razao_social) LIKE");
      expect(valores).toContain("%auto escola%");
    });

    it("compara os dois números SEI sem máscara", async () => {
      await service.buscar("140.001", 10);

      const { texto, valores } = sqlGerada(prisma.$queryRaw.mock.calls[0]);
      expect(texto).toContain("TRANSLATE(numero_sei, './- ', '')");
      expect(texto).toContain("TRANSLATE(numero_processo_sei, './- ', '')");
      expect(valores).toContain("%140001%");
    });

    /*
      A guarda mais importante da montagem da consulta.

      Sem ela, pesquisar por nome compararia cnpj_cpf com '%%', que casa com
      qualquer valor não nulo. O efeito seria a pesquisa por razão social
      devolver a tabela inteira, com as sugestões corretas perdidas no meio.
    */
    it("só compara documento quando o termo tem dígito", async () => {
      await service.buscar("Auto Escola", 10);

      const { texto, valores } = sqlGerada(prisma.$queryRaw.mock.calls[0]);
      // Procura a CONDIÇÃO, não a coluna: `cnpj_cpf` é campo devolvido e
      // aparece no SELECT em toda consulta.
      expect(texto).not.toContain("TRANSLATE(cnpj_cpf");
      expect(valores).not.toContain("%%");
    });

    it("compara documento quando o termo tem dígito", async () => {
      await service.buscar("12.345.678", 10);

      const { texto, valores } = sqlGerada(prisma.$queryRaw.mock.calls[0]);
      expect(texto).toContain("TRANSLATE(cnpj_cpf, './- ', '')");
      expect(valores).toContain("%12345678%");
    });
  });

  describe("consulta", () => {
    /*
      `conteudo_html` guarda o relatório inteiro e passa de 1 MB por item. O
      FastAPI fazia `select(CaixaEntrada)`, que traz todas as colunas: cada
      pesquisa carregava dezenas de megabytes para devolver oito campos curtos.
    */
    it("não seleciona conteudo_html", async () => {
      await service.buscar("auto", 10);

      expect(sqlGerada(prisma.$queryRaw.mock.calls[0]).texto).not.toContain(
        "conteudo_html",
      );
    });

    /*
      No SQLite, banco de produção hoje, NULL é o menor valor e DESC já o joga
      para o fim. No PostgreSQL o padrão de DESC é NULLS FIRST: sem o NULLS
      LAST explícito, os itens sem data de recebimento ocupariam as primeiras
      sugestões e empurrariam as correspondências reais para fora do limite.
    */
    it("ordena do mais recente e joga os sem data para o fim", async () => {
      await service.buscar("auto", 10);

      expect(sqlGerada(prisma.$queryRaw.mock.calls[0]).texto).toContain(
        "ORDER BY data_recebimento DESC NULLS LAST, id DESC",
      );
    });

    it("parametriza o termo em vez de concatená-lo na SQL", async () => {
      const ataque = "'; DROP TABLE processamento.caixa_entrada; --";

      await service.buscar(ataque, 10);

      const { texto, valores } = sqlGerada(prisma.$queryRaw.mock.calls[0]);
      expect(texto).not.toContain("DROP TABLE");
      expect(valores).toContain(`%${ataque.toLowerCase()}%`);
    });
  });
});
