---
inclusion: manual
---

# Mapa de Steering — Distribuição e Modos de Inclusão

## Fonte única da verdade
Os steerings canônicos vivem **neste repositório** (`detran-contrato-compartilhado`), em
`.kiro/steering/`. Eles são **copiados** para o `.kiro/steering/` do repositório-template e
de cada sistema (workspace scope, versionado — bom para auditoria).

## Modos de inclusão
**Sempre incluídos (`always`)** — entram em todo contexto:
- `product.md`, `tech.md`, `structure.md`, `contrato-nucleo.md`, `git-commits.md`
- `schema-canonico.md` (apenas neste repositório)

**Condicionais (`fileMatch`)** — entram quando arquivos correspondentes estão em foco:
- `backend-nestjs.md` → `apps/api/**`
- `permissionamento.md` → `apps/api/**`
- `frontend-react.md` → `apps/web/**`
- `dados-prisma.md` → `**/prisma/**`

**Manuais (`manual`)** — acionados por `#nome` no chat:
- `deploy.md`, `migration-nucleo.md`, `onboarding-fase0.md`, `checklist-pr.md`, `mapa-steering.md`

**Por sistema:** cada sistema acrescenta o seu `dominio.md` (`always`), que não é
sincronizado a partir daqui.

## Sincronização
Use `scripts/sync-steering.sh` (ver README). Se a sua versão do Kiro não carregar bem o
modo `fileMatch`, considere migrar os steerings de domínio para `inclusion: auto`
(com `name` + `description`).
