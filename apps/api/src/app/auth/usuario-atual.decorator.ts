// @UsuarioAtual() — injeta a identidade já resolvida no parâmetro do handler.
//
// Só use em endpoints protegidos por UsuarioAtualGuard. Se o guard não rodou,
// o valor é undefined e o handler não deve confiar nele.
import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { UsuarioAtualInfo } from "./usuario-atual.types";

export const UsuarioAtual = createParamDecorator(
  (_dados: unknown, ctx: ExecutionContext): UsuarioAtualInfo | undefined => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.usuario;
  },
);
