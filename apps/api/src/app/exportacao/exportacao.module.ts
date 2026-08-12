import { Module } from "@nestjs/common";

import { ExportacaoController } from "./exportacao.controller";
import { ExportacaoService } from "./exportacao.service";

@Module({
  controllers: [ExportacaoController],
  providers: [ExportacaoService],
})
export class ExportacaoModule {}
