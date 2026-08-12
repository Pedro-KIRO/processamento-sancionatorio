// Camada 2 de 2: permissão.
//
// Lê @RequirePermission do endpoint e decide o acesso na seguinte ordem:
//   1. Endpoint sem @RequirePermission        → libera (identidade já basta)
//   2. Gestor Principal ativo e vigente       → libera (bypass total)
//   3. Concessão direta ativa e vigente       → libera
//   4. Perfil vinculado com a permissão       → libera
//   5. Nenhuma das anteriores                 → 403 permissao_insuficiente
//   6. Erro ao consultar o banco              → 503 (fail-closed)
//
// NUNCA registrar como APP_GUARD. Sempre explícito por controller/endpoint,
// depois do UsuarioAtualGuard.
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import { PermissionsDatabaseService } from "./permissions-database.service";
import { REQUIRE_PERMISSION_KEY } from "./require-permission.decorator";

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissoesDb: PermissionsDatabaseService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // O decorator no handler tem precedência sobre o do controller.
    const identificador = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_PERMISSION_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    // Sem exigência declarada: estar autenticado é suficiente.
    if (!identificador) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const usuario = req.usuario;

    // Defesa em profundidade: o UsuarioAtualGuard deveria ter rodado antes.
    // Se não rodou, isso é erro de composição — falha fechado.
    if (!usuario) {
      this.logger.error(
        `PermissionGuard executou sem identidade resolvida para "${identificador}". ` +
          "Verifique se UsuarioAtualGuard vem antes no @UseGuards.",
      );
      throw new UnauthorizedException("Identidade não resolvida.");
    }

    try {
      if (await this.permissoesDb.ehGestorPrincipal(usuario.id)) {
        return true;
      }

      if (await this.permissoesDb.temConcessaoDireta(usuario.id, identificador)) {
        return true;
      }

      if (
        await this.permissoesDb.temPermissaoPorPerfil(usuario.id, identificador)
      ) {
        return true;
      }
    } catch (erro) {
      // Fail-closed: indisponibilidade do banco de permissões nunca libera acesso.
      this.logger.error(
        `Erro ao verificar "${identificador}" para o usuário ${usuario.id}: ` +
          `${erro instanceof Error ? erro.message : erro}`,
      );
      throw new ServiceUnavailableException(
        "Não foi possível verificar suas permissões neste momento. Tente novamente.",
      );
    }

    this.logger.warn(
      `Acesso negado: usuário ${usuario.id} não tem "${identificador}".`,
    );
    throw new ForbiddenException({
      motivo: "permissao_insuficiente",
      message: "Você não tem permissão para executar esta ação.",
      permissaoNecessaria: identificador,
    });
  }
}
