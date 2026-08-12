# Checklist de Revisão de PR

Use este checklist para toda revisão de código antes de aprovar ou abrir um PR.

---

## 1. Compreensão do código

- [ ] O autor consegue explicar cada linha (incluindo código gerado por IA)?
- [ ] O propósito da mudança está claro no título e descrição do PR?

## 2. TypeScript estrito

- [ ] Nenhum `any` implícito ou explícito sem justificativa documentada.
- [ ] `strict: true` mantido no `tsconfig.json`.
- [ ] Tipos de retorno explícitos em funções públicas.

## 3. Contrato compartilhado (`@detran/shared-contract`)

- [ ] Tipos e DTOs canônicos importados do contrato — nunca redeclarados localmente.
- [ ] Entidades canônicas tratadas como somente-leitura (exceto se este sistema é o núcleo).
- [ ] Nenhuma reimplementação de validação de JWT, guards ou cliente OIDC.

## 4. Segurança e autenticação

- [ ] Autenticação e autorização usam exclusivamente o pacote de auth do contrato.
- [ ] Guards aplicados em todos os endpoints que exigem autenticação.
- [ ] Escopo de autorização derivado de dados canônicos, nunca de valor enviado pelo cliente.
- [ ] Ações sensíveis (aprovar, excluir, alterar permissão) registram log de auditoria.

## 5. Commits e versionamento

- [ ] Mensagens de commit seguem Conventional Commits (`tipo(escopo): descrição`).
- [ ] Breaking change em contrato ou entidade canônica marcado com `!` no tipo/escopo.
- [ ] Breaking change aplica disciplina expand/contract (ver `migration-canonico` skill).
- [ ] Aprovação do tech lead obtida para breaking changes.

## 6. Banco de dados e Prisma

- [ ] Migrações Prisma geradas (`npx prisma migrate dev`) e revisadas manualmente.
- [ ] Modelagem relacional com integridade referencial — sem "lista plana" (anti-pattern SharePoint).
- [ ] Campos obrigatórios, defaults e constraints definidos no schema.
- [ ] Nenhuma migration destrutiva sem confirmação explícita.

## 7. Segredos e variáveis de ambiente

- [ ] Nenhum segredo (token, senha, chave) presente no diff.
- [ ] Novas variáveis de ambiente adicionadas ao `.env.example` com valor placeholder.
- [ ] Segredos passados via variável de ambiente do contêiner, nunca na imagem.

## 8. Qualidade e execução local

- [ ] O projeto roda localmente sem quebrar (`npm run dev:api` + `npm run dev:web`).
- [ ] Alteração não quebra a build de homologação.
- [ ] Imports na ordem correta: (1) libs externas, (2) `@detran/shared-contract`, (3) internos.
- [ ] Nomes de arquivo em `kebab-case`; classes/componentes em `PascalCase`.

## 9. Organização

- [ ] Código organizado por domínio, não por tipo técnico.
- [ ] Módulo NestJS com `*.controller.ts`, `*.service.ts`, `*.module.ts` e DTOs em `dto/`.
- [ ] Nenhum código morto ou comentado sem justificativa.

---

> **Dica:** se mais de 3 itens falharem, considere pedir ao autor que refatore antes de
> uma segunda rodada de revisão.
