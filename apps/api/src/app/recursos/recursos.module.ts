import { Module } from "@nestjs/common";

import { PrazosModule } from "../prazos/prazos.module";
import { RecursosController } from "./recursos.controller";
import { RecursosService } from "./recursos.service";

// Importa PrazosModule para usar o calendário de feriados no cálculo dos
// vencimentos abertos pela interposição.
@Module({
  imports: [PrazosModule],
  controllers: [RecursosController],
  providers: [RecursosService],
})
export class RecursosModule {}
