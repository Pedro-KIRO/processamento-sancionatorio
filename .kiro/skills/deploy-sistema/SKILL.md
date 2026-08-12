---
name: deploy-sistema
description: Guiar deploy em homologação e promoção para produção seguindo build-once-promote. Ativa quando o dev menciona "deploy", "subir para homologação", "promover para produção", "como faço deploy", "subir a imagem", "publicar", "colocar no ar" ou "pipeline".
metadata:
  author: DTI/DETRAN-SP
  version: 3.0.0
  category: deployment
---

# Deploy de Sistema

Esta skill é ativada quando o dev menciona deploy, subir para homologação,
promover para produção, "como faço o deploy", "subir a imagem" ou similar.

## Princípios

1. **Build-once-promote:** a imagem Docker é construída UMA vez em homologação.
   Produção recebe exatamente a mesma imagem — nunca uma recompilação.
2. **Migrações após healthcheck:** migrações Prisma rodam via `docker exec` no
   container da API após ele ficar healthy.
3. **Segredos fora da imagem:** variáveis de ambiente via `.env` no servidor,
   nunca baked na imagem. Build-args de frontend (VITE_*) vêm de `vars.*` do
   repositório (variáveis públicas, não secrets).
4. **Gate manual para produção:** apenas o tech lead promove para produção.
5. **Isolamento total:** o pipeline de um sistema nunca afeta containers,
   volumes ou configurações de outros sistemas no mesmo servidor.
6. **GITHUB_TOKEN nativo:** autenticação no GHCR via `secrets.GITHUB_TOKEN`
   com `permissions: packages: write` — sem PAT manual.

## Fluxo resumido

```
push em main → build + push GHCR (ubuntu-latest) → deploy no servidor (self-hosted,homolog)
                                                            ↓
                                                    pull → compose up → healthcheck → migrate → nginx
                                                            ↓
                                                    validação + testes manuais
                                                            ↓
                                                gate manual (tech lead)
                                                            ↓
                                                    promoção → produção
                                                            ↓
                                                      tag v* no Git
```

## Pipeline de homologação (automático)

O workflow `.github/workflows/deploy-homolog.yml` usa **2 jobs**:

### Job 1: build-and-push (ubuntu-latest)

| Step | Ação |
|------|------|
| 1 | Checkout |
| 2 | Login GHCR (`docker/login-action@v3` + `GITHUB_TOKEN`) |
| 3 | Build + push Backend (`docker/build-push-action@v5`, tags: latest + SHA) |
| 4 | Build + push Frontend (com `build-args` de `vars.*`) |

### Job 2: deploy (self-hosted, homolog)

| Step | Ação | Se falhar |
|------|------|-----------|
| 1 | Pull imagens | Abort |
| 2 | Compose up --force-recreate | Abort |
| 3 | Healthcheck polling (30 tentativas × 5s = 150s) | Abort + logs |
| 4 | Prisma migrate deploy (via docker exec) | Abort |
| 5 | Nginx ativação (1º deploy, com rollback) | Reverte + reporta |
| 6 | Image prune | Non-blocking |

### Autenticação no GHCR

```yaml
permissions:
  contents: read
  packages: write

- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}
```

**Não precisa** de PAT nem de secret `GHCR_TOKEN`. O `GITHUB_TOKEN` é fornecido
automaticamente pelo GitHub Actions.

### Variáveis de repositório (vars.*)

Build-args do frontend são configurados como **variáveis** (não secrets) em
Settings → Secrets and variables → Actions → Variables:

| Variável | Uso |
|----------|-----|
| `VITE_ENTRA_TENANT_ID` | Tenant ID do Entra/Azure AD |
| `VITE_ENTRA_CLIENT_ID` | Client ID do App Registration |
| `VITE_REDIRECT_URI` | URL de redirect em homologação |

Valores não sensíveis — por isso usam `vars.*` em vez de `secrets.*`.

### Convenções de nomenclatura de imagens

Padrão da organização Detran-SP no GHCR:
- Backend: `ghcr.io/detran-sp/detran-dti-<sistema>-back:latest`
- Frontend: `ghcr.io/detran-sp/detran-dti-<sistema>-front:latest`

Sufixos: **`-back`** e **`-front`** (não `-api`/`-web`).

### Convenções do compose de homologação

Arquivo: `/srv/detran/sistemas/<sistema>/homolog.docker-compose.yml`

```yaml
services:
  <sistema>-back:
    image: ghcr.io/detran-sp/detran-dti-<sistema>-back:latest
    container_name: <sistema>-back
    restart: unless-stopped
    env_file:
      - .env
    networks:
      - detran-network-homolog
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  <sistema>-front:
    image: ghcr.io/detran-sp/detran-dti-<sistema>-front:latest
    container_name: <sistema>-front
    restart: unless-stopped
    networks:
      - detran-network-homolog

networks:
  detran-network-homolog:
    external: true
    name: detran-network-homolog
```

**Regras:**
- Backend porta 3001, frontend porta 3000 (internas ao container)
- PostgreSQL NÃO vai no compose (roda na VM, fora do Docker)
- Container names explícitos (facilita `docker exec` e healthcheck)
- Rede externa compartilhada `detran-network-homolog`

### Runner labels

O job de deploy usa labels `[self-hosted, homolog]`. O runner no servidor de
homologação deve ter esses labels configurados.

### Nginx — IMPORTANTE: bind mount read-only

O container `detran-nginx` monta o diretório de configurações como **read-only**:

```
/srv/detran/plataforma/nginx/conf.d/ → /etc/nginx/conf.d/ (ro)
```

**Consequência:** NÃO é possível usar `docker exec ... mv` dentro do container.
Toda manipulação de arquivos de config deve ser feita **no host**, no path real:

```bash
# CORRETO — opera no host
mv /srv/detran/plataforma/nginx/conf.d/<sistema>.conf.ready /srv/detran/plataforma/nginx/conf.d/<sistema>.conf

# ERRADO — falha com "Read-only file system"
docker exec detran-nginx mv /etc/nginx/conf.d/<sistema>.conf.ready /etc/nginx/conf.d/<sistema>.conf
```

Após alterar arquivos no host, `nginx -t` e `nginx -s reload` funcionam via
`docker exec` (leitura é permitida no mount ro).

### Pré-requisito no servidor para primeiro deploy

Antes do primeiro deploy de um sistema, o arquivo de config nginx deve existir:
```
/srv/detran/plataforma/nginx/conf.d/<sistema>.conf.ready
```

O workflow renomeia `.ready` → `.conf` automaticamente no primeiro deploy.

## O que fazer

1. Identifique em qual etapa o dev está (build, homologação ou promoção).
2. Guie conforme o runbook em `references/runbook.md`.
3. Antes de qualquer promoção, execute o script `scripts/pre-deploy-check.sh`.

**Nota sobre automação:** para deploy em homologação (merge em main), o workflow
do GitHub Actions executa tudo automaticamente sem intervenção.
Para promoção a produção, o gate manual do tech lead é OBRIGATÓRIO — nunca
automatizar essa etapa.

## Referências

- Runbook completo: [references/runbook.md](references/runbook.md)
- Script de verificação: [scripts/pre-deploy-check.sh](scripts/pre-deploy-check.sh)
- Migrações canônicas: skill `migration-canonico`
