import { Global, Module } from "@nestjs/common";

import { CacheSeiService } from "./cache-sei.service";
import { SeiConfigService } from "./sei-config.service";
import { SeiHttpService } from "./sei-http.service";
import { SeiService } from "./sei.service";

/**
 * Integração com o SEI.
 *
 * Global porque oito domínios dependem dela (caixa de entrada, despachos,
 * documentos, fases, textos-padrão, processos em andamento, busca e histórico) —
 * importar em cada um seria repetição sem ganho.
 *
 * O `SeiHttpService` guarda o token em cache na instância, então precisa ser
 * singleton: é o padrão do NestJS, e é o que faz a autenticação acontecer uma
 * vez por hora em vez de uma vez por requisição.
 */
@Global()
@Module({
  providers: [SeiConfigService, SeiHttpService, SeiService, CacheSeiService],
  exports: [SeiService, SeiHttpService, SeiConfigService, CacheSeiService],
})
export class SeiModule {}
