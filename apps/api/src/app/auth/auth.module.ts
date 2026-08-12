// Módulo de autenticação — global, porque o UsuarioAtualGuard é aplicado em
// praticamente todo controller de domínio.
//
// Depende do PermissionsModule para consultar gestao_acessos_v2.tb_usuarios:
// a identidade oficial vive no banco do Gestão de Acessos, não no nosso.
import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { PermissionsModule } from "../permissions/permissions.module";
import { AuthConfigService } from "./auth-config.service";
import { UsuarioAtualGuard } from "./usuario-atual.guard";
import { UsuarioAtualService } from "./usuario-atual.service";

@Global()
@Module({
  imports: [PermissionsModule, JwtModule.register({})],
  providers: [AuthConfigService, UsuarioAtualService, UsuarioAtualGuard],
  exports: [AuthConfigService, UsuarioAtualService, UsuarioAtualGuard],
})
export class AuthModule {}
