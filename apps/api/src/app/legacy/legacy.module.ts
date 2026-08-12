// MÓDULO TEMPORÁRIO DE MIGRAÇÃO — remover junto com o backend Python.
//
// Monta a ponte para o FastAPI em todo o prefixo /api. Ver
// legacy-proxy.middleware.ts para o critério de repasse.
//
// A ponte pode ser desligada com LEGACY_PROXY_ENABLED=false, o que é útil para
// rodar testes de integração contra o NestJS puro.
import { Logger, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";

import { LegacyProxyMiddleware } from "./legacy-proxy.middleware";

@Module({
  providers: [LegacyProxyMiddleware],
})
export class LegacyModule implements NestModule {
  private static readonly logger = new Logger(LegacyModule.name);

  configure(consumer: MiddlewareConsumer) {
    const habilitado =
      (process.env.LEGACY_PROXY_ENABLED ?? "true").trim().toLowerCase() !==
      "false";

    if (!habilitado) {
      LegacyModule.logger.log(
        "LEGACY_PROXY_ENABLED=false — ponte para o FastAPI desligada.",
      );
      return;
    }

    // Registrado em "*" de propósito, não em "api/*".
    //
    // Com "api/*" o middleware simplesmente não executava: a requisição caía no
    // roteador do Nest e voltava 404, em vez de ser repassada ao FastAPI. O
    // sintoma é traiçoeiro porque 404 é resposta plausível de API — parecia
    // rota inexistente, não ponte inoperante.
    //
    // Quem decide o que é do FastAPI é o próprio middleware, que filtra por
    // req.path. Assim o comportamento não depende de como o Nest interpreta
    // curinga em caminho de middleware.
    consumer.apply(LegacyProxyMiddleware).forRoutes("*");
  }
}
