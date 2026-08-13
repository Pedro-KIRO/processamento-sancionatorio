import { Module } from "@nestjs/common";

import {
  DocumentosCaixaEntradaController,
  DocumentosController,
  DocumentosProcessoController,
} from "./documentos.controller";
import { DocumentosService } from "./documentos.service";

@Module({
  controllers: [
    DocumentosController,
    DocumentosCaixaEntradaController,
    DocumentosProcessoController,
  ],
  providers: [DocumentosService],
  // Exportado porque a listagem será reaproveitada pelos domínios de processos
  // em andamento e despachos quando eles forem migrados.
  exports: [DocumentosService],
})
export class DocumentosModule {}
