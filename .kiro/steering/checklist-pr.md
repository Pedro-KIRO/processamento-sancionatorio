---
inclusion: manual
---

# Checklist de Pull Request

## Código
- [ ] **Sem PR para código inexplicável:** o autor consegue explicar cada linha, mesmo a
      gerada por IA.
- [ ] TypeScript estrito; sem `any` implícito.
- [ ] Tipos vindos de `@detran/shared-contract`, não redeclarados.
- [ ] Segurança apenas pelo pacote de auth compartilhado.

## Commits
- [ ] Mensagens seguem `git-commits.md` (Conventional Commits).
- [ ] Breaking change em contrato/entidade canônica marcado e com expand/contract.

## Dados
- [ ] Migrações geradas e revisadas; modelagem relacional (sem lista plana).
- [ ] Mudança em entidade canônica seguiu `migration-nucleo.md`.

## Auditoria e segregação de funções
- [ ] Ações sensíveis registram log de auditoria.
- [ ] Quem aprova é diferente de quem executa, quando aplicável.
- [ ] Promoção a produção apenas pelo tech lead.

## Geral
- [ ] Sem segredos no diff.
- [ ] Roda localmente; sem quebrar homologação.
