import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { PrismaService } from "../../shared/prisma.service";
import {
  paraLinha,
  type RespostaAuditoria,
} from "./dto/auditoria.dto";

export interface FiltrosAuditoria {
  usuario?: string;
  entidade?: string;
  registro_id?: number;
  de?: string;
  ate?: string;
  limit?: number;
  offset?: number;
}

/**
 * Leitura da trilha de auditoria.
 *
 * A trilha é ESCRITA de forma centralizada em toda requisição que altera dados;
 * aqui ela só é lida. Nunca ofereça endpoint de alteração ou exclusão: trilha
 * que pode ser editada não serve ao controle interno.
 */
@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  async consultar(filtros: FiltrosAuditoria): Promise<RespostaAuditoria> {
    const where: Prisma.AuditoriaWhereInput = {};

    if (filtros.usuario?.trim()) {
      where.usuario = {
        contains: filtros.usuario.trim(),
        mode: "insensitive",
      };
    }
    if (filtros.entidade) {
      where.entidade = filtros.entidade;
    }
    if (filtros.registro_id) {
      where.registroId = filtros.registro_id;
    }
    if (filtros.de || filtros.ate) {
      where.momento = {
        ...(filtros.de ? { gte: new Date(`${filtros.de}T00:00:00.000Z`) } : {}),
        // O fim do dia é incluído: `ate=2026-08-11` tem de trazer o que
        // aconteceu às 17h daquele dia. Com a data crua, o limite seria a
        // meia-noite e o dia inteiro ficaria de fora.
        ...(filtros.ate
          ? { lte: new Date(`${filtros.ate}T23:59:59.999Z`) }
          : {}),
      };
    }

    const limite = Math.min(filtros.limit ?? 200, 1000);
    const offset = filtros.offset ?? 0;

    // Conta e busca na mesma transação: sem isso, um registro gravado entre as
    // duas consultas faria o total não bater com a página devolvida.
    const [total, registros] = await this.prisma.$transaction([
      this.prisma.auditoria.count({ where }),
      this.prisma.auditoria.findMany({
        where,
        // `id` desempata: dentro do mesmo instante, sem ele a ordem entre
        // registros seria indefinida e a paginação poderia repetir ou perder
        // linhas.
        orderBy: [{ momento: "desc" }, { id: "desc" }],
        take: limite,
        skip: offset,
      }),
    ]);

    return { total, registros: registros.map(paraLinha) };
  }
}
