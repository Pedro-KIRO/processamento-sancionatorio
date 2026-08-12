// Resolve a identidade do usuário da requisição.
//
// Dois caminhos, um destino: em ambos, o usuário só é aceito se existir em
// gestao_acessos_v2.tb_usuarios. O modo dev encurta a prova de identidade, mas
// não dispensa o cadastro — por isso não existe usuário "inventado" em dev.
//
//   AUTH_MODE=dev → e-mail vem do DevIdentityMiddleware (x-dev-user ou DEV_USER)
//   AUTH_MODE=sso → token Bearer validado por JWKS; usa o oid (e o e-mail como fallback)
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { JwksClient } from "jwks-rsa";

import { PermissionsDatabaseService } from "../permissions/permissions-database.service";
import { AuthConfigService } from "./auth-config.service";
import { UsuarioAtualInfo } from "./usuario-atual.types";

/** Claims que nos interessam no token do Entra ID. */
interface ClaimsEntra {
  oid?: string;
  sub?: string;
  preferred_username?: string;
  upn?: string;
  email?: string;
  name?: string;
}

@Injectable()
export class UsuarioAtualService {
  private readonly logger = new Logger(UsuarioAtualService.name);
  private readonly jwks: JwksClient | null;

  constructor(
    private readonly config: AuthConfigService,
    private readonly permissoesDb: PermissionsDatabaseService,
    private readonly jwt: JwtService,
  ) {
    // O cliente JWKS mantém cache das chaves públicas e limita a taxa de
    // requisições ao endpoint do Entra.
    this.jwks = this.config.ehDev
      ? null
      : new JwksClient({
          jwksUri: this.config.jwksUri,
          cache: true,
          cacheMaxEntries: 5,
          cacheMaxAge: 10 * 60 * 1000,
          rateLimit: true,
          jwksRequestsPerMinute: 10,
        });
  }

  /**
   * Devolve a identidade do usuário da requisição.
   * Lança 401 quando não há como resolver — nunca devolve identidade parcial.
   */
  async resolver(req: Request): Promise<UsuarioAtualInfo> {
    const candidato = this.config.ehDev
      ? this.candidatoDev(req)
      : await this.candidatoSso(req);

    const usuario = await this.permissoesDb.buscarUsuario(candidato);

    if (!usuario) {
      const alvo = candidato.oid ?? candidato.email ?? "(sem identificador)";
      this.logger.warn(`Usuário não encontrado no Gestão de Acessos: ${alvo}`);
      throw new UnauthorizedException(
        "Usuário não cadastrado no Gestão de Acessos.",
      );
    }

    return {
      id: usuario.id,
      usuarioGaId: usuario.id,
      nome: usuario.nome ?? "",
      email: usuario.email ?? "",
      userAd: usuario.oid ?? null,
    };
  }

  /** Modo dev: o e-mail anotado pelo DevIdentityMiddleware. */
  private candidatoDev(req: Request): { oid: null; email: string } {
    const email = req.devUserEmail;

    if (!email) {
      throw new UnauthorizedException(
        "AUTH_MODE=dev sem usuário definido. Configure DEV_USER no .env ou " +
          "envie o header x-dev-user com o e-mail a simular.",
      );
    }

    return { oid: null, email };
  }

  /** Modo sso: valida o Bearer token e extrai oid/e-mail das claims. */
  private async candidatoSso(
    req: Request,
  ): Promise<{ oid: string | null; email: string | null }> {
    const token = this.extrairBearer(req);
    const claims = await this.validarToken(token);

    const oid = claims.oid ?? claims.sub ?? null;
    const email =
      claims.preferred_username ?? claims.upn ?? claims.email ?? null;

    if (!oid && !email) {
      throw new UnauthorizedException(
        "Token válido, mas sem claim de identificação (oid ou e-mail).",
      );
    }

    return { oid, email };
  }

  private extrairBearer(req: Request): string {
    const header = req.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Token de autenticação não fornecido.");
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      throw new UnauthorizedException("Token de autenticação não fornecido.");
    }

    return token;
  }

  private async validarToken(token: string): Promise<ClaimsEntra> {
    try {
      const cabecalho = this.jwt.decode(token, { complete: true }) as {
        header?: { kid?: string };
      } | null;

      const kid = cabecalho?.header?.kid;
      if (!kid) {
        throw new Error("Token sem kid no cabeçalho.");
      }

      const chave = await this.jwks!.getSigningKey(kid);

      return await this.jwt.verifyAsync<ClaimsEntra>(token, {
        publicKey: chave.getPublicKey(),
        algorithms: ["RS256"],
        audience: this.config.audience ?? undefined,
        issuer: this.config.issuer,
      });
    } catch (erro) {
      // Detalhe do erro vai só para o log; a resposta não expõe o motivo exato
      // para não ajudar quem está sondando a API.
      this.logger.warn(
        `Falha ao validar token: ${erro instanceof Error ? erro.message : erro}`,
      );
      throw new UnauthorizedException("Token de autenticação inválido.");
    }
  }
}
