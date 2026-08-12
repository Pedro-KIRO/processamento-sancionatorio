#!/usr/bin/env bash
# ==========================================================================
# setup-ambiente-mac.sh — Setup completo da estacao de desenvolvimento (macOS)
# ==========================================================================
# Uso:
#   export DEV_NOME="Seu Nome Completo"
#   export DEV_EMAIL="seu.email@detran.sp.gov.br"
#   export DEV_PAT="ghp_xxxxxxxxxxxx"
#   bash setup-ambiente-mac.sh
#
# Requisitos:
#   - macOS 13 (Ventura) ou superior
#   - Homebrew instalado (o script instala se necessario)
#   - Docker Desktop para Mac instalado e rodando
#
# O script e idempotente — pode ser executado novamente sem efeitos colaterais.
# ==========================================================================

set -euo pipefail

# --- Cores para output ---
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
fail() { echo -e "${RED}[ERRO]${NC} $1"; exit 1; }
step() { echo -e "\n${GREEN}===== $1 =====${NC}"; }

# --- Verificar que estamos no macOS ---
if [[ "$(uname)" != "Darwin" ]]; then
  fail "Este script e para macOS. No Windows, use setup-ambiente.sh dentro do WSL."
fi

# ==========================================================================
# Coleta de dados (se nao foram passados como variaveis de ambiente)
# ==========================================================================
echo -e "${CYAN}"
echo "==========================================="
echo "  Setup de Ambiente (macOS) — Plataforma DETRAN-SP"
echo "==========================================="
echo -e "${NC}"

if [[ -z "${DEV_NOME:-}" ]]; then
  read -rp "Seu nome completo: " DEV_NOME
fi

if [[ -z "${DEV_EMAIL:-}" ]]; then
  read -rp "Seu e-mail corporativo (@detran.sp.gov.br): " DEV_EMAIL
fi

if [[ -z "${DEV_PAT:-}" ]]; then
  read -rsp "Seu Personal Access Token (PAT) do GitHub: " DEV_PAT
  echo ""
  echo -e "  PAT recebido: ****${DEV_PAT: -4}"
fi

echo ""

# --- Validar variaveis obrigatorias ---
[[ -z "${DEV_NOME:-}" ]] && fail "Variavel DEV_NOME nao definida."
[[ -z "${DEV_EMAIL:-}" ]] && fail "Variavel DEV_EMAIL nao definida."
[[ -z "${DEV_PAT:-}" ]] && fail "Variavel DEV_PAT nao definida."

# Validar email corporativo
if [[ "$DEV_EMAIL" != *"@detran.sp.gov.br" ]]; then
  fail "E-mail deve ser corporativo (@detran.sp.gov.br). Recebido: $DEV_EMAIL"
fi

# ==========================================================================
# FASE 1 — Homebrew + Git
# ==========================================================================
step "Fase 1 — Homebrew + Git"

# Instalar Homebrew se necessario
if ! command -v brew &>/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Adicionar ao PATH para Apple Silicon
  if [[ -f "/opt/homebrew/bin/brew" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
  ok "Homebrew instalado"
else
  ok "Homebrew ja instalado"
fi

# Git — vem com Command Line Tools, mas garantir
if ! command -v git &>/dev/null; then
  xcode-select --install 2>/dev/null || true
  ok "Git instalado via Xcode Command Line Tools"
else
  ok "Git ja instalado: $(git --version)"
fi

git config --global user.name "$DEV_NOME"
git config --global user.email "$DEV_EMAIL"
git config --global credential.helper osxkeychain
ok "Identidade configurada: $DEV_NOME <$DEV_EMAIL>"

mkdir -p ~/projetos
ok "Diretorio ~/projetos criado"

# ==========================================================================
# FASE 2 — GitHub CLI (gh)
# ==========================================================================
step "Fase 2 — GitHub CLI"

if ! command -v gh &>/dev/null; then
  brew install gh
  ok "gh instalado: $(gh --version | head -1)"
else
  ok "gh ja instalado: $(gh --version | head -1)"
fi

# Autenticar gh com PAT (nao-interativo)
if ! gh auth status &>/dev/null; then
  echo "$DEV_PAT" | gh auth login --with-token
  ok "gh autenticado via PAT"
else
  ok "gh ja autenticado"
fi

# ==========================================================================
# FASE 3 — SSH (chave + registro no GitHub)
# ==========================================================================
step "Fase 3 — Chave SSH"

# Gerar chave se nao existir
if [[ ! -f "$HOME/.ssh/id_ed25519" ]]; then
  mkdir -p ~/.ssh
  ssh-keygen -t ed25519 -C "$DEV_EMAIL" -f "$HOME/.ssh/id_ed25519" -N ""
  ok "Chave SSH gerada (sem passphrase)"
else
  ok "Chave SSH ja existe"
fi

# Registrar chave no GitHub se nao estiver la
KEY_FINGERPRINT=$(ssh-keygen -lf "$HOME/.ssh/id_ed25519.pub" | awk '{print $2}')
if ! gh ssh-key list 2>/dev/null | grep -q "$KEY_FINGERPRINT"; then
  gh ssh-key add "$HOME/.ssh/id_ed25519.pub" --title "Mac - $DEV_NOME"
  ok "Chave SSH registrada no GitHub"
else
  ok "Chave SSH ja registrada no GitHub"
fi

# Adicionar chave ao Keychain do macOS
if ! ssh-add -l 2>/dev/null | grep -q "id_ed25519"; then
  ssh-add --apple-use-keychain ~/.ssh/id_ed25519 2>/dev/null || ssh-add -K ~/.ssh/id_ed25519 2>/dev/null || true
  ok "Chave SSH adicionada ao Keychain"
fi

# Configurar SSH config para usar Keychain
if ! grep -q "UseKeychain" ~/.ssh/config 2>/dev/null; then
  mkdir -p ~/.ssh
  cat >> ~/.ssh/config <<'SSHEOF'

Host github.com
  AddKeysToAgent yes
  UseKeychain yes
  IdentityFile ~/.ssh/id_ed25519
SSHEOF
  chmod 600 ~/.ssh/config
  ok "SSH config atualizado (UseKeychain)"
else
  ok "SSH config ja tem UseKeychain"
fi

# Configurar git para usar SSH
git config --global url."git@github.com:".insteadOf "https://github.com/"

# Testar conexao
SSH_TEST=$(ssh -T git@github.com -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new 2>&1 || true)
if echo "$SSH_TEST" | grep -q "successfully authenticated"; then
  ok "Conexao SSH com GitHub funcionando"
else
  warn "SSH nao conectou — verifique rede/firewall"
fi

# ==========================================================================
# FASE 4 — Clonar repos base
# ==========================================================================
step "Fase 4 — Clonar repos base"

cd ~/projetos

if [[ ! -d "detran-dti-platform-template" ]]; then
  git clone git@github.com:Detran-SP/detran-dti-platform-template.git
  ok "Template clonado"
else
  cd detran-dti-platform-template && git pull --ff-only 2>/dev/null || true && cd ..
  ok "Template ja existe (atualizado)"
fi

if [[ ! -d "detran-contrato-compartilhado" ]]; then
  git clone git@github.com:Detran-SP/detran-contrato-compartilhado.git
  ok "Contrato compartilhado clonado"
else
  cd detran-contrato-compartilhado && git pull --ff-only 2>/dev/null || true && cd ..
  ok "Contrato compartilhado ja existe (atualizado)"
fi

# ==========================================================================
# FASE 5 — Node.js (via nvm)
# ==========================================================================
step "Fase 5 — Node.js"

export NVM_DIR="$HOME/.nvm"

if [[ ! -d "$NVM_DIR" ]]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  ok "nvm instalado"
fi

# Carregar nvm
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! command -v node &>/dev/null || [[ "$(node --version | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  nvm install 20
  ok "Node.js instalado: $(node --version)"
else
  ok "Node.js ja instalado: $(node --version)"
fi

# ==========================================================================
# FASE 6 — Docker
# ==========================================================================
step "Fase 6 — Docker"

if ! command -v docker &>/dev/null; then
  echo ""
  fail "Docker nao encontrado. Instale o Docker Desktop para Mac:
  https://www.docker.com/products/docker-desktop/
  Depois rode este script novamente."
fi

if ! docker info &>/dev/null 2>&1; then
  echo ""
  fail "Docker nao esta rodando. Abra o Docker Desktop e aguarde o icone da baleia
  aparecer na barra de menu. Depois rode este script novamente."
fi

ok "Docker rodando: $(docker --version)"

# Verificar docker compose (v2)
if docker compose version &>/dev/null 2>&1; then
  ok "Docker Compose v2: $(docker compose version --short)"
else
  warn "docker compose nao encontrado — verifique Docker Desktop Settings"
fi

# ==========================================================================
# FASE 7 — Verificacao final
# ==========================================================================
step "Fase 7 — Verificacao final"

CHECKS=0
TOTAL=8

check() {
  if eval "$1" &>/dev/null; then
    ok "$2"
    CHECKS=$((CHECKS + 1))
  else
    warn "FALHOU: $2"
  fi
}

check "command -v git" "Git instalado"
check "[[ \"\$(git config --global user.email)\" == *'@detran.sp.gov.br' ]]" "E-mail corporativo"
check "gh auth status" "gh autenticado"
check "[[ \$(ssh -T -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new git@github.com 2>&1 || true) == *'successfully authenticated'* ]]" "SSH com GitHub"
check "command -v node && [[ \$(node --version | cut -d. -f1 | tr -d v) -ge 20 ]]" "Node.js 20+"
check "command -v docker && docker info" "Docker rodando"
check "[[ -d ~/projetos/detran-dti-platform-template ]]" "Template clonado"
check "[[ -d ~/projetos/detran-contrato-compartilhado ]]" "Contrato clonado"

echo ""
echo "==========================================="
if [[ $CHECKS -eq $TOTAL ]]; then
  ok "Ambiente configurado! ($CHECKS/$TOTAL checks)"
  echo ""
  echo "Proximo passo: acione /onboarding no Kiro para criar o sistema."
  echo ""
  echo "  cd ~/projetos/detran-dti-platform-template"
  echo "  bash .kiro/skills/onboarding/scripts/onboarding-sistema.sh"
else
  warn "Ambiente parcialmente configurado ($CHECKS/$TOTAL checks)"
  echo "Resolva os itens com FALHOU e execute novamente."
fi
echo "==========================================="
