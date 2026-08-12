// Resolve a identidade em desenvolvimento local, sem token real.
//
// Só é registrado quando AUTH_MODE=dev (ver permissions.module.ts). Em modo sso
// este middleware não entra na cadeia — a identidade vem do JWT.
//
// Precedência: header x-dev-user (permite trocar de usuário sem reiniciar a API)
// e, na ausência dele, a variável DEV_USER.
//
// O middleware apenas ANOTA o e-mail candidato no request. Quem valida se esse
// e-mail existe no Gestão de Acessos é o UsuarioAtualService — assim o modo dev
// não cria um caminho de identidade que escapa da checagem no banco.
import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

@Injectable()
export class DevIdentityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(DevIdentityMiddleware.name);

  use(req: Request, _res: Response, next: NextFunction) {
    const doHeader = req.headers["x-dev-user"];
    const headerEmail = Array.isArray(doHeader) ? doHeader[0] : doHeader;
    const email = headerEmail?.trim() || process.env.DEV_USER?.trim();

    if (email) {
      req.devUserEmail = email;
    } else {
      this.logger.debug(
        "Nenhum e-mail de usuário dev disponível (sem x-dev-user e sem DEV_USER).",
      );
    }

    next();
  }
}
