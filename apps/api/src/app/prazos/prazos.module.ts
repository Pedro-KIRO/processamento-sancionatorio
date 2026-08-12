import { Module } from "@nestjs/common";

import { PrazosController } from "./prazos.controller";
import { PrazosService } from "./prazos.service";

@Module({
  controllers: [PrazosController],
  providers: [PrazosService],
  // Exportado porque outros domínios (cautelares, fases, alertas) precisam do
  // cálculo de prazos e da matriz.
  exports: [PrazosService],
})
export class PrazosModule {}
