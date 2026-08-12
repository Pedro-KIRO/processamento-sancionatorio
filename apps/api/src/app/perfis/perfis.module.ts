// Global porque vários domínios precisam do perfil para montar a resposta da
// tela (auditoria, cautelares, prazos, processos em andamento).
import { Global, Module } from "@nestjs/common";

import { PerfisService } from "./perfis.service";

@Global()
@Module({
  providers: [PerfisService],
  exports: [PerfisService],
})
export class PerfisModule {}
