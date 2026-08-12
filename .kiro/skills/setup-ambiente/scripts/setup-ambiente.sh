#!/usr/bin/env bash
# ==========================================================================
# setup-ambiente.sh — Setup completo da estacao de desenvolvimento
# ==========================================================================
# Uso:
#   export DEV_NOME="Luis Augusto Freire Calixto"
#   export DEV_EMAIL="luis.calixto@detran.sp.gov.br"
#   export DEV_PAT="ghp_xxxxxxxxxxxx"
#   bash setup-ambiente.sh
#
# Requisitos:
#   - Executar DENTRO do WSL (Ubuntu 22.04)
#   - Ter acesso sudo (a senha sera pedida se necessario)
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

# ==========================================================================
# Coleta de dados (se nao foram passados como variaveis de ambiente)
# ==========================================================================
echo -e "${CYAN}"
echo "==========================================="
echo "  Setup de Ambiente — Plataforma DETRAN-SP"
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
echo -e "${YELLOW}[AVISO]${NC} Alguns comandos usam sudo e vao pedir sua senha do Linux (WSL)."
echo -e "        Isso e comportamento padrao do Linux — nao tem como evitar"
echo -e "        sem comprometer seguranca. A senha padrao recomendada e: detran01"
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
# FASE 1 — Git
# ==========================================================================
step "Fase 1 — Git"

if ! command -v git &>/dev/null; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq git
  ok "Git instalado: $(git --version)"
else
  ok "Git ja instalado: $(git --version)"
fi

git config --global user.name "$DEV_NOME"
git config --global user.email "$DEV_EMAIL"
git config --global credential.helper store
ok "Identidade configurada: $DEV_NOME <$DEV_EMAIL>"

mkdir -p ~/projetos
ok "Diretorio ~/projetos criado"

# ==========================================================================
# FASE 2 — GitHub CLI (gh)
# ==========================================================================
step "Fase 2 — GitHub CLI"

if ! command -v gh &>/dev/null; then
  sudo apt-get install -y -qq curl
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null
  sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli-stable.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y -qq gh
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
# FASE 3 — SSH (chave + config porta 443)
# ==========================================================================
step "Fase 3 — Chave SSH + config porta 443"

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
  gh ssh-key add "$HOME/.ssh/id_ed25519.pub" --title "WSL - $DEV_NOME"
  ok "Chave SSH registrada no GitHub"
else
  ok "Chave SSH ja registrada no GitHub"
fi

# Configurar SSH para usar porta 443 APENAS se porta 22 estiver bloqueada
mkdir -p ~/.ssh

# Testar porta 22 diretamente no IP/hostname real (bypassa ~/.ssh/config)
PORT22_OK=false
SSH_TEST=$(ssh -T -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o HostName=github.com -p 22 git@github.com 2>&1 || true)
if echo "$SSH_TEST" | grep -q "successfully authenticated"; then
  PORT22_OK=true
  ok "SSH via porta 22 funcionando — nao precisa de porta 443"
fi

if [[ "$PORT22_OK" == "false" ]]; then
  if ! grep -q "ssh.github.com" ~/.ssh/config 2>/dev/null; then
    # Adicionar ssh.github.com ao known_hosts antes de configurar
    ssh-keyscan -p 443 ssh.github.com >> ~/.ssh/known_hosts 2>/dev/null
    cat >> ~/.ssh/config <<'SSHEOF'

Host github.com
  Hostname ssh.github.com
  Port 443
  User git
SSHEOF
    chmod 600 ~/.ssh/config
    ok "SSH configurado para porta 443 (porta 22 bloqueada na rede)"
  else
    ok "SSH porta 443 ja configurado"
  fi
fi

# Configurar git para usar SSH em vez de HTTPS
git config --global url."git@github.com:".insteadOf "https://github.com/"

# Testar conexao final
SSH_FINAL=$(ssh -T git@github.com -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new 2>&1 || true)
if echo "$SSH_FINAL" | grep -q "successfully authenticated"; then
  ok "Conexao SSH com GitHub funcionando"
else
  SSH_FINAL2=$(ssh -T -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o HostName=github.com -p 22 git@github.com 2>&1 || true)
  if echo "$SSH_FINAL2" | grep -q "successfully authenticated"; then
    ok "Conexao SSH com GitHub funcionando (porta 22)"
  else
    warn "SSH nao conectou — verifique rede/firewall"
  fi
fi

# Configurar ssh-agent no .bashrc
if ! grep -q "ssh-agent" ~/.bashrc 2>/dev/null; then
  cat >> ~/.bashrc <<'BASHEOF'

# ssh-agent auto-start
if [ -z "$SSH_AUTH_SOCK" ]; then
  eval "$(ssh-agent -s)" >/dev/null 2>&1
  ssh-add ~/.ssh/id_ed25519 2>/dev/null
fi
BASHEOF
  ok "ssh-agent configurado no .bashrc"
else
  ok "ssh-agent ja no .bashrc"
fi

# Carregar agora
eval "$(ssh-agent -s)" >/dev/null 2>&1
ssh-add ~/.ssh/id_ed25519 2>/dev/null || true

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

# Desabilitar interop de PATH do Windows (evita npm do Windows vazar)
if ! grep -q "appendWindowsPath" /etc/wsl.conf 2>/dev/null; then
  sudo tee -a /etc/wsl.conf >/dev/null <<'WSLEOF'

[interop]
appendWindowsPath = false
WSLEOF
  warn "appendWindowsPath desabilitado em /etc/wsl.conf (efeito apos reiniciar WSL)"
fi

# ==========================================================================
# FASE 6 — Docker
# ==========================================================================
step "Fase 6 — Docker"

# Verificar se Docker Desktop com integracao WSL esta ativo
DOCKER_DESKTOP=false
if command -v docker &>/dev/null; then
  if docker info 2>/dev/null | grep -q "Docker Desktop"; then
    DOCKER_DESKTOP=true
    ok "Docker Desktop com integracao WSL detectado"
  fi
fi

if [[ "$DOCKER_DESKTOP" == "false" ]]; then
  if ! command -v docker &>/dev/null; then
    sudo apt-get install -y -qq docker.io docker-compose
    ok "Docker instalado: $(docker --version)"
  else
    ok "Docker ja instalado: $(docker --version)"
  fi

  # Adicionar usuario ao grupo docker
  if ! groups | grep -q docker; then
    sudo usermod -aG docker "$USER"
    warn "Usuario adicionado ao grupo docker — efeito apos reiniciar WSL"
  fi

  # Garantir que o servico docker esta ativo
  if ! sudo service docker status &>/dev/null; then
    sudo service docker start
    ok "Servico Docker iniciado"
  fi

  # docker-compose
  if ! command -v docker-compose &>/dev/null; then
    sudo apt-get install -y -qq docker-compose
  fi
  ok "docker-compose: $(docker-compose --version 2>/dev/null || echo 'instalado')"
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
check "[[ \$(ssh -T -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new git@github.com 2>&1 || true) == *'successfully authenticated'* ]] || [[ \$(ssh -T -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o HostName=github.com -p 22 git@github.com 2>&1 || true) == *'successfully authenticated'* ]]" "SSH com GitHub"
check "command -v node && [[ \$(node --version | cut -d. -f1 | tr -d v) -ge 20 ]]" "Node.js 20+"
check "command -v docker" "Docker instalado"
check "[[ -d ~/projetos/detran-dti-platform-template ]]" "Template clonado"
check "[[ -d ~/projetos/detran-contrato-compartilhado ]]" "Contrato clonado"

echo ""
echo "==========================================="
if [[ $CHECKS -eq $TOTAL ]]; then
  ok "Ambiente configurado! ($CHECKS/$TOTAL checks)"
  echo ""
  echo "Proximo passo: acione /onboarding no Kiro para criar o sistema."
else
  warn "Ambiente parcialmente configurado ($CHECKS/$TOTAL checks)"
  echo "Resolva os itens com FALHOU e execute novamente."
fi
echo "==========================================="
