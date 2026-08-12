---
inclusion: always
---

# Convenção de Commits (Conventional Commits)

Formato:

```
tipo(escopo): descrição

[corpo opcional]
[rodapé opcional]
```

- **descrição** no imperativo, minúscula, curta, sem ponto final.
- **escopo** é opcional, mas recomendado.

## Tipos principais
| Tipo | Quando usar |
|---|---|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `docs` | Apenas documentação |
| `refactor` | Refatoração sem mudar comportamento |
| `perf` | Melhoria de performance |
| `test` | Adição/ajuste de testes |
| `build` | Build ou dependências |
| `ci` | Pipelines / CI |
| `style` | Formatação, sem afetar lógica |
| `chore` | Manutenção sem afetar produção |
| `revert` | Reverte um commit anterior |

## Escopos da plataforma
`api` · `web` · `prisma` · `contrato` · `auth` · `deploy` · `steering`
(ou o nome do domínio, ex.: `feat(ferias): ...`).

## Breaking change
Use `!` após o tipo/escopo **ou** o rodapé `BREAKING CHANGE:`. Em `@detran/shared-contract`
e em entidades canônicas, breaking change **exige** expand/contract e aprovação do tech lead.

```
feat(contrato)!: remove campo legado do modelo canônico

BREAKING CHANGE: campo removido; consumidores devem migrar. Seguir expand/contract.
```

## Exemplos
- `feat(api): adiciona endpoint de aprovação`
- `fix(web): corrige validação do formulário de login`
- `build(deps): atualiza prisma para 5.x`
- `docs(steering): revisa checklist-pr`
