---
name: migration-canonico
description: Guiar migração de entidades canônicas com disciplina expand/contract. Ativa quando o dev menciona "migração canônica", "expand/contract", "breaking change no contrato", "alterar entidade compartilhada", "mudar schema canônico", "campo deprecado" ou "remover campo do contrato".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: data-migration
---

# Migração de Schema Canônico

Esta skill é ativada quando o dev menciona migração de schema canônico,
expand/contract, mudança em entidade canônica, breaking change no contrato
ou similar.

## Quando usar

Sempre que uma entidade do `@detran/shared-contract` precisa sofrer uma
alteração incompatível (renomear campo, mudar tipo, remover campo).

## As 5 etapas (resumo)

1. **Expand** — adicionar novo campo/estrutura sem remover o antigo.
2. **Dual-write** — núcleo preenche os dois formatos simultaneamente.
3. **Migrar consumidores** — cada sistema migra no seu ritmo.
4. **Verificar** — confirmar que ninguém mais usa o formato antigo.
5. **Contract** — remover o antigo (breaking, major, `BREAKING CHANGE:`, aprovação sênior).

> **Regra de ouro:** cada etapa é um deploy separado. Nunca expand e contract
> no mesmo release.

## O que fazer

1. Identifique em qual etapa o dev está.
2. Guie passo a passo conforme o guia detalhado em `references/guia-expand-contract.md`.
3. Lembre que contract exige:
   - Versão major do contrato.
   - Commit com `!` e rodapé `BREAKING CHANGE:`.
   - Aprovação explícita do tech lead.

## Referências

- Guia completo: [references/guia-expand-contract.md](references/guia-expand-contract.md)
- Convenção de commits: `.kiro/steering/git-commits.md`
- Contrato compartilhado: `.kiro/steering/contrato-nucleo.md`
