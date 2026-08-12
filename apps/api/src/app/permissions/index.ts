// Barrel exports do módulo de permissões.
export { PermissionGuard } from "./permission.guard";
export { PermissionsDatabaseService } from "./permissions-database.service";
export { PermissionsModule } from "./permissions.module";
export { DevIdentityMiddleware } from "./dev-identity.middleware";
export {
  RequirePermission,
  REQUIRE_PERMISSION_KEY,
} from "./require-permission.decorator";
export {
  SYSTEM_PREFIX,
  parseIdentifier,
  parseIdentifierDesteSistema,
} from "./parse-identifier";
export type { PermissionIdentifier } from "./parse-identifier";
