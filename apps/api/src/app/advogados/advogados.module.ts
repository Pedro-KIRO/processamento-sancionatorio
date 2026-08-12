import { Module } from "@nestjs/common";

import { AdvogadosController } from "./advogados.controller";
import { AdvogadosService } from "./advogados.service";

@Module({
  controllers: [AdvogadosController],
  providers: [AdvogadosService],
})
export class AdvogadosModule {}
