# Guia Expand/Contract para Entidades Canônicas

Este guia detalha a disciplina de migração de schema canônico usada quando
uma entidade do `@detran/shared-contract` precisa sofrer uma alteração
incompatível (breaking change).

---

## Por que expand/contract?

Entidades canônicas são consumidas por múltiplos sistemas. Alterar a estrutura
diretamente quebraria todos os consumidores de uma vez. A disciplina garante
**zero downtime** e **migração gradual**.

---

## As 5 etapas

Cada etapa é um deploy separado. **Nunca** execute expand e contract no mesmo release.

### Etapa 1 — Expand (adicionar o novo)

- Adicione o novo campo/estrutura **sem remover o antigo**.
- O novo campo deve ser opcional ou ter um default seguro.
- Gere a migração Prisma (`npx prisma migrate dev --name expand-<descricao>`).
- Publique a nova versão do contrato como **minor** (compatível).

```prisma
// Antes
model Servidor {
  id           Int    @id @default(autoincrement())
  nomeCompleto String // campo antigo
}

// Depois (expand)
model Servidor {
  id           Int     @id @default(autoincrement())
  nomeCompleto String  // mantido (será removido no contract)
  nome         String? // novo campo — opcional durante a transição
  sobrenome    String? // novo campo — opcional durante a transição
}
```

**Deploy:** aplique a migração e suba a nova versão do núcleo.

---

### Etapa 2 — Dual-write (preencher os dois formatos)

- O sistema núcleo passa a escrever **nos dois formatos** simultaneamente.
- Toda escrita preenche tanto o campo antigo quanto o novo.
- Um script de backfill popula os novos campos para registros existentes.

```typescript
// No service do núcleo
async criarServidor(dados: CriarServidorDto) {
  return this.prisma.servidor.create({
    data: {
      nomeCompleto: `${dados.nome} ${dados.sobrenome}`, // antigo
      nome: dados.nome,           // novo
      sobrenome: dados.sobrenome, // novo
    },
  });
}
```

**Deploy:** suba o núcleo com dual-write. Execute o backfill.

---

### Etapa 3 — Migrar consumidores

- Notifique as equipes dos sistemas consumidores.
- Cada consumidor migra no seu ritmo para usar os novos campos.
- Atualize a versão do contrato em cada consumidor (minor).

```typescript
// Consumidor — antes
const nome = servidor.nomeCompleto;

// Consumidor — depois
const nome = `${servidor.nome} ${servidor.sobrenome}`;
```

**Deploy:** cada consumidor faz seu próprio deploy conforme migra.

---

### Etapa 4 — Verificar que ninguém usa o antigo

- Confirme que todos os consumidores migraram:
  - Busca no código por referências ao campo antigo.
  - Verificar logs/métricas de acesso ao campo antigo (se disponível).
- Documente a confirmação no PR de contract.

---

### Etapa 5 — Contract (remover o antigo)

- Remova o campo antigo do schema Prisma.
- Gere a migração (`npx prisma migrate dev --name contract-<descricao>`).
- Publique a nova versão do contrato como **major** (breaking).
- Commit com `!` e rodapé `BREAKING CHANGE:`.
- **Aprovação do tech lead obrigatória.**

```prisma
// Depois (contract)
model Servidor {
  id        Int    @id @default(autoincrement())
  nome      String
  sobrenome String
}
```

```
feat(contrato)!: remove campo nomeCompleto do modelo Servidor

BREAKING CHANGE: campo nomeCompleto removido. Consumidores devem usar nome + sobrenome.
```

**Deploy:** aplique a migração e suba.

---

## Diagrama temporal

```
Deploy 1: [Expand]       → novo campo adicionado (opcional)
Deploy 2: [Dual-write]   → núcleo escreve nos dois formatos + backfill
Deploy 3…N: [Consumidores migram] → cada um no seu ritmo
Deploy N+1: [Verificação] → confirma que ninguém usa o antigo
Deploy N+2: [Contract]   → remove o antigo (major, breaking, aprovação sênior)
```

---

## Regras

- Cada etapa é um deploy e um PR separado.
- Expand nunca no mesmo release que contract.
- Minor para expand; major para contract.
- Contract exige aprovação explícita do tech lead.
- Documente no PR de contract quais consumidores foram migrados e quando.

---

## Checklist

- [ ] Expand: novo campo adicionado, migração gerada
- [ ] Dual-write: núcleo preenche ambos os formatos
- [ ] Backfill: registros existentes populados
- [ ] Consumidores: todos migrados (listar quais e PRs)
- [ ] Verificação: nenhuma referência ao campo antigo
- [ ] Contract: campo removido, major publicado, BREAKING CHANGE no commit
- [ ] Aprovação do tech lead obtida
