import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";

import { AlertasController } from "./alertas.controller";
import { AlertasService } from "./alertas.service";
import { AuditoriaController } from "./auditoria.controller";
import { AuditoriaMiddleware } from "./auditoria.middleware";
import { AuditoriaService } from "./auditoria.service";

/**
 * Trilha de auditoria e alertas internos.
 *
 * Dois controllers porque, embora sejam o mesmo assunto (controle interno), os
 * caminhos são distintos: `/auditoria` e `/alertas`.
 *
 * O middleware de trilha é registrado aqui em TODAS as rotas — é o que garante
 * que endpoint novo entre na trilha sem depender de quem o escreveu lembrar.
 */
@Module({
  controllers: [AuditoriaController, AlertasController],
  providers: [AuditoriaService, AlertasService, AuditoriaMiddleware],
})
export class AuditoriaModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // "*" e não "api/*": com curinga de subcaminho o middleware não executava
    // (ver o comentário da ponte de migração). Quem filtra o que auditar é
    // `deveAuditar`, dentro do middleware.
    consumer.apply(AuditoriaMiddleware).forRoutes("*");
  }
}
