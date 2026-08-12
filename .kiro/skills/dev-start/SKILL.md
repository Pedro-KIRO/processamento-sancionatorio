---
name: dev-start
description: Subir o ambiente de desenvolvimento local completo — PostgreSQL, API e frontend. Ativa quando o dev menciona "subir local", "rodar o sistema", "iniciar dev", "dev start", "subir a app", "npm run dev", "docker-compose up" ou "quero desenvolver".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: development
---

# Dev Start — Subir Ambiente Local

Esta skill sobe o ambiente de desenvolvimento completo: banco de dados,
backend e frontend. Ativa quando o dev menciona "subir local", "rodar o sistema",
"iniciar dev", "dev start" ou similar.

## Pré-requisitos (verificar antes)

```bash
docker --version         # Docker instalado
docker info              # Daemon rodando
node --version           # Node 20+
ls package.json          # Está na raiz do projeto
```

Se Docker não estiver rodando:
```bash
sudo systemctl start docker
```

Se `node` não encontrado:
```bash
source ~/.nvm/nvm.sh
```

## As 3 etapas (executar na ordem)

### Etapa 1 — Subir PostgreSQL

```bash
docker-compose up -d postgres
```

Aguardar e verificar:
```bash
docker-compose ps
```

O container deve estar `Up (healthy)`.

Se já estiver rodando (de sessão anterior), pular esta etapa.

**Se falhar:**
- `port already allocated` → outra instância na porta 5432. Matar com `sudo lsof -i :5432`
- Docker daemon não rodando → `sudo systemctl start docker`
- Permissão negada → fechar e reabrir terminal WSL (grupo docker)

---

### Etapa 2 — Subir a API (backend)

Iniciar em background:
```bash
npm run dev:api
```

Esperar pela mensagem:
```
API rodando na porta 3000
```

Testar:
```bash
curl -s http://localhost:3000/<modulo-principal>
```

Resultado esperado: `[]` (lista vazia) ou JSON com dados.

> **Nota:** o `nest start --watch` mantém a compilação ativa — alterações
> nos arquivos `.ts` são recompiladas automaticamente.

---

### Etapa 3 — Subir o Frontend (web)

Iniciar em outro terminal:
```bash
npm run dev:web
```

Esperar pela mensagem:
```
VITE ready in Xms
➜  Local: http://localhost:5173/
```

Testar:
```bash
curl -s http://localhost:5173 | head -5
```

Resultado esperado: HTML com `<!DOCTYPE html>`.

---

## Mensagem final ao dev

Após as 3 etapas, validar e apresentar:

```bash
curl -s http://localhost:3000/<modulo-principal>   # Esperado: [] ou JSON
curl -s http://localhost:5173 | head -3            # Esperado: <!DOCTYPE html>
```

Se ambos responderam, exibir:

```
══════════════════════════════════════════════════════════════════
  ✅ Ambiente de desenvolvimento rodando!
══════════════════════════════════════════════════════════════════

  🗄️  PostgreSQL:  localhost:5432
  🔧 API:         http://localhost:3000
  🌐 Frontend:    http://localhost:5173

  👉 Valide no browser:
     • http://localhost:5173 — tela de boas-vindas / app React
     • http://localhost:3000/<modulo> — endpoint da API (retorna [])

  Comandos úteis:
     • Parar tudo: Ctrl+C nos terminais + docker-compose down
     • Reiniciar banco: docker-compose down -v && docker-compose up -d postgres
     • Recriar migrations: npx prisma migrate dev --name <descricao>

  Para iniciar o desenvolvimento das regras de negócio:
     1. Abra uma Spec session → Command Palette → Kiro: New Spec Session
     2. Descreva a funcionalidade que quer implementar
     3. O Kiro conduz por Requirements → Design → Tasks

══════════════════════════════════════════════════════════════════
```

Se algum não respondeu, informar qual falhou e sugerir `/troubleshooting`.

---

## Variações

### Subir apenas o banco (para rodar testes ou migrations)

```bash
docker-compose up -d postgres
```

### Subir tudo de uma vez (se o docker-compose tiver todos os serviços)

```bash
docker-compose up -d
```

### Verificar se já está rodando

```bash
docker-compose ps          # banco
curl -s localhost:3000     # API
curl -s localhost:5173     # frontend
```

Se já estiver tudo no ar, informar ao dev e não subir novamente.

## O que NÃO fazer

- Não rodar `npm run dev:api` e `npm run dev:web` no mesmo terminal (um bloqueia o outro)
- Não usar `sudo` para npm (resolve com permissões, não com root)
- Não alterar o `docker-compose.yml` para portas não-padrão sem motivo

## Referências

- Docker compose do projeto: `docker-compose.yml`
- Variáveis de ambiente: `.env`
- Troubleshooting: skill `/troubleshooting`
