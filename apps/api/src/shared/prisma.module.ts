// Disponibiliza o PrismaService para toda a aplicação sem que cada módulo de
// domínio precise reimportá-lo.
import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
