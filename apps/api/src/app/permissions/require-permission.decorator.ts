// Decorator de metadata lido pelo PermissionGuard.
//
// Endpoint SEM @RequirePermission é acessível a qualquer usuário autenticado
// (só a camada de identidade se aplica). Endpoint com @RequirePermission exige
// que o usuário tenha a permissão no Gestão de Acessos.
import { SetMetadata } from "@nestjs/common";
import { parseIdentifierDesteSistema } from "./parse-identifier";

export const REQUIRE_PERMISSION_KEY = "require_permission";

/**
 * Exige a permissão informada para acessar o endpoint.
 *
 * O formato é validado já na carga do módulo: um identificador malformado
 * derruba a aplicação no boot em vez de virar um 403 silencioso em produção.
 *
 * @example
 * @RequirePermission("processamento:caixa-entrada:listar")
 */
export const RequirePermission = (identificador: string) => {
  parseIdentifierDesteSistema(identificador);
  return SetMetadata(REQUIRE_PERMISSION_KEY, identificador);
};
