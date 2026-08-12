# Guia Completo de Branches

---

## Branches permanentes

| Branch | Propósito |
|--------|-----------|
| `main` | Única branch permanente. Merge em main dispara deploy automático em homologação. |

- Ninguém faz push direto em `main` — nunca, sem exceção.
- Não existem branches `develop`, `staging` ou similares.

---

## Nomenclatura de branches (obrigatória)

O prefixo deve espelhar o tipo de commit que será feito:

| Prefixo | Quando usar |
|---------|-------------|
| `feat/<descricao-curta>` | Nova funcionalidade |
| `fix/<descricao-curta>` | Correção de bug |
| `docs/<descricao-curta>` | Apenas documentação |
| `refactor/<descricao-curta>` | Refatoração sem mudança de comportamento |
| `chore/<descricao-curta>` | Manutenção sem afetar produção |

### Regras do nome

- `kebab-case`, sem acentos, sem espaços
- Curto e descritivo
- Nunca usar nomes genéricos

### Exemplos corretos ✅

```
feat/aprovacao-ferias
fix/login-redirect
docs/roteiro-deploy
refactor/extrair-service-email
chore/atualizar-prisma-5
feat/relatorio-ponto-mensal
fix/validacao-cpf-duplicado
```

### Exemplos incorretos ❌

```
feat/alteracoes          → genérico demais
fix/bug                  → não diz qual bug
minha-branch             → sem prefixo
feature/nova-tela        → prefixo errado (feature/ em vez de feat/)
feat/Aprovação-Férias    → PascalCase e acentos
hotfix/correcao-urgente  → prefixo não padronizado (use fix/)
feat/login fix/logout    → espaço no nome
```

---

## Fluxo obrigatório do dev

### Passo 1 — Partir de main atualizado

```bash
git checkout main
git pull
```

**Por que:** garante que sua branch parte do estado mais recente. Branches
criadas a partir de código desatualizado geram conflitos desnecessários.

---

### Passo 2 — Criar a branch com prefixo correto

```bash
git checkout -b feat/<descricao-curta>
```

**Por que:** o prefixo comunica a intenção da mudança e alinha com a convenção
de commits.

---

### Passo 3 — Commits pequenos e frequentes

Siga Conventional Commits (ver `.kiro/steering/git-commits.md`):

```bash
git add <arquivos-especificos>
git commit -m "feat(ferias): adiciona validacao de periodo"
```

**Por que:** commits atômicos facilitam revisão, bisect e rollback.

---

### Passo 4 — Push da branch

```bash
git push -u origin feat/<descricao-curta>
```

**Por que:** `-u` configura o tracking para futuros pushes. O push remoto
permite abrir o PR.

---

### Passo 5 — Abrir o Pull Request

```bash
gh pr create --base main --title "feat(ferias): adiciona validacao de periodo" --reviewer <tech-lead-usuario>
```

Ou pela interface do GitHub.

Requisitos do PR:
- **Título:** formato `tipo(escopo): descrição` (igual ao commit principal)
- **Descrição:** o que foi feito, como testar, prints se for visual
- **Reviewer:** tech lead marcado como reviewer obrigatório

**Por que:** o PR é o ponto de controle de qualidade. Sem reviewer definido,
ninguém revisa.

---

### Passo 6 — Aguardar revisão

- **NÃO fazer merge**, mesmo que tenha permissão.
- Responder comentários e fazer ajustes conforme solicitado.
- Cada push adicional na branch atualiza o PR automaticamente.

---

### Passo 7 — Após aprovação e merge (feito pelo tech lead)

```bash
git checkout main
git pull
git branch -d feat/<descricao-curta>
git push origin --delete feat/<descricao-curta>
```

**Por que:** manter branches mortas polui o repositório e causa confusão.

---

## Tabela de responsabilidades

| Ação | Responsável |
|------|-------------|
| Criar a branch | Dev |
| Commitar e fazer push | Dev |
| Abrir o PR | Dev |
| Responder revisões e ajustar | Dev |
| Revisar o código | Tech lead |
| Aprovar o PR | Tech lead |
| Executar o merge em main | Tech lead (somente ele) |
| Deletar a branch após merge | Dev |

---

## Situações especiais

### Atualizar meu ambiente local

Quando a equipe mergeou PRs em main e você precisa pegar as novidades:

```bash
bash scripts/atualizar-ambiente.sh
```

O script faz tudo automaticamente:
1. Avisa se há trabalho não commitado
2. Troca para main e faz `git pull`
3. Roda `npm install` se package.json mudou
4. Roda `prisma generate` + `prisma migrate dev` se o schema mudou
5. Mostra resumo do que foi atualizado

Se estiver no meio de uma branch de trabalho, após atualizar faça rebase:
```bash
git checkout feat/<sua-branch>
git rebase main
```

---

### Branch desatualizada em relação à main

Fazer **rebase** (nunca merge de main na branch):

```bash
git fetch origin
git rebase origin/main
```

Se houver conflitos, resolver localmente:

```bash
# Resolver os arquivos conflitantes, depois:
git add <arquivos-resolvidos>
git rebase --continue
```

Após o rebase, forçar o push (a branch é só sua):

```bash
git push --force-with-lease
```

**Por que:** rebase mantém o histórico linear e limpo. Merge de main na branch
cria commits desnecessários e dificulta a revisão.

---

### Dois devs no mesmo contexto

- Cada um em sua **própria branch**.
- Nunca compartilhar branch de trabalho.
- Se precisam de código um do outro, esperar o merge em main ou extrair
  a dependência em um PR separado primeiro.

---

### Branch esquecida/abandonada

- Branch sem commit há mais de 2 semanas deve ser comunicada ao tech lead.
- O tech lead decide: deletar ou dar prazo para finalização.

---

## O que é proibido

| Ação proibida | Por que |
|---------------|---------|
| Push direto em main | Main é protegida; qualquer mudança precisa de PR revisado |
| Dev fazer merge | Merge é responsabilidade exclusiva do tech lead |
| Criar branch a partir de outra branch de trabalho | Pode herdar código não revisado; sempre partir de main |
| Branch sem prefixo | Quebra a convenção e dificulta a leitura do repositório |
| PR sem reviewer | Sem revisão não há controle de qualidade |
| Merge de main na branch | Use rebase para manter histórico linear |
| Nomes genéricos (feat/alteracoes, fix/bug) | Não comunicam a intenção; impossível entender sem abrir |
