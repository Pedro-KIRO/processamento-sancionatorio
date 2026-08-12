# Integrar Autenticação e Permissionamento

Skill que automatiza a integração dos módulos de autenticação (`auth/`) e
permissionamento (`permissions/`) em um sistema da plataforma — configura
guards, middleware, variáveis de ambiente e deixa o backend pronto para
proteger rotas com `@UseGuards(UsuarioAtualGuard, PermissionGuard)` +
`@RequirePermission`.

## Quando ativa

- Dev pede "integrar autenticação", "proteger rotas", "configurar auth"
- Dev menciona "configurar permissões", "adicionar permissionamento"
- Dev usa `/integrar-auth`

## O que o Kiro faz (AUTOMÁTICO)

### Passo 1 — Verificar pré-requisitos

Antes de qualquer alteração, verificar:

1. O projeto segue a estrutura canônica? (existem `apps/api/` e `apps/web/`?)
2. O `package.json` do backend (`apps/api/package.json`) existe?
3. Já existem os diretórios `apps/api/src/app/auth/` e `apps/api/src/app/permissions/`?

Se os módulos `auth/` e `permissions/` já existirem completos, informar o dev e parar.

### Passo 2 — Criar módulo de auth (`apps/api/src/app/auth/`)

Criar os seguintes arquivos seguindo o padrão descrito em `permissionamento.md`:

| Arquivo | Função |
|---------|--------|
| `auth.module.ts` | Importa PermissionsModule, exporta guards e services |
| `auth-config.service.ts` | Carrega config Entra (jwksUri, issuer, audience). Modo dev dispensa token |
| `usuario-atual.service.ts` | Resolve identidade: dev via header/env, sso via JWKS + oid/email no banco |
| `usuario-atual.guard.ts` | Garante que `req.usuario` está preenchido ou retorna 401 |
| `usuario-atual.decorator.ts` | `@UsuarioAtual()` — param decorator que injeta UsuarioAtualInfo no handler |
| `usuario-atual.types.ts` | Interface `UsuarioAtualInfo { id, usuarioGaId, nome, email, userAd }` |

### Passo 3 — Criar módulo de permissions (`apps/api/src/app/permissions/`)

Criar os seguintes arquivos:

| Arquivo | Função |
|---------|--------|
| `permissions.module.ts` | Global, exporta PermissionGuard. Registra DevIdentityMiddleware em modo dev |
| `permission.guard.ts` | Lê `@RequirePermission`, hierarquia: Gestor Principal → concessão → perfil → 403 |
| `permissions-database.service.ts` | PrismaClient separado apontando para `PERMISSIONS_DATABASE_URL` (somente leitura). Throw no construtor se a URL não estiver configurada |
| `require-permission.decorator.ts` | `@RequirePermission('sistema:recurso:acao')` — metadata para o guard |
| `dev-identity.middleware.ts` | Resolve identidade dev sem token real (só em AUTH_MODE=dev) |
| `parse-identifier.ts` | Valida formato `{sistema}:{recurso}:{acao}`, exporta `SYSTEM_PREFIX` |
| `index.ts` | Barrel exports |

O `SYSTEM_PREFIX` em `parse-identifier.ts` deve ser o nome kebab-case do sistema
(ex.: `controle-ferias`, `gestao-colaboradores`). Perguntar ao dev se não souber.

### Passo 4 — Registrar AuthModule no AppModule

Abrir `apps/api/src/app/app.module.ts` e:

1. Adicionar import: `import { AuthModule } from "./auth/auth.module";`
2. Adicionar `AuthModule` no array `imports` do `@Module`.

Não sobrescrever outros imports ou módulos já existentes — apenas adicionar.

### Passo 5 — Configurar listener de postMessage no frontend

Verificar se já existe um hook/listener de token em `apps/web/src/auth/`.

Se **não existir**, criar o arquivo `apps/web/src/auth/use-portal-token.ts`:

```typescript
import { useState, useEffect } from 'react';

const PORTAL_ORIGIN = import.meta.env.VITE_PORTAL_ORIGIN;

/**
 * Hook que escuta o token enviado pelo Portal via postMessage.
 * Armazena exclusivamente em memória (React state).
 */
export function usePortalToken() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== PORTAL_ORIGIN) return;
      if (event.data?.type !== 'AUTH_TOKEN') return;
      setToken(event.data.token);
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return token;
}
```

Se já existir um listener equivalente, informar o dev e pular este passo.

### Passo 6 — Garantir variáveis de ambiente no `.env.example`

Abrir `.env.example` na raiz e garantir que contenha:

```env
# ── Auth / Identidade ───────────────────────────────────────────────────────
AUTH_MODE="dev"
DEV_USER="dev@detran.sp.gov.br"

# ── Microsoft Entra ID (apenas AUTH_MODE=sso) ───────────────────────────────
ENTRA_TENANT_ID=""
ENTRA_CLIENT_ID=""
ENTRA_AUDIENCE=""

# ── Permissões (banco somente-leitura do Gestão de Acessos) ────────────────
PERMISSIONS_DATABASE_URL=""

# ── Frontend ────────────────────────────────────────────────────────────────
VITE_PORTAL_ORIGIN=http://localhost:3001
```

Não remover variáveis já existentes — apenas adicionar as que faltam.

### Passo 7 — Confirmar resultado

Após concluir todos os passos, informar ao dev:

> Integração configurada:
> - Módulo `auth/` criado com UsuarioAtualGuard + UsuarioAtual decorator
> - Módulo `permissions/` criado com PermissionGuard + RequirePermission decorator
> - AuthModule registrado no AppModule
> - Listener de postMessage criado em `apps/web/src/auth/use-portal-token.ts`
> - Variáveis de ambiente adicionadas ao `.env.example`
>
> **Próximos passos:**
> 1. Copie `.env.example` para `.env` e preencha `PERMISSIONS_DATABASE_URL`
> 2. Ajuste `SYSTEM_PREFIX` em `apps/api/src/app/permissions/parse-identifier.ts`
> 3. Aplique `@UseGuards(UsuarioAtualGuard, PermissionGuard)` nos controllers
> 4. Decore endpoints com `@RequirePermission('{sistema}:{recurso}:{acao}')`
> 5. Use `@UsuarioAtual()` para injetar o usuário autenticado nos handlers
>
> Consulte: `.kiro/steering/permissionamento.md`

## Regras

- **Nunca** sobrescrever código existente — apenas adicionar o que falta.
- **Nunca** armazenar tokens em localStorage/sessionStorage.
- **Sempre** validar `event.origin` no listener de postMessage.
- **Nunca** usar APP_GUARD para o PermissionGuard — explícito por controller.
- **Fail-closed** — erro no guard = 503, nunca libera acesso.
- **Somente leitura** no schema `gestao_acessos_v2` — nunca escrever.
- `DevIdentityMiddleware` só registrado em `AUTH_MODE=dev`.
- Se o projeto não seguir a estrutura canônica (`apps/api` + `apps/web`),
  perguntar ao dev onde estão o backend e o frontend antes de prosseguir.

## Referências

- Estratégia completa: `.kiro/steering/permissionamento.md`
- Guia de integração (shared-contract / frontend): `references/guia-integracao.md`
- Steering de consumo: `.kiro/steering/contrato-nucleo.md`
- Padrões backend: `.kiro/steering/backend-nestjs.md`
