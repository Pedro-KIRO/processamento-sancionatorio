---
name: pr-review
description: Revisar código, rodar checklist de PR, verificar qualidade antes de merge. Ativa quando o dev menciona "revisar PR", "checklist", "abrir PR", "code review", "aprovar merge", "antes de mergear" ou "qualidade do código".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: code-review
---

# PR Review

Esta skill é ativada quando o dev pede revisão de PR, quer checar o código antes
de abrir um PR, ou menciona "checklist", "revisar código", "abrir PR".

## O que fazer

1. Percorra o diff (ou os arquivos alterados) aplicando cada item do checklist
   completo em `references/checklist.md`.
2. Para cada violação encontrada, aponte:
   - **Arquivo e linha** onde ocorre.
   - **Regra violada** (referência ao item do checklist).
   - **Sugestão de correção** concreta.
3. Se tudo estiver conforme, confirme que o PR está pronto para merge.

## Princípio central

> O autor deve conseguir explicar cada linha do código — inclusive o gerado por IA.
> Se não consegue explicar, não deve submeter.

## Referências

- Checklist completo: [references/checklist.md](references/checklist.md)
- Convenção de commits: `.kiro/steering/git-commits.md`
- Contrato compartilhado: `.kiro/steering/contrato-nucleo.md`
