// Camada 1 de 2: identidade.
//
// Resolve quem é o usuário e anota em req.usuario. Não decide permissão —
// isso é do PermissionGuard, que roda depois.
//
// Sempre use na ordem: @UseGuards(UsuarioAtualGuard, PermissionGuard)
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

import { UsuarioAtualService } from "./usuario-atual.service";

@Injectable()
export class UsuarioAtualGuard implements CanActivate {
  constructor(private readonly usuarioAtual: UsuarioAtualService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    // Idempotente: se outro guard na cadeia já resolveu, não consulta de novo.
    if (req.usuario) {
      return true;
    }

    const usuario = await this.usuarioAtual.resolver(req);

    if (!usuario) {
      throw new UnauthorizedException("Não foi possível resolver a identidade.");
    }

    req.usuario = usuario;
    return true;
  }
}
