---
inclusion: fileMatch
fileMatchPattern: '**/prisma/**'
---

# Dados — Padrões Prisma / PostgreSQL

## Modelagem
- **Objetivo de aprendizado e de projeto: modelagem relacional.** Não replicar listas planas
  do SharePoint. Pense em entidades, relações e integridade referencial.
- Cada sistema usa um **schema PostgreSQL próprio** do seu domínio.
- Chaves, índices e constraints explícitos. Nada de "campo que guarda tudo".

## Migrações
- Toda mudança de schema gera **migração** versionada e revisada.
- Migração nunca é editada depois de aplicada em homologação/produção; crie uma nova.

## Disciplina expand/contract (entidades canônicas)
- Mudança em entidade canônica de que outros sistemas dependem **exige** expand/contract:
  1. **Expand:** adiciona o novo formato mantendo o antigo.
  2. **Migrar:** consumidores passam a usar o novo.
  3. **Contract:** remove o antigo só quando ninguém mais o usa.
- Detalhes em `migration-nucleo.md`.

## Segurança
- Sem credenciais no schema ou no repositório. Conexão via variável de ambiente.
