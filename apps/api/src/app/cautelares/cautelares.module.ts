import { Module } from "@nestjs/common";

import { PrazosModule } from "../prazos/prazos.module";
import { CautelaresController } from "./cautelares.controller";
import { CautelaresService } from "./cautelares.service";

// Importa PrazosModule pelo calendário de feriados: o vencimento da cautelar
// segue a mesma regra legal dos demais prazos.
@Module({
  imports: [PrazosModule],
  controllers: [CautelaresController],
  providers: [CautelaresService],
})
export class CautelaresModule {}
