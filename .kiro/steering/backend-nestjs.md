---
inclusion: fileMatch
fileMatchPattern: 'apps/api/**'
---

# Backend — Padrões NestJS

## Estrutura de módulo
- Um **módulo por domínio**: `*.module.ts`, `*.controller.ts`, `*.service.ts`, DTOs em `dto/`.
- Controllers finos: validam entrada e delegam. Regra de negócio fica no service.

## Validação e erros
- DTOs com **class-validator**; valide toda entrada externa.
- Use as exceções HTTP do NestJS; **nunca** vaze stack trace ou dado sensível na resposta.
- Mensagens de erro claras e em português.

## Segurança (obrigatório)
- Proteja rotas com `@UseGuards(UsuarioAtualGuard, PermissionGuard)` — identidade
  primeiro, permissão depois. Decore endpoints com `@RequirePermission('{sistema}:{recurso}:{acao}')`.
  Detalhes completos em `permissionamento.md`.
- **Não** implemente verificação de token ou lógica de permissão na mão.
- Autorização de escopo (ex.: agir apenas sobre o próprio departamento) deriva de dados
  canônicos, não de valores vindos do cliente.
- Nunca usar APP_GUARD para o PermissionGuard — sempre explícito por controller/endpoint.

## Dados e auditoria
- Acesso a dados via Prisma (ver `dados-prisma.md`).
- Registre **log de auditoria** para ações sensíveis (quem, o quê, quando) — requisito de
  setor público.

## Tipos
- Importe tipos/DTOs canônicos do contrato; não os redeclare.
