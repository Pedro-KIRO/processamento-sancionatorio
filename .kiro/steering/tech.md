---
inclusion: always
---

# Tecnologia — Stack Padrão

## Stack aprovada
- **Linguagem:** TypeScript (modo estrito sempre).
- **Backend:** NestJS.
- **ORM / dados:** Prisma + PostgreSQL (um **schema** por domínio no mesmo banco).
- **Frontend:** React + Vite + MUI (Material UI v6).
- **Identidade:** Microsoft Entra ID via OIDC/MSAL. App Roles (grossos) no Entra;
  permissões finas por sistema.
- **Contrato compartilhado:** pacote npm versionado `@detran/shared-contract`.
- **Execução:** contêineres Docker em VMs (nginx + backends NestJS por host); PostgreSQL
  em VM separada, fora do Docker.
- **Ambientes:** desenvolvimento (local), homologação e produção.
- **Repositório / CI:** GitHub na fase interina; Azure Repos / Pipelines / Artifacts no destino.

## Regras inegociáveis
- **Nunca improvisar segurança.** Autenticação e autorização SEMPRE pelo pacote de auth
  compartilhado de `@detran/shared-contract`.
- **TypeScript estrito.** Sem `any` implícito; tipagem vinda do contrato compartilhado.
- **Sem segredos no repositório.** Use `.env` local e `.env.example` versionado.

## Proibições e seus motivos
- **Next.js — não usar.** SSR/SEO são irrelevantes para apps internos autenticados; o
  overhead de complexidade não se justifica. React + Vite é o padrão.
- **Sem reimplementar validação de JWT, guards ou cliente OIDC** fora do pacote compartilhado.

## Consumo do contrato (interino x destino)
- **Interino:** `@detran/shared-contract` consumido via **GitHub Packages**.
- **Destino:** **Azure Artifacts** (ajustar `.npmrc` na migração).
