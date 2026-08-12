---
inclusion: fileMatch
fileMatchPattern: 'apps/api/**'
---

# Permissionamento — Estratégia da Plataforma DTI/DETRAN-SP

## Visão Geral

Todos os sistemas compartilham a infraestrutura de permissões do schema
`gestao_acessos_v2` (banco do sistema Gestão de Acessos). Cada sistema é
**consumidor somente-leitura** desse schema — nunca escreve nele.

A autorização funciona em **duas camadas**:

1. **Identidade (quem é):** `UsuarioAtualGuard` resolve o usuário autenticado.
2. **Permissão (pode fazer):** `PermissionGuard` verifica se o usuário tem permissão
   para a ação no endpoint.

## Fluxo de Autorização

```
[Request]
   │
   ▼ (AUTH_MODE=dev)
[DevIdentityMiddleware] → injeta req.servidorId via header x-dev-user ou env DEV_USER
   │
   ▼ (AUTH_MODE=sso)
[Bearer JWT] → token Entra ID validado via JWKS
   │
   ▼
[UsuarioAtualGuard] → resolve UsuarioAtualInfo (id, usuarioGaId, nome, email)
   │                   fonte: gestao_acessos_v2.tb_usuarios (por oid ou e-mail)
   ▼
[PermissionGuard] → verifica @RequirePermission no endpoint
   │                 ordem: Gestor Principal? → concessão direta? → perfil vinculado?
   │                 schema: gestao_acessos_v2
   ▼
[Controller] → executa a lógica de negócio
```

## Módulos Obrigatórios

Todo sistema gerado a partir do template deve ter:

### 1. `apps/api/src/app/auth/`

| Arquivo | Função |
|---------|--------|
| `auth.module.ts` | Importa PermissionsModule, exporta guards e services |
| `auth-config.service.ts` | Carrega config Entra (jwksUri, issuer, audience). Modo dev dispensa token |
| `usuario-atual.service.ts` | Resolve identidade: dev via header/env, sso via JWKS + oid/email no banco |
| `usuario-atual.guard.ts` | Garante que `req.usuario` está preenchido ou retorna 401 |
| `usuario-atual.decorator.ts` | `@UsuarioAtual()` — param decorator que injeta UsuarioAtualInfo no handler |
| `usuario-atual.types.ts` | Interface `UsuarioAtualInfo { id, usuarioGaId, nome, email, userAd }` |

### 2. `apps/api/src/app/permissions/`

| Arquivo | Função |
|---------|--------|
| `permissions.module.ts` | Global, exporta PermissionGuard. Registra DevIdentityMiddleware em modo dev |
| `permission.guard.ts` | Lê `@RequirePermission`, verifica: Gestor Principal → concessão → perfil → 403 |
| `permissions-database.service.ts` | PrismaClient separado apontando para `PERMISSIONS_DATABASE_URL` (somente leitura) |
| `require-permission.decorator.ts` | `@RequirePermission('sistema:recurso:acao')` — metadata para o guard |
| `dev-identity.middleware.ts` | Resolve identidade dev sem token real (só em AUTH_MODE=dev) |
| `parse-identifier.ts` | Valida formato `{sistema}:{recurso}:{acao}`, exporta `SYSTEM_PREFIX` |
| `index.ts` | Barrel exports |

## Formato de Identificadores de Permissão

```
{sistema}:{recurso}:{acao}
```

- **sistema:** nome kebab-case do sistema (ex.: `controle-acessos`, `gestao-colaboradores`)
- **recurso:** entidade/módulo do domínio (ex.: `acessos`, `colaborador`, `ferias`)
- **acao:** verbo da ação (ex.: `listar`, `criar`, `editar`, `excluir`, `aprovar`)

Cada permissão gera automaticamente um par `.conceder` (ex.:
`controle-acessos:acessos:listar.conceder`) que permite delegar a permissão a outro usuário.

### Exemplos

```
controle-acessos:acessos:listar
gestao-colaboradores:colaborador:listar
gestao-colaboradores:colaborador:editar
controle-ferias:ferias:aprovar
```

## Uso nos Controllers

```typescript
@Controller("acessos")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class AcessosController {

  @Get()
  @RequirePermission("controle-acessos:acessos:listar")
  async listar(@UsuarioAtual() usuario: UsuarioAtualInfo) {
    // ...
  }

  @Post()
  @RequirePermission("controle-acessos:acessos:criar")
  async criar(@Body() dto: CriarDto, @UsuarioAtual() usuario: UsuarioAtualInfo) {
    // ...
  }
}
```

### Regras de uso

- `@UseGuards(UsuarioAtualGuard, PermissionGuard)` — **ordem importa**. Identidade
  primeiro, permissão depois.
- Endpoint **sem** `@RequirePermission` → acessível por qualquer usuário autenticado
  (só identidade).
- `PermissionGuard` **NÃO é APP_GUARD** — é aplicado explicitamente por
  controller/endpoint.

## Hierarquia de Verificação do PermissionGuard

1. Endpoint sem `@RequirePermission`? → libera (só identidade basta)
2. Usuário é Gestor Principal ativo e vigente? → libera (bypass total)
3. Possui concessão direta ativa para o identificador? → libera
4. Possui perfil vinculado com a permissão? → libera
5. Nenhuma das anteriores? → **403** `{ motivo: "permissao_insuficiente" }`
6. Erro de conexão/timeout? → **503** (fail-closed — segurança nunca falha aberto)

## Variáveis de Ambiente

```env
# Auth
AUTH_MODE="dev"           # "dev" ou "sso"
DEV_USER=""               # E-mail do usuário dev (modo dev)
ENTRA_TENANT_ID=""        # Tenant ID do Entra (modo sso)
ENTRA_CLIENT_ID=""        # Client ID do app registration (modo sso)
ENTRA_AUDIENCE=""         # Audience esperada no token (modo sso)

# Permissões
PERMISSIONS_DATABASE_URL=""  # Connection string somente-leitura para o banco do gestao-acessos
```

## Regras Inegociáveis

- **Nunca escrever** no schema `gestao_acessos_v2` — somente leitura.
- **Nunca usar APP_GUARD** para o PermissionGuard — aplicar explicitamente por endpoint.
- **Fail-closed** — erro no guard = 503, nunca libera acesso.
- Permissões publicadas pelo sistema Gestão de Acessos — cada sistema apenas
  valida/consome.
- **Vigência temporal** — sempre verificar `acesso_inicio`/`acesso_fim` e `ativa` em
  todas as queries.
- `DevIdentityMiddleware` **só em dev** — nunca registrado quando `AUTH_MODE=sso`.
- `PERMISSIONS_DATABASE_URL` **obrigatória** — sem ela o módulo de permissões não
  inicializa (throw no construtor).

## Tabelas Consultadas (gestao_acessos_v2)

| Tabela | Uso |
|--------|-----|
| `tb_usuarios` | Resolver identidade (oid, email) → id oficial |
| `tb_perfis` | Nomes dos perfis (ex.: "Gestor Principal") |
| `tb_usuario_perfis` | Vínculo usuário <-> perfil |
| `tb_permissoes` | Catálogo de permissões (identificador, sistema, ativa) |
| `tb_concessoes` | Concessões diretas (delegado, permissão, vigência) |
| `tb_perfil_permissoes` | Vínculo perfil <-> permissão |

## Adaptação por Sistema (o que muda)

Ao gerar um novo sistema a partir do template:

1. `parse-identifier.ts` → alterar `SYSTEM_PREFIX` para o nome do novo sistema
2. Controllers → definir os `@RequirePermission` com os identificadores do domínio
3. `.env` → preencher `PERMISSIONS_DATABASE_URL` e `DEV_USER`
4. Registrar permissões no sistema Gestão de Acessos (catálogo oficial)

O restante (guards, middleware, services) é **idêntico** em todos os sistemas.
