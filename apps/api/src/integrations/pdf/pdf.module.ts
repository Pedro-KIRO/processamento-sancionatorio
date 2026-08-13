import { Global, Module } from "@nestjs/common";

import { HtmlParaPdfService } from "./html-para-pdf.service";

/**
 * Geração de PDF sem navegador.
 *
 * Global porque a configuração do pdfmake (fontes e políticas de acesso) é global
 * no pacote e o serviço a faz uma vez. Instanciar por módulo repetiria isso sem
 * ganho.
 */
@Global()
@Module({
  providers: [HtmlParaPdfService],
  exports: [HtmlParaPdfService],
})
export class PdfModule {}
