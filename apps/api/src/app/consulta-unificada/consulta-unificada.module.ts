import { Module } from "@nestjs/common";

import { ConsultaUnificadaController } from "./consulta-unificada.controller";
import { ConsultaUnificadaService } from "./consulta-unificada.service";

@Module({
  controllers: [ConsultaUnificadaController],
  providers: [ConsultaUnificadaService],
})
export class ConsultaUnificadaModule {}
