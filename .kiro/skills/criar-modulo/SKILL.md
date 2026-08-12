---
name: criar-modulo
description: Criar um novo módulo NestJS de domínio com controller, service, module e DTO seguindo o padrão da plataforma. Ativa quando o dev menciona "novo módulo", "criar módulo", "adicionar domínio", "novo endpoint", "nova entidade", "novo controller" ou "expandir a API".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: code-generation
---

# Criar Módulo

Esta skill é ativada quando o dev precisa criar um novo módulo de domínio NestJS
além do primeiro (que o onboarding já criou).

## O que o Kiro faz (AUTOMÁTICO)

1. Se o dev informou o nome na invocação (ex.: `/criar-modulo aprovacao`), usar diretamente.
   Senão, perguntar: **"Qual é o nome do novo módulo?"** (ex.: `aprovacao`, `relatorio`)
2. Validar: kebab-case, sem acentos, sem espaços
3. Criar a estrutura completa automaticamente
4. Registrar o módulo no `app.module.ts`
5. Verificar build (`npx nest build`)
6. Confirmar ao dev

**Diretiva de execução contínua:** após ter o nome do módulo, executar
os passos 2-6 em sequência sem parar para perguntas. Se o build falhar,
corrigir e continuar.

## Estrutura gerada

```
apps/api/src/app/<modulo>/
├── dto/
│   └── criar-<modulo>.dto.ts
├── <modulo>.controller.ts
├── <modulo>.service.ts
└── <modulo>.module.ts
```

## Regras que o Kiro deve seguir

- **Arquivos:** `kebab-case` (ex.: `criar-aprovacao.dto.ts`)
- **Classes:** `PascalCase` (ex.: `AprovacaoController`)
- **Variáveis:** `camelCase` (ex.: `aprovacaoService`)
- **Rota:** `@Controller("<modulo>")` em kebab-case
- **Injetar PrismaService** no service por padrão
- **Proteger com guards de permissionamento** — aplicar
  `@UseGuards(UsuarioAtualGuard, PermissionGuard)` no controller (ordem importa:
  identidade primeiro, permissão depois)
- **Decorar endpoints com `@RequirePermission`** — formato
  `{sistema}:{recurso}:{acao}` (ex.: `meu-sistema:aprovacao:listar`). O prefixo do
  sistema vem de `SYSTEM_PREFIX` em `apps/api/src/app/permissions/parse-identifier.ts`
- **Injetar `@UsuarioAtual() usuario: UsuarioAtualInfo`** nos handlers que precisam
  do contexto do usuário autenticado
- **DTO com class-validator** — pelo menos um campo de exemplo
- **Registrar** o novo module no `AppModule` (imports)
- **Nunca usar APP_GUARD** para o PermissionGuard — sempre explícito por controller

## O que NÃO fazer

- Não criar módulo com nome duplicado (verificar se já existe)
- Não criar fora de `apps/api/src/app/`
- Não usar nomes genéricos (`utils`, `misc`, `helper`)

## Referências

- Template dos arquivos: [references/template-modulo.md](references/template-modulo.md)
- Padrões NestJS: `.kiro/steering/backend-nestjs.md`
- Permissionamento: `.kiro/steering/permissionamento.md`
- Estrutura: `.kiro/steering/structure.md`
