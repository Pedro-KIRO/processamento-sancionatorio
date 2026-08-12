import { Module } from "@nestjs/common";

import { BibliotecaController } from "./biblioteca.controller";
import { BibliotecaService } from "./biblioteca.service";

@Module({
  controllers: [BibliotecaController],
  providers: [BibliotecaService],
})
export class BibliotecaModule {}
