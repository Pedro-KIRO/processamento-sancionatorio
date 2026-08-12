---
inclusion: always
---

# Contrato Compartilhado — Como Consumir

O pacote `@detran/shared-contract` é a **fonte única da verdade** de tipos, DTOs, modelos
canônicos, tokens de UI e do cliente de autenticação. Todo sistema o consome.

## O que o pacote fornece
- **Tipos e DTOs canônicos** das entidades compartilhadas.
- **Pacote de auth** (NestJS): validação de JWT do Entra (OIDC), guards de App Roles e
  utilitários de permissão fina.
- **Tokens de UI** para identidade visual consistente.

## Regras de consumo
- Importe tipos canônicos do contrato; **não os redeclare** localmente.
- Sistemas que **não são o núcleo** tratam entidades canônicas como **somente leitura** —
  nunca como fonte; persistem apenas o que é do seu próprio domínio, referenciando o
  identificador canônico.
- Segurança vem **exclusivamente** do pacote de auth do contrato.

## Versionamento (SemVer)
- **patch/minor:** compatível; consuma livremente.
- **major (breaking):** exige disciplina **expand/contract** (ver `migration-nucleo.md`) e
  **aprovação do tech lead**. O commit deve marcar breaking change (ver `git-commits.md`).

## Princípio
**Centralizar o contrato, liberar a implementação:** o modelo, a auth e os tokens são
compartilhados; a implementação de cada sistema é livre.
