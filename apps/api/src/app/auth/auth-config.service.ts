// Configuração de autenticação, lida uma vez no boot.
//
// AUTH_MODE decide o caminho:
//   "dev" → identidade resolvida por DEV_USER / header x-dev-user, sem token.
//   "sso" → token do Entra ID validado por JWKS.
//
// Em "sso" as variáveis do Entra são obrigatórias: subir a API sem elas
// significaria rejeitar todo mundo com 401 sem explicação.
import { Injectable, Logger } from "@nestjs/common";

export type AuthMode = "dev" | "sso";

@Injectable()
export class AuthConfigService {
  private readonly logger = new Logger(AuthConfigService.name);

  readonly mode: AuthMode;
  readonly devUser: string | null;
  readonly tenantId: string | null;
  readonly clientId: string | null;
  readonly audience: string | null;

  constructor() {
    const modoBruto = (process.env.AUTH_MODE ?? "dev").trim().toLowerCase();

    if (modoBruto !== "dev" && modoBruto !== "sso") {
      throw new Error(
        `AUTH_MODE inválido: "${modoBruto}". Use "dev" ou "sso".`,
      );
    }

    this.mode = modoBruto;
    this.devUser = process.env.DEV_USER?.trim() || null;
    this.tenantId = process.env.ENTRA_TENANT_ID?.trim() || null;
    this.clientId = process.env.ENTRA_CLIENT_ID?.trim() || null;
    this.audience = process.env.ENTRA_AUDIENCE?.trim() || null;

    if (this.mode === "sso") {
      const faltando: string[] = [];
      if (!this.tenantId) faltando.push("ENTRA_TENANT_ID");
      if (!this.audience) faltando.push("ENTRA_AUDIENCE");

      if (faltando.length > 0) {
        throw new Error(
          `AUTH_MODE=sso exige ${faltando.join(", ")}. ` +
            "Configure as variáveis do Entra ID ou use AUTH_MODE=dev localmente.",
        );
      }
    } else {
      // Ruído proposital no log: modo dev não valida identidade real e jamais
      // deve passar de desenvolvimento local.
      this.logger.warn(
        "AUTH_MODE=dev — autenticação simulada, SEM validação de token. " +
          "Nunca use este modo em homologação ou produção.",
      );

      if (!this.devUser) {
        this.logger.warn(
          "DEV_USER não definido. Cada requisição precisará enviar o header " +
            "x-dev-user com o e-mail do usuário a simular.",
        );
      }
    }
  }

  /** Endpoint JWKS do tenant, usado para validar a assinatura do token. */
  get jwksUri(): string {
    return `https://login.microsoftonline.com/${this.tenantId}/discovery/v2.0/keys`;
  }

  /** Issuer esperado no token (v2.0). */
  get issuer(): string {
    return `https://login.microsoftonline.com/${this.tenantId}/v2.0`;
  }

  get ehDev(): boolean {
    return this.mode === "dev";
  }
}
