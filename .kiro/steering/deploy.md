---
inclusion: manual
---

# Runbook — Deploy (Docker / nginx em VM)

## Topologia
- Por host: **nginx** como reverse proxy + os **backends NestJS** em contêineres.
- **PostgreSQL** em VM separada, fora do Docker.
- Ambientes: **homologação** e **produção**.

## Princípio build-once-promote
- A imagem Docker é **construída uma vez** e **promovida** de homologação para produção.
- **Nunca** recompile em produção. A mesma imagem (mesmo digest) que passou em homologação é a que sobe.

## Fluxo
1. Merge em `main` → build da imagem → deploy automático em **homologação**.
2. Validação em homologação.
3. Promoção a **produção** apenas pelo **tech lead** (gate manual hoje; Azure
   Pipelines environment gate no destino).
4. Tag `v*` marca a versão promovida.

## Configuração
- Variáveis e segredos por ambiente, **fora** da imagem (env do contêiner / cofre).
- Migrações Prisma aplicadas de forma controlada antes de subir a nova versão.
