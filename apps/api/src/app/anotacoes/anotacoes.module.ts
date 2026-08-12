import { Module } from "@nestjs/common";

import { AnotacoesController } from "./anotacoes.controller";
import { AnotacoesService } from "./anotacoes.service";

// PrismaModule, AuthModule e PermissionsModule são @Global, então não precisam
// ser importados aqui.
@Module({
  controllers: [AnotacoesController],
  providers: [AnotacoesService],
})
export class AnotacoesModule {}
