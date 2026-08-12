---
inclusion: manual
---

# Runbook — Migração de Entidade Canônica (expand/contract)

Use sempre que alterar uma entidade canônica de que outros sistemas dependem.

## Por que
O núcleo é fonte da verdade; uma mudança incompatível quebra todos os consumidores ao mesmo
tempo. Expand/contract elimina o "big bang".

## Passos
1. **Expand** — adicione o novo campo/estrutura **sem remover** o antigo. Atualize
   `@detran/shared-contract` (minor) e publique.
2. **Dual-write / compatibilidade** — o núcleo passa a preencher os dois formatos.
3. **Migrar consumidores** — cada sistema adota o novo formato no seu ritmo.
4. **Verificar** — confirme (logs/consultas) que ninguém mais usa o formato antigo.
5. **Contract** — remova o antigo. Isso é **breaking** (major): commit com `BREAKING CHANGE:`
   e **aprovação do tech lead**.

## Regras
- Cada etapa é um deploy próprio; nunca expand e contract no mesmo release.
- Documente no PR qual etapa está sendo feita.
