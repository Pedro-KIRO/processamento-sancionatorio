---
name: git-flow
description: Gestão de branches, nomenclatura, fluxo de trabalho Git e abertura de PRs. Ativa quando o dev menciona "branch", "criar branch", "commitar", "push", "abrir PR", "como trabalho no git", "posso fazer merge", "minha branch", "rebase" ou "nome da branch".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: version-control
---

# Git Flow

Esta skill é ativada quando o dev menciona branch, criar branch, commitar, push,
abrir PR, "como trabalho no git", "posso fazer merge", "minha branch" ou similar.

## Princípios

- **Única branch permanente:** `main`. Merge em main dispara deploy em homologação.
- **Push direto em main: proibido.** Sem exceção.
- **Merge: responsabilidade exclusiva do tech lead.**
- **Rebase, nunca merge de main na branch de trabalho.**

## Fluxo resumido

```
main (atualizado) → branch feat/... → commits → push → PR → revisão → merge (tech lead) → delete branch
```

## O que o Kiro NÃO deve deixar passar

- Sugestão de push direto em main
- Nome de branch sem prefixo correto (`feat/`, `fix/`, `docs/`, `refactor/`, `chore/`)
- Merge feito pelo próprio dev (somente tech lead faz merge)
- Branch criada a partir de outra branch de trabalho (deve partir de main)
- PR sem reviewer definido

## O que fazer

1. Identifique o que o dev precisa (criar branch, commitar, abrir PR, resolver conflito).
2. Guie conforme o guia detalhado em `references/guia-branches.md`.
3. Valide ativamente a nomenclatura da branch e o fluxo correto.
4. Se o dev tentar algo proibido, bloqueie e explique o motivo.

## Referências

- Guia completo: [references/guia-branches.md](references/guia-branches.md)
- Convenção de commits: `.kiro/steering/git-commits.md`
- Revisão de PR: skill `pr-review`
