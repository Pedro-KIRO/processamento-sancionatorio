# Runbook de Deploy

Este runbook descreve o fluxo completo de deploy seguindo o padrão **build-once-promote**.

---

## Visão geral do fluxo

```
push em main → Job 1: build + push GHCR (ubuntu-latest)
                    ↓
               Job 2: deploy no servidor (self-hosted, homolog)
                    ↓
               pull → compose up → healthcheck → migrate → nginx → prune
```

A imagem Docker é construída **uma única vez** no GitHub Actions (ubuntu-latest).
O servidor de homologação apenas faz pull e sobe os containers.

---

## 1. Deploy em homologação (automático via GitHub Actions)

O deploy é **100% automático** no push em `main`. Não precisa de intervenção.

### Workflow: `.github/workflows/deploy-homolog.yml`

**Job 1 — build-and-push** (ubuntu-latest):
- Autenticação no GHCR via `GITHUB_TOKEN` (automático, sem PAT)
- Build com actions oficiais (`docker/build-push-action@v5`)
- Tags: `latest` + SHA completo do commit
- Frontend recebe build-args de `vars.*` do repositório

**Job 2 — deploy** (self-hosted, homolog):
- Pull das imagens :latest
- `docker compose -f homolog.docker-compose.yml up -d --force-recreate`
- Healthcheck polling (30 × 5s = 150s max)
- `docker exec <sistema>-api npx prisma migrate deploy`
- Ativação nginx (primeiro deploy apenas)
- `docker image prune -f`

### Configuração necessária no repositório GitHub

**Variables** (Settings → Actions → Variables):
- `VITE_ENTRA_TENANT_ID`
- `VITE_ENTRA_CLIENT_ID`
- `VITE_REDIRECT_URI`

**Secrets:** nenhum necessário (usa `GITHUB_TOKEN` nativo).

**Runner:** precisa ter labels `[self-hosted, homolog]`.

---

## 2. Build manual (caso necessário)

```bash
# Login no GHCR (se não estiver logado)
echo $GITHUB_TOKEN | docker login ghcr.io -u <usuario> --password-stdin

# API (com duas tags: latest e SHA)
docker build \
  -f apps/api/Dockerfile \
  --target production \
  -t ghcr.io/detran-sp/detran-dti-<sistema>-back:latest \
  -t ghcr.io/detran-sp/detran-dti-<sistema>-back:$(git rev-parse HEAD) \
  .

# Web (com build-args VITE_*)
docker build \
  -f apps/web/Dockerfile \
  --target production \
  --build-arg VITE_ENTRA_TENANT_ID=<valor> \
  --build-arg VITE_ENTRA_CLIENT_ID=<valor> \
  --build-arg VITE_REDIRECT_URI=<valor> \
  -t ghcr.io/detran-sp/detran-dti-<sistema>-front:latest \
  .

# Push
docker push ghcr.io/detran-sp/detran-dti-<sistema>-back:latest
docker push ghcr.io/detran-sp/detran-dti-<sistema>-front:latest
```

---

## 3. Deploy manual no servidor

Se precisar fazer deploy manual no servidor de homologação:

```bash
# Pull das imagens atualizadas
docker pull ghcr.io/detran-sp/detran-dti-<sistema>-back:latest
docker pull ghcr.io/detran-sp/detran-dti-<sistema>-front:latest

# Subir containers
cd /srv/detran/sistemas/<sistema>/
docker compose -f homolog.docker-compose.yml up -d --force-recreate

# Aguardar healthcheck
docker inspect --format='{{.State.Health.Status}}' <sistema>-back

# Migrations
docker exec <sistema>-back npx prisma migrate deploy --schema=prisma/schema.prisma
```

### Checklist pós-deploy homologação

- [ ] `docker inspect --format='{{.State.Health.Status}}' <sistema>-back` = "healthy"
- [ ] `curl -s http://localhost:3001/health` retorna 200
- [ ] Container web responde na porta 3000
- [ ] Nginx gateway roteia corretamente
- [ ] Login via Entra funciona
- [ ] Logs sem erros: `docker logs --tail=50 <sistema>-back`
- [ ] Nenhum container de outro sistema afetado

---

## 4. Ativação do Nginx (primeiro deploy apenas)

No primeiro deploy de um sistema, o nginx precisa ser ativado.

**IMPORTANTE:** O container `detran-nginx` monta conf.d como **read-only**.
Manipule os arquivos **no host** (`/srv/detran/plataforma/nginx/conf.d/`),
nunca via `docker exec ... mv`.

```bash
NGINX_CONF_DIR="/srv/detran/plataforma/nginx/conf.d"

if [ -f "${NGINX_CONF_DIR}/<sistema>.conf.ready" ]; then
  mv "${NGINX_CONF_DIR}/<sistema>.conf.ready" "${NGINX_CONF_DIR}/<sistema>.conf"

  if ! docker exec detran-nginx nginx -t; then
    mv "${NGINX_CONF_DIR}/<sistema>.conf" "${NGINX_CONF_DIR}/<sistema>.conf.ready"
    echo "ERRO: nginx -t falhou, configuração revertida"
    exit 1
  fi

  docker exec detran-nginx nginx -s reload
  echo "Nginx ativado"
else
  echo "Nginx já ativo — skip"
fi
```

Em deploys subsequentes, a etapa é ignorada automaticamente.

---

## 5. Promoção para produção

**Quem pode:** apenas o tech lead, via gate manual.

### Pré-requisitos

- [ ] Script `pre-deploy-check.sh` executado com sucesso
- [ ] Testes em homologação aprovados
- [ ] Tag de versão criada:

```bash
git tag v<MAJOR>.<MINOR>.<PATCH>
git push origin v<MAJOR>.<MINOR>.<PATCH>
```

### Execução

```bash
# Na VM de produção

# 1. Pull imagens (mesmas de homologação)
docker pull ghcr.io/detran-sp/detran-dti-<sistema>-back:latest
docker pull ghcr.io/detran-sp/detran-dti-<sistema>-front:latest

# 2. Subir containers
cd /srv/detran/sistemas/<sistema>/
docker compose -f prod.docker-compose.yml up -d --force-recreate

# 3. Migrations
docker exec <sistema>-back npx prisma migrate deploy --schema=prisma/schema.prisma

# 4. Verificar
curl -s https://<sistema>.detran.sp.gov.br/api/health | jq .
```

---

## 6. Rollback

Se algo der errado em produção:

```bash
cd /srv/detran/sistemas/<sistema>/
docker compose -f prod.docker-compose.yml down

# Alterar a tag para a versão anterior no .env ou compose
docker compose -f prod.docker-compose.yml up -d
```

Para rollback de migração, aplique uma migração reversa (nunca `prisma migrate reset`
em produção).

---

## 7. Variáveis de ambiente

### No servidor (.env)

Segredos são passados via `.env` no servidor (nunca commitado):
- `DATABASE_URL` — conexão com PostgreSQL
- `PORT` — porta do backend (3001)
- `NODE_ENV` — production

### No GitHub (variáveis do repositório)

| Variável | Tipo | Uso |
|----------|------|-----|
| `VITE_ENTRA_TENANT_ID` | Variable | Build-arg frontend |
| `VITE_ENTRA_CLIENT_ID` | Variable | Build-arg frontend |
| `VITE_REDIRECT_URI` | Variable | Build-arg frontend |

- `GITHUB_TOKEN` é automático (não precisa configurar)
- Nunca inclua segredos na imagem Docker
- Novas variáveis devem ser documentadas no `.env.example`

---

## 8. Infraestrutura compartilhada

### O que NÃO alterar

- Docker Compose raiz do servidor
- `nginx.conf` principal
- Scripts de inicialização do PostgreSQL
- Rede `detran-network-homolog` (apenas usar como external)
- Containers de outros sistemas

### O que o pipeline pode alterar

- Apenas arquivos em `/srv/detran/sistemas/<sistema>/`
- Apenas `<sistema>.conf` no container nginx (ativação no 1º deploy)
- `docker image prune -f` (remove apenas imagens sem tag — seguro)
