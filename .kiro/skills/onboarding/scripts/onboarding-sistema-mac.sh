#!/usr/bin/env bash
# ==========================================================================
# onboarding-sistema-mac.sh — Cria e inicializa um sistema novo (macOS)
# ==========================================================================
# Uso:
#   bash onboarding-sistema-mac.sh
#
# Pre-requisitos (verificados automaticamente):
#   - setup-ambiente-mac.sh ja executado (Node 20+, Docker Desktop, gh autenticado)
#   - Estar dentro de ~/projetos/detran-dti-platform-template
#   - Docker Desktop rodando
#
# O script:
#   1. Coleta dados do sistema
#   2. Cria o repositorio na org Detran-SP
#   3. Sincroniza steerings
#   4. Preenche dominio.md
#   5. Configura .env
#   6. npm install
#   7. Sobe PostgreSQL
#   8. Prisma generate + migrate
#   9. Renomeia modulo de exemplo
#  10. Verifica build
#  11. Commit + push inicial
# ==========================================================================

set -euo pipefail

# --- Verificar que estamos no macOS ---
if [[ "$(uname)" != "Darwin" ]]; then
  echo "[ERRO] Este script e para macOS. No Windows/WSL, use onboarding-sistema.sh"
  exit 1
fi

# --- Carregar nvm (necessario para npx/node) ---
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# --- Cores ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[ERRO]${NC} $1"; exit 1; }
step() { echo -e "\n${GREEN}===== $1 =====${NC}"; }

# --- Funcao para converter kebab-case em PascalCase (macOS-compatible) ---
to_pascal() {
  local result=""
  IFS='-' read -ra PARTS <<< "$1"
  for part in "${PARTS[@]}"; do
    result+="$(echo "${part:0:1}" | tr '[:lower:]' '[:upper:]')${part:1}"
  done
  echo "$result"
}

# --- Funcao para converter kebab-case em camelCase ---
to_camel() {
  local pascal
  pascal=$(to_pascal "$1")
  echo "$(echo "${pascal:0:1}" | tr '[:upper:]' '[:lower:]')${pascal:1}"
}

# --- Funcao sed in-place compativel com macOS ---
sed_i() {
  sed -i '' "$@"
}

# --- Funcao docker compose compativel ---
docker_compose() {
  if command -v docker-compose &>/dev/null; then
    docker-compose "$@"
  else
    docker compose "$@"
  fi
}

# ==========================================================================
# PRE-REQUISITOS
# ==========================================================================
echo -e "${CYAN}"
echo "==========================================="
echo "  Onboarding de Sistema (macOS) — DETRAN-SP"
echo "==========================================="
echo -e "${NC}"

step "Verificando pre-requisitos"

command -v node &>/dev/null || fail "Node.js nao instalado. Execute setup-ambiente-mac.sh primeiro."
command -v docker &>/dev/null || fail "Docker nao instalado. Instale Docker Desktop primeiro."
command -v gh &>/dev/null || fail "gh CLI nao instalado. Execute: brew install gh"
gh auth status &>/dev/null || fail "gh nao autenticado. Execute: gh auth login"

# Verificar Docker rodando
docker info &>/dev/null 2>&1 || fail "Docker nao esta rodando. Abra o Docker Desktop e aguarde."

NODE_MAJOR=$(node --version | cut -d. -f1 | tr -d v)
[[ "$NODE_MAJOR" -ge 20 ]] || fail "Node.js deve ser >= 20. Atual: $(node --version)"

ok "Node.js $(node --version)"
ok "Docker $(docker --version | cut -d' ' -f3 | tr -d ',')"
ok "gh autenticado"

# ==========================================================================
# COLETA DE DADOS
# ==========================================================================
step "Dados do sistema"

echo ""
echo "Responda as perguntas abaixo para criar o sistema:"
echo ""

# 1. Nome do sistema
while true; do
  read -rp "Nome do sistema (ex.: ponto-digital, ferias, controle-acesso): " SISTEMA_NOME
  if [[ "$SISTEMA_NOME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    break
  else
    warn "Nome invalido. Use apenas letras minusculas, numeros e hifens."
  fi
done

REPO_NOME="detran-dti-${SISTEMA_NOME}"
REPO_FULL="Detran-SP/${REPO_NOME}"

# 2. Nome do modulo
MODULO_DEFAULT=$(echo "$SISTEMA_NOME" | cut -d- -f1)
read -rp "Nome do modulo principal da API [${MODULO_DEFAULT}]: " MODULO_NOME
MODULO_NOME="${MODULO_NOME:-$MODULO_DEFAULT}"

# Derivar nomes
PASCAL=$(to_pascal "$MODULO_NOME")
CAMEL=$(to_camel "$MODULO_NOME")

# 3. Descricao
read -rp "Descricao curta (o que o sistema faz e para quem): " SISTEMA_DESC
SISTEMA_DESC="${SISTEMA_DESC:-Sistema ${SISTEMA_NOME} do DETRAN-SP.}"

# 4. Entidades canonicas
read -rp "Entidades canonicas que consome (ex.: Servidor, Departamento — ou 'nenhuma'): " ENTIDADES
ENTIDADES="${ENTIDADES:-nenhuma}"

echo ""
echo -e "${CYAN}Confirmacao:${NC}"
echo "  Repositorio: ${REPO_FULL}"
echo "  Modulo API:  ${MODULO_NOME} (classe: ${PASCAL}Module)"
echo "  Descricao:   ${SISTEMA_DESC}"
echo "  Entidades:   ${ENTIDADES}"
echo ""
read -rp "Confirma? (s/N): " CONFIRMA
[[ "$CONFIRMA" =~ ^[sS]$ ]] || fail "Cancelado pelo usuario."

# ==========================================================================
# ETAPA 1 — Criar repositorio
# ==========================================================================
step "Etapa 1 — Criar repositorio"

cd ~/projetos

if [[ -d "$REPO_NOME" ]]; then
  warn "Pasta ${REPO_NOME} ja existe. Usando a existente."
  cd "$REPO_NOME"
else
  gh repo create "$REPO_FULL" \
    --template Detran-SP/detran-dti-platform-template \
    --private \
    --clone
  cd "$REPO_NOME"
  ok "Repositorio criado: ${REPO_FULL}"
fi

# Verificar remote
REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
if echo "$REMOTE_URL" | grep -q "platform-template"; then
  fail "Remote aponta para o template! Algo deu errado na criacao."
fi
ok "Remote: ${REMOTE_URL}"

# ==========================================================================
# ETAPA 2 — Sincronizar steerings
# ==========================================================================
step "Etapa 2 — Sincronizar steerings"

if [[ -f "./scripts/sync-steering.sh" ]]; then
  chmod +x ./scripts/sync-steering.sh
  if [[ -d "../detran-contrato-compartilhado" ]]; then
    ./scripts/sync-steering.sh ../detran-contrato-compartilhado
    ok "Steerings sincronizados"
  else
    warn "Contrato compartilhado nao encontrado em ~/projetos/. Steerings nao sincronizados."
  fi
else
  warn "Script sync-steering.sh nao encontrado. Pulando."
fi

# ==========================================================================
# ETAPA 3 — Preencher dominio.md
# ==========================================================================
step "Etapa 3 — Preencher dominio.md"

DOMINIO_FILE=".kiro/steering/dominio.md"

if [[ -f "$DOMINIO_FILE" ]]; then
  cat > "$DOMINIO_FILE" << DOMINIOEOF
---
inclusion: always
---

# Domínio — ${PASCAL}

## Identidade do sistema
- **Nome:** \`${SISTEMA_NOME}\`
- **Descrição:** ${SISTEMA_DESC}
- **É o núcleo?** NÃO — consome entidades canônicas.

## Entidades canônicas
- **Consome do contrato:** ${ENTIDADES}.
- **Publica (apenas se for o núcleo):** não se aplica.

## Regras de negócio
(A definir pelo dev responsável durante o desenvolvimento.)

## Regra de autorização
(A definir pelo dev responsável durante o desenvolvimento.)

## Módulos principais
- \`${PASCAL}Module\` — Módulo principal do domínio ${SISTEMA_NOME}.

## Integrações e extensões de fronteira
Nenhuma prevista.
DOMINIOEOF
  ok "dominio.md preenchido"
else
  warn "dominio.md nao encontrado"
fi

# ==========================================================================
# ETAPA 4 — Configurar .env
# ==========================================================================
step "Etapa 4 — Configurar .env"

if [[ ! -f ".env" ]]; then
  cp .env.example .env
  ok ".env criado a partir do .env.example"
else
  ok ".env ja existe"
fi

# ==========================================================================
# ETAPA 5 — npm install
# ==========================================================================
step "Etapa 5 — npm install"

npm install --silent 2>&1 | tail -3
ok "Dependencias instaladas"

# ==========================================================================
# ETAPA 6 — Subir PostgreSQL
# ==========================================================================
step "Etapa 6 — PostgreSQL"

if docker_compose ps 2>/dev/null | grep -q "postgres.*Up\|postgres.*running"; then
  ok "PostgreSQL ja esta rodando"
else
  docker_compose up -d postgres 2>&1 | tail -3
  # Aguardar healthy
  echo -n "  Aguardando PostgreSQL ficar healthy..."
  for i in $(seq 1 30); do
    if docker_compose ps 2>/dev/null | grep -q "healthy"; then
      echo ""
      ok "PostgreSQL rodando e healthy"
      break
    fi
    echo -n "."
    sleep 2
  done
fi

# ==========================================================================
# ETAPA 7 — Prisma
# ==========================================================================
step "Etapa 7 — Prisma generate + migrate"

PRISMA_GEN=$(npx prisma generate --schema=prisma/schema.prisma 2>&1) || true
if echo "$PRISMA_GEN" | grep -q "Generated Prisma Client"; then
  ok "Prisma client gerado"
else
  echo "$PRISMA_GEN" | tail -5
  fail "Prisma generate falhou. Verifique o schema.prisma."
fi

PRISMA_MIG=$(echo "" | npx prisma migrate dev --name inicial --schema=prisma/schema.prisma 2>&1) || true
if echo "$PRISMA_MIG" | grep -qi "applied\|already in sync\|migrations"; then
  ok "Migracao aplicada"
else
  echo "$PRISMA_MIG" | tail -10
  warn "Prisma migrate pode ter falhado. Tentando reset..."
  npx prisma migrate reset --force --schema=prisma/schema.prisma 2>&1 | tail -5
  PRISMA_MIG2=$(npx prisma migrate dev --name inicial --schema=prisma/schema.prisma 2>&1) || true
  if echo "$PRISMA_MIG2" | grep -qi "applied\|already in sync\|migrations"; then
    ok "Migracao aplicada (apos reset)"
  else
    echo "$PRISMA_MIG2" | tail -10
    fail "Prisma migrate falhou. Verifique o schema.prisma e a conexao com o banco."
  fi
fi

# ==========================================================================
# ETAPA 8 — Renomear modulo de exemplo
# ==========================================================================
step "Etapa 8 — Renomear modulo exemplo → ${MODULO_NOME}"

SRC_DIR="apps/api/src/app"

if [[ -d "${SRC_DIR}/exemplo" ]]; then
  # Renomear pasta
  mv "${SRC_DIR}/exemplo" "${SRC_DIR}/${MODULO_NOME}"

  # Renomear arquivos
  cd "${SRC_DIR}/${MODULO_NOME}"
  [[ -f "exemplo.controller.ts" ]] && mv exemplo.controller.ts "${MODULO_NOME}.controller.ts"
  [[ -f "exemplo.service.ts" ]] && mv exemplo.service.ts "${MODULO_NOME}.service.ts"
  [[ -f "exemplo.module.ts" ]] && mv exemplo.module.ts "${MODULO_NOME}.module.ts"
  [[ -f "dto/criar-exemplo.dto.ts" ]] && mv "dto/criar-exemplo.dto.ts" "dto/criar-${MODULO_NOME}.dto.ts"
  cd - >/dev/null

  # Substituir conteudo nos arquivos do modulo (sed -i '' para macOS)
  find "${SRC_DIR}/${MODULO_NOME}" -type f -name "*.ts" | while read -r file; do
    sed_i "s/ExemploModule/${PASCAL}Module/g" "$file"
    sed_i "s/ExemploController/${PASCAL}Controller/g" "$file"
    sed_i "s/ExemploService/${PASCAL}Service/g" "$file"
    sed_i "s/CriarExemploDto/Criar${PASCAL}Dto/g" "$file"
    sed_i "s/exemploService/${CAMEL}Service/g" "$file"
    sed_i "s/ItemExemplo/Item${PASCAL}/g" "$file"
    sed_i "s/@Controller(\"exemplo\")/@Controller(\"${MODULO_NOME}\")/g" "$file"
    sed_i "s/criar-exemplo.dto/criar-${MODULO_NOME}.dto/g" "$file"
    sed_i "s/\.\/exemplo\.service/.\/${MODULO_NOME}.service/g" "$file"
    sed_i "s/\.\/exemplo\.controller/.\/${MODULO_NOME}.controller/g" "$file"
    sed_i "s/\.\/exemplo\.module/.\/${MODULO_NOME}.module/g" "$file"
  done

  # Atualizar app.module.ts
  APP_MODULE="${SRC_DIR}/app.module.ts"
  if [[ -f "$APP_MODULE" ]]; then
    sed_i "s/ExemploModule/${PASCAL}Module/g" "$APP_MODULE"
    sed_i "s|./exemplo/exemplo.module|./${MODULO_NOME}/${MODULO_NOME}.module|g" "$APP_MODULE"
  fi

  ok "Modulo renomeado: exemplo → ${MODULO_NOME} (${PASCAL}Module)"
elif [[ -d "${SRC_DIR}/${MODULO_NOME}" ]]; then
  ok "Modulo ${MODULO_NOME} ja existe (ja foi renomeado)"
else
  warn "Pasta exemplo nao encontrada — pode ja ter sido renomeada"
fi

# ==========================================================================
# ETAPA 9 — Verificar build
# ==========================================================================
step "Etapa 9 — Verificar build"

echo "  Compilando backend..."
npx nest build --path apps/api/tsconfig.json 2>&1 | tail -3
ok "Backend compila"

echo "  Compilando frontend..."
cd apps/web && npx vite build 2>&1 | tail -3 && cd ../..
rm -rf apps/web/dist
ok "Frontend compila"

# ==========================================================================
# ETAPA 10 — Commit + push
# ==========================================================================
step "Etapa 10 — Commit + push inicial"

# Substituir placeholder SISTEMA no workflow de deploy
WORKFLOW_FILE=".github/workflows/homolog-deploy.yml"
if [[ -f "$WORKFLOW_FILE" ]]; then
  sed_i "s/SISTEMA/${SISTEMA_NOME}/g" "$WORKFLOW_FILE"
  ok "Workflow de deploy configurado com nome: ${SISTEMA_NOME}"
fi

git add -A
git commit -m "chore: inicializa sistema ${REPO_NOME} a partir do template"
git push -u origin main

ok "Push realizado"

# ==========================================================================
# ETAPA 11 — Subir o sistema localmente
# ==========================================================================
step "Etapa 11 — Subir o sistema"

echo "  Iniciando API em background..."
npm run dev:api > /tmp/${REPO_NOME}-api.log 2>&1 &
API_PID=$!

echo "  Iniciando Frontend em background..."
npm run dev:web > /tmp/${REPO_NOME}-web.log 2>&1 &
WEB_PID=$!

# Aguardar os servidores subirem
echo -n "  Aguardando servidores..."
sleep 5
echo " pronto!"

# ==========================================================================
# RESULTADO FINAL
# ==========================================================================
echo ""
echo -e "${GREEN}==========================================="
echo "  Sistema inicializado com sucesso!"
echo "==========================================="
echo ""
echo "  Repositorio: https://github.com/${REPO_FULL}"
echo "  Pasta local: ~/projetos/${REPO_NOME}"
echo "  Modulo API:  ${MODULO_NOME} (rota: /${MODULO_NOME})"
echo ""
echo "  App rodando:"
echo "    Frontend: http://localhost:5173"
echo "    API:      http://localhost:3000/${MODULO_NOME}"
echo ""
echo "  Processos em background:"
echo "    API PID: ${API_PID}  (log: /tmp/${REPO_NOME}-api.log)"
echo "    Web PID: ${WEB_PID}  (log: /tmp/${REPO_NOME}-web.log)"
echo ""
echo "  Para parar:"
echo "    kill ${API_PID} ${WEB_PID}"
echo ""
echo "  Para subir novamente (nos proximos dias):"
echo "    cd ~/projetos/${REPO_NOME}"
echo "    bash scripts/dev-start.sh"
echo ""
echo "  Proximos passos:"
echo "    1. Abra http://localhost:5173 no browser"
echo "    2. Abra ~/projetos/${REPO_NOME} no Kiro"
echo "    3. Modele o banco em prisma/schema.prisma"
echo "    4. Inicie uma Spec session para a primeira funcionalidade"
echo -e "===========================================${NC}"
