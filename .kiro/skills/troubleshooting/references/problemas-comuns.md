# Problemas Comuns e Soluções

---

## 1. Docker / PostgreSQL

### Container não sobe

**Sintoma:** `docker compose up -d postgres` não inicia ou morre imediatamente.

**Diagnóstico:**
```bash
docker compose ps
docker compose logs postgres --tail=30
```

**Soluções comuns:**

| Erro no log | Solução |
|---|---|
| `port is already allocated` | Outra instância usando a porta. `sudo lsof -i :5432` e matar o processo, ou mudar a porta no `docker-compose.yml` |
| `data directory has wrong ownership` | `docker compose down -v` (apaga volumes) e subir novamente |
| `password authentication failed` | Verificar se `POSTGRES_PASSWORD` no `docker-compose.yml` bate com `DATABASE_URL` no `.env` |
| `no space left on device` | `docker system prune -f` para liberar espaço |

### Conexão recusada ao banco

**Sintoma:** `Connection refused` ao rodar Prisma ou iniciar a API.

**Diagnóstico:**
```bash
docker compose ps  # postgres deve estar "running"
docker compose exec postgres pg_isready
```

**Soluções:**
- Container não está rodando → `docker compose up -d postgres`
- Host errado no DATABASE_URL → deve ser `localhost` (não `postgres`) quando rodando fora do Docker
- Porta errada → verificar mapeamento no `docker-compose.yml`

---

## 2. Prisma

### `prisma migrate dev` falha

**Sintoma:** erro ao aplicar migração.

**Diagnóstico:**
```bash
npx prisma migrate status
```

**Soluções comuns:**

| Erro | Solução |
|---|---|
| `database does not exist` | Criar o banco: `docker compose exec postgres createdb -U postgres detran_dti_<sistema>` |
| `migration already applied` | Se quiser resetar (apenas local): `npx prisma migrate reset` |
| `P3009: migrate found failed migrations` | `npx prisma migrate resolve --rolled-back <migration-name>` |
| `Can't reach database server` | Verificar se PostgreSQL está rodando (ver seção 1) |

### Client desatualizado

**Sintoma:** tipos não batem, campos novos não aparecem no autocomplete.

**Solução:**
```bash
npx prisma generate
```

Sempre rodar `generate` após alterar `schema.prisma`.

---

## 3. Autenticação (Entra ID / MSAL)

### Login redireciona para página de erro

**Diagnóstico:** abrir o DevTools (F12) → Network → ver a URL de redirect.

**Soluções comuns:**

| Erro | Solução |
|---|---|
| `AADSTS700016: Application not found` | Client ID errado no `.env` |
| `AADSTS50011: Reply URL does not match` | Adicionar `http://localhost:5173` nos Redirect URIs na app registration do Azure |
| `AADSTS7000215: Invalid client secret` | Secret expirado — gerar novo no Azure Portal |
| Redirect infinito | Verificar se `AZURE_AD_TENANT_ID` está correto |

### Token 401 no backend

**Diagnóstico:**
```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/<endpoint>
```

**Soluções:**
- Token expirado → refazer login no frontend
- Audience errada → verificar se o `api://` URI está correto na app registration
- Guard não importado → verificar se o controller usa `@UseGuards(...)` corretamente

---

## 4. Build / TypeScript

### Erros de tipo após atualizar o contrato

**Solução:**
```bash
npm install @detran/shared-contract@latest
npx prisma generate  # se tipos do Prisma mudaram
```

### Import não encontrado

**Diagnóstico:** verificar se o caminho está correto (relativo ou do contrato).

**Soluções:**
- Caminho relativo errado → ajustar `./` ou `../`
- Pacote não instalado → `npm install`
- `tsconfig.json` com paths errados → verificar `baseUrl` e `paths`

### `any` implícito

**Sintoma:** `Parameter implicitly has an 'any' type`

**Solução:** tipar explicitamente. Nunca adicionar `// @ts-ignore` ou `as any`.

---

## 5. Frontend (React / Vite)

### Tela branca

**Diagnóstico:** abrir DevTools → Console → ver o erro.

**Soluções comuns:**

| Erro no console | Solução |
|---|---|
| `Module not found` | Verificar imports; pode ser caminho errado após renomeação |
| `CORS error` | Backend não está com CORS habilitado para `localhost:5173` |
| `ChunkLoadError` | Limpar cache: `rm -rf node_modules/.vite && npm run dev:web` |
| Erro de React hooks | Verificar se não há duas versões de React instaladas |

### HMR não atualiza

**Solução:**
```bash
rm -rf node_modules/.vite
npm run dev:web
```

Se persistir, pode ser problema de filesystem do WSL com arquivos em `/mnt/c/`:
- Solução: mover o projeto para `~/projetos/` (filesystem Linux nativo)

---

## 6. Backend (NestJS)

### 500 Internal Server Error

**Diagnóstico:** verificar os logs do terminal onde roda `npm run dev:api`.

**Soluções comuns:**
- `Cannot read properties of undefined` → dependência não injetada (faltou adicionar no module providers)
- `PrismaClientKnownRequestError` → verificar constraints do banco (FK, unique)
- Stack trace vazia → adicionar `app.useGlobalFilters(...)` para capturar exceções

### Endpoint retorna 404

**Soluções:**
- Controller não registrado no module
- Module não importado no `AppModule`
- Rota com prefixo errado (verificar `@Controller("...")`)
- Método HTTP errado (GET vs POST)

---

## 7. Git / SSH

### `Permission denied (publickey)`

**Diagnóstico:**
```bash
ssh -T git@github.com
ssh-add -l
```

**Soluções:**
- Chave não carregada → `eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519`
- Chave não adicionada no GitHub → `cat ~/.ssh/id_ed25519.pub` e adicionar em github.com/settings/ssh
- Arquivo de chave com permissão errada → `chmod 600 ~/.ssh/id_ed25519`

### Push rejeitado

| Erro | Solução |
|---|---|
| `rejected (non-fast-forward)` | Branch desatualizada → `git fetch origin && git rebase origin/main` |
| `protected branch` | Não pode dar push direto em main — use branch + PR |
| `remote: Permission denied` | Sem permissão no repo — falar com o tech lead |

---

## 8. Dependências / npm

### `npm install` falha

**Soluções comuns:**

| Erro | Solução |
|---|---|
| `ERESOLVE unable to resolve dependency tree` | `npm install --legacy-peer-deps` (temporário) ou alinhar versões |
| `404 Not Found @detran/shared-contract` | `.npmrc` não configurado para GitHub Packages — verificar token |
| `EACCES permission denied` | Nunca usar `sudo npm`. Corrigir permissões: `sudo chown -R $(whoami) ~/.npm` |
| `ENOSPC: no space left` | Limpar cache: `npm cache clean --force` e `docker system prune -f` |

### Pacote `@detran/shared-contract` não encontrado

**Diagnóstico:**
```bash
cat .npmrc  # deve ter o registry do GitHub Packages
npm whoami --registry=https://npm.pkg.github.com
```

**Solução:** verificar se o `.npmrc` tem o token de acesso ao GitHub Packages
e se o token tem scope `read:packages`.

---

## Fluxo de escalação

Se nenhuma solução acima resolver:

1. Coletar: mensagem de erro exata + comando que falhou + contexto
2. Verificar se é um problema de rede/proxy corporativo
3. Chamar o tech lead com as informações coletadas
4. Registrar o problema (e a solução, quando encontrada) para atualizar este guia
