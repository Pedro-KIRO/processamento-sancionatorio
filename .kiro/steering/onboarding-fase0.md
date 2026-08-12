---
inclusion: manual
---

# Onboarding — Fase 0

## Objetivo
Cada dev **reconstrói no novo stack um app que ele mesmo já fez em Power Apps**. Domínio
familiar, foco no aprendizado da plataforma — não no problema de negócio.

## O que se pratica
- **Escrita de spec** no Kiro (requisitos → modelo → tarefas).
- **Modelagem relacional** em PostgreSQL (o objetivo central) — explicitando por que o
  modelo relacional resolve os limites das listas do SharePoint.
- O fluxo padrão: criar repo a partir do template → rodar o prompt de inicialização →
  `apps/api` + `apps/web` + `prisma` → primeira migração.

## Critérios de "pronto"
- App roda localmente (Docker + Postgres) com login via Entra.
- Schema relacional com integridade referencial (sem campos "lista plana").
- O dev **consegue explicar cada parte do código** (ver `checklist-pr.md`).

## Apoio
- Os steerings sempre incluídos já orientam o Kiro; use os manuais (`#deploy`,
  `#migration-nucleo`, `#checklist-pr`) quando o contexto pedir.
