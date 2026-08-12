// Importa de "@jest/globals" em vez de usar as globais do Jest.
//
// Motivo: instalar @types/jest neste workspace colocaria um `expect` global de
// Jest no escopo do apps/web (o npm faz hoisting das dependências para a raiz),
// e isso quebra o `expect(valor, mensagem)` do Vitest — que é a forma usada nas
// travas do prefixo /api. O sintoma foi erro de compilação em client.test.ts,
// num arquivo que ninguém tinha tocado.
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { ForbiddenException, NotFoundException } from "@nestjs/common";

import { PrismaService } from "../../shared/prisma.service";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { AnotacoesService } from "./anotacoes.service";

const AUTOR: UsuarioAtualInfo = {
  id: 7,
  usuarioGaId: 7,
  nome: "Ana Analista",
  email: "ana@detran.sp.gov.br",
  userAd: null,
};

const OUTRO: UsuarioAtualInfo = {
  id: 8,
  usuarioGaId: 8,
  nome: "Bruno Chefe",
  email: "bruno@detran.sp.gov.br",
  userAd: null,
};

const CRIADO_EM = new Date("2026-08-11T20:18:51.872Z");

function anotacaoFalsa(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    caixaEntradaId: 10,
    autor: "Ana Analista",
    texto: "conteúdo",
    criadoEm: CRIADO_EM,
    ...over,
  };
}

/** Prisma dublê: só os métodos que o service usa. */
function prismaFalso() {
  return {
    caixaEntrada: { findUnique: jest.fn() },
    anotacao: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  };
}

describe("AnotacoesService", () => {
  let prisma: ReturnType<typeof prismaFalso>;
  let service: AnotacoesService;

  beforeEach(() => {
    prisma = prismaFalso();
    service = new AnotacoesService(prisma as unknown as PrismaService);
    // Por padrão o item existe; os testes que precisam do contrário sobrescrevem.
    prisma.caixaEntrada.findUnique.mockResolvedValue({ id: 10 } as never);
  });

  describe("formato da resposta", () => {
    /*
      Esta é a trava mais importante do módulo.

      O frontend foi escrito contra o FastAPI e consome `caixa_entrada_id` e
      `criado_em`. O Prisma devolve `caixaEntradaId` e `criadoEm`. Enquanto a
      ponte de migração faz os dois backends atenderem o mesmo /api, formato
      divergente não dá erro de rede: a tela recebe 200 e mostra campo vazio.
    */
    it("devolve os campos em snake_case, como a tela espera", async () => {
      prisma.anotacao.findMany.mockResolvedValue([anotacaoFalsa()] as never);

      const [resposta] = await service.listar(10);

      expect(resposta).toEqual({
        id: 1,
        caixa_entrada_id: 10,
        autor: "Ana Analista",
        texto: "conteúdo",
        criado_em: "2026-08-11T20:18:51.872Z",
      });
    });

    it("serializa a data como string ISO, não como objeto Date", async () => {
      prisma.anotacao.findMany.mockResolvedValue([anotacaoFalsa()] as never);

      const [resposta] = await service.listar(10);

      expect(typeof resposta.criado_em).toBe("string");
    });
  });

  describe("listar", () => {
    it("ordena em ordem cronológica", async () => {
      prisma.anotacao.findMany.mockResolvedValue([] as never);

      await service.listar(10);

      expect(prisma.anotacao.findMany).toHaveBeenCalledWith({
        where: { caixaEntradaId: 10 },
        orderBy: { criadoEm: "asc" },
      });
    });

    /*
      Sem a checagem do item, um id inexistente devolveria lista vazia — que a
      tela não distingue de "existe e não tem anotação".
    */
    it("dá 404 quando o item da caixa de entrada não existe", async () => {
      prisma.caixaEntrada.findUnique.mockResolvedValue(null as never);

      await expect(service.listar(999)).rejects.toThrow(NotFoundException);
      expect(prisma.anotacao.findMany).not.toHaveBeenCalled();
    });
  });

  describe("criar", () => {
    it("remove espaços das pontas do texto", async () => {
      prisma.anotacao.create.mockResolvedValue(anotacaoFalsa() as never);

      await service.criar(10, "   com espaços   ", AUTOR);

      expect(prisma.anotacao.create).toHaveBeenCalledWith({
        data: {
          caixaEntradaId: 10,
          autor: "Ana Analista",
          texto: "com espaços",
        },
      });
    });

    /*
      A precedência nome → e-mail → "Anônimo" tem que ser a mesma do backend
      Python: é este texto que a exclusão compara para decidir a autoria.
      Mudar a regra aqui tornaria anotações antigas impossíveis de excluir.
    */
    it("usa o e-mail como autor quando o nome está vazio", async () => {
      prisma.anotacao.create.mockResolvedValue(anotacaoFalsa() as never);

      await service.criar(10, "texto", { ...AUTOR, nome: "" });

      expect(prisma.anotacao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ autor: "ana@detran.sp.gov.br" }),
        }),
      );
    });

    it('usa "Anônimo" quando não há nome nem e-mail', async () => {
      prisma.anotacao.create.mockResolvedValue(anotacaoFalsa() as never);

      await service.criar(10, "texto", { ...AUTOR, nome: "", email: "" });

      expect(prisma.anotacao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ autor: "Anônimo" }),
        }),
      );
    });

    it("dá 404 quando o item não existe", async () => {
      prisma.caixaEntrada.findUnique.mockResolvedValue(null as never);

      await expect(service.criar(999, "texto", AUTOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.anotacao.create).not.toHaveBeenCalled();
    });
  });

  describe("excluir", () => {
    it("exclui quando quem pede é o autor", async () => {
      prisma.anotacao.findUnique.mockResolvedValue(anotacaoFalsa() as never);

      await service.excluir(10, 1, AUTOR);

      expect(prisma.anotacao.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it("dá 403 quando quem pede não é o autor", async () => {
      prisma.anotacao.findUnique.mockResolvedValue(anotacaoFalsa() as never);

      await expect(service.excluir(10, 1, OUTRO)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.anotacao.delete).not.toHaveBeenCalled();
    });

    /*
      Confere o vínculo com o item, não só o id da anotação. Sem isso, informar
      o id de uma anotação de OUTRO processo excluiria a anotação errada — a
      permissão está no processo da URL, mas o alvo estaria em outro.
    */
    it("dá 404 quando a anotação pertence a outro item", async () => {
      prisma.anotacao.findUnique.mockResolvedValue(
        anotacaoFalsa({ caixaEntradaId: 99 }) as never,
      );

      await expect(service.excluir(10, 1, AUTOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.anotacao.delete).not.toHaveBeenCalled();
    });

    it("dá 404 quando a anotação não existe", async () => {
      prisma.anotacao.findUnique.mockResolvedValue(null as never);

      await expect(service.excluir(10, 1, AUTOR)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
