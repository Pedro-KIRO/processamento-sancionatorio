// PrismaService: encapsula o cliente Prisma para injeção de dependência no NestJS.
// Aponta para o banco do domínio (DATABASE_URL). O banco de permissões é
// separado e tem o seu próprio client (ver permissions/permissions-database.service.ts).
import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  // Abre a conexão com o banco quando o módulo é iniciado.
  async onModuleInit() {
    await this.$connect();
  }

  // Fecha a conexão com o banco quando o módulo é destruído (graceful shutdown).
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
