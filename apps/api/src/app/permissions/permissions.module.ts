// Módulo de permissões — global, para que qualquer módulo de domínio possa
// aplicar @UseGuards(UsuarioAtualGuard, PermissionGuard) sem reimportar nada.
//
// O DevIdentityMiddleware só entra na cadeia quando AUTH_MODE=dev. Em sso ele
// nunca é registrado, então não existe caminho de bypass por header em
// homologação ou produção.
import { Global, Logger, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";

import { DevIdentityMiddleware } from "./dev-identity.middleware";
import { PermissionGuard } from "./permission.guard";
import { PermissionsDatabaseService } from "./permissions-database.service";

@Global()
@Module({
  providers: [PermissionsDatabaseService, PermissionGuard],
  exports: [PermissionsDatabaseService, PermissionGuard],
})
export class PermissionsModule implements NestModule {
  private static readonly logger = new Logger(PermissionsModule.name);

  configure(consumer: MiddlewareConsumer) {
    const ehDev = (process.env.AUTH_MODE ?? "dev").trim().toLowerCase() === "dev";

    if (!ehDev) {
      return;
    }

    PermissionsModule.logger.warn(
      "DevIdentityMiddleware ativo (AUTH_MODE=dev). Identidade resolvida por " +
        "x-dev-user/DEV_USER, sem token. Não use fora de desenvolvimento local.",
    );

    consumer.apply(DevIdentityMiddleware).forRoutes("*");
  }
}
