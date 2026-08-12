#!/usr/bin/env bash
# verificar-ambiente.sh
# --------------------------------------------------------------------------
# Verifica automaticamente se o ambiente de desenvolvimento está configurado
# corretamente: Git, identidade, gh CLI, chave SSH, Node.js, Docker e repos.
#
# Uso:
#   bash .kiro/skills/setup-ambiente/scripts/verificar-ambiente.sh
#
# Exit codes:
#   0 — tudo ok
#   1 — uma ou mais verificações falharam
# --------------------------------------------------------------------------

set -uo pipefail

FALHAS=0
AVISOS=0

echo "═══════════════════════════════════════════════════════"
echo "  Verificação de Ambiente — Plataforma DETRAN-SP"
echo "═══════════════════════════════════════════════════════"
echo ""

# --- 1. Git instalado ---
echo -n "1.  Git instalado ........................ "
if command -v git &> /dev/null; then
  echo "✅ $(git --version | head -1)"
else
  echo "❌ Git não encontrado"
  FALHAS=$((FALHAS + 1))
fi

# --- 2. Git user.name configurado ---
echo -n "2.  Git user.name ........................ "
GIT_NAME=$(git config --global user.name 2>/dev/null || echo "")
if [[ -n "$GIT_NAME" ]]; then
  echo "✅ $GIT_NAME"
else
  echo "❌ Não configurado"
  echo "    → Execute: git config --global user.name \"Seu Nome\""
  FALHAS=$((FALHAS + 1))
fi

# --- 3. Git user.email corporativo ---
echo -n "3.  Git user.email corporativo ........... "
GIT_EMAIL=$(git config --global user.email 2>/dev/null || echo "")
if [[ "$GIT_EMAIL" == *"@detran.sp.gov.br" ]]; then
  echo "✅ $GIT_EMAIL"
elif [[ -n "$GIT_EMAIL" ]]; then
  echo "❌ E-mail não corporativo: $GIT_EMAIL"
  echo "    → Execute: git config --global user.email \"seu.email@detran.sp.gov.br\""
  FALHAS=$((FALHAS + 1))
else
  echo "❌ Não configurado"
  echo "    → Execute: git config --global user.email \"seu.email@detran.sp.gov.br\""
  FALHAS=$((FALHAS + 1))
fi

# --- 4. GitHub CLI (gh) instalado e autenticado ---
echo -n "4.  GitHub CLI (gh) ...................... "
if command -v gh &> /dev/null; then
  GH_STATUS=$(gh auth status 2>&1 || true)
  if echo "$GH_STATUS" | grep -q "Logged in"; then
    GH_PROTOCOL=$(gh config get -h github.com git_protocol 2>/dev/null || echo "desconhecido")
    echo "✅ Autenticado (protocolo: $GH_PROTOCOL)"
    if [[ "$GH_PROTOCOL" != "ssh" ]]; then
      echo "    ⚠️  Protocolo deveria ser SSH, não $GH_PROTOCOL"
      echo "    → Execute: gh config set -h github.com git_protocol ssh"
      AVISOS=$((AVISOS + 1))
    fi
  else
    echo "❌ Instalado mas não autenticado"
    echo "    → Execute: gh auth login"
    FALHAS=$((FALHAS + 1))
  fi
else
  echo "❌ Não instalado"
  echo "    → Veja o guia-setup.md Fase 3"
  FALHAS=$((FALHAS + 1))
fi

# --- 5. Chave SSH ed25519 presente ---
echo -n "5.  Chave SSH ed25519 .................... "
if [[ -f "$HOME/.ssh/id_ed25519.pub" ]]; then
  echo "✅ ~/.ssh/id_ed25519.pub existe"
else
  echo "❌ Chave não encontrada"
  echo "    → Execute: ssh-keygen -t ed25519 -C \"seu.email@detran.sp.gov.br\" -N \"\""
  FALHAS=$((FALHAS + 1))
fi

# --- 6. Conexão SSH com GitHub ---
echo -n "6.  Conexão SSH com GitHub ............... "
# Tenta com agent carregado; se não tiver agent, tenta sem (chave sem passphrase)
SSH_OUTPUT=$(ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 || true)
if echo "$SSH_OUTPUT" | grep -q "successfully authenticated"; then
  GH_USER=$(echo "$SSH_OUTPUT" | grep -oP 'Hi \K[^!]+' || echo "usuario")
  echo "✅ Autenticado como $GH_USER"
elif echo "$SSH_OUTPUT" | grep -q "Permission denied"; then
  # Pode ser passphrase não desbloqueada — tentar com ssh-agent
  if [ -n "${SSH_AUTH_SOCK:-}" ]; then
    echo "⚠️  Chave requer passphrase (agent pode não ter a chave carregada)"
    echo "    → Execute: ssh-add ~/.ssh/id_ed25519"
    AVISOS=$((AVISOS + 1))
  else
    echo "⚠️  Chave requer passphrase e ssh-agent não está rodando"
    echo "    → Execute: eval \"\$(ssh-agent -s)\" && ssh-add ~/.ssh/id_ed25519"
    AVISOS=$((AVISOS + 1))
  fi
else
  echo "❌ Falha na autenticação SSH"
  echo "    → Verifique: gh ssh-key add ~/.ssh/id_ed25519.pub --title \"WSL\""
  FALHAS=$((FALHAS + 1))
fi

# --- 7. Node.js instalado (>= 20) ---
echo -n "7.  Node.js (>= 20) ..................... "
if command -v node &> /dev/null; then
  NODE_VERSION=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_MAJOR" -ge 20 ]]; then
    echo "✅ $NODE_VERSION"
  else
    echo "❌ Versão $NODE_VERSION (mínimo: v20)"
    echo "    → Execute: nvm install 20"
    FALHAS=$((FALHAS + 1))
  fi
else
  echo "❌ Node.js não encontrado"
  echo "    → Execute: nvm install 20 (ou instale o nvm primeiro)"
  FALHAS=$((FALHAS + 1))
fi

# --- 8. npm instalado ---
echo -n "8.  npm .................................. "
if command -v npm &> /dev/null; then
  echo "✅ npm $(npm --version)"
else
  echo "❌ npm não encontrado"
  echo "    → Vem junto com o Node.js (nvm install 20)"
  FALHAS=$((FALHAS + 1))
fi

# --- 9. Docker instalado ---
echo -n "9.  Docker instalado ..................... "
if command -v docker &> /dev/null; then
  DOCKER_VERSION=$(docker --version 2>/dev/null | head -1)
  echo "✅ $DOCKER_VERSION"
else
  echo "❌ Docker não encontrado"
  echo "    → Execute: sudo apt install -y docker.io"
  FALHAS=$((FALHAS + 1))
fi

# --- 10. Docker daemon rodando ---
echo -n "10. Docker daemon rodando ................ "
if docker info &> /dev/null; then
  echo "✅ Rodando"
elif sudo docker info &> /dev/null; then
  echo "⚠️  Rodando (mas precisa de sudo — relogin pendente)"
  echo "    → Feche e reabra o terminal WSL"
  AVISOS=$((AVISOS + 1))
else
  echo "❌ Daemon não está rodando"
  echo "    → Aplique o fix de systemd (ver guia-setup.md Fase 5)"
  FALHAS=$((FALHAS + 1))
fi

# --- 11. docker-compose instalado ---
echo -n "11. docker-compose ....................... "
if command -v docker-compose &> /dev/null; then
  echo "✅ $(docker-compose --version 2>/dev/null | head -1)"
else
  echo "❌ docker-compose não encontrado"
  echo "    → Execute: sudo apt install -y docker-compose"
  FALHAS=$((FALHAS + 1))
fi

# --- 12. Template clonado ---
echo -n "12. Template clonado ..................... "
if [[ -d "$HOME/projetos/detran-dti-platform-template" ]]; then
  echo "✅ ~/projetos/detran-dti-platform-template"
else
  echo "❌ Não encontrado"
  echo "    → Execute: cd ~/projetos && git clone git@github.com:Detran-SP/detran-dti-platform-template.git"
  FALHAS=$((FALHAS + 1))
fi

# --- 13. Contrato compartilhado clonado ---
echo -n "13. Contrato compartilhado clonado ....... "
if [[ -d "$HOME/projetos/detran-contrato-compartilhado" ]]; then
  echo "✅ ~/projetos/detran-contrato-compartilhado"
else
  echo "❌ Não encontrado"
  echo "    → Execute: cd ~/projetos && git clone git@github.com:Detran-SP/detran-contrato-compartilhado.git"
  FALHAS=$((FALHAS + 1))
fi

# --- Resultado ---
echo ""
echo "═══════════════════════════════════════════════════════"
if [[ $FALHAS -eq 0 && $AVISOS -eq 0 ]]; then
  echo "  ✅ Ambiente configurado corretamente!"
elif [[ $FALHAS -eq 0 ]]; then
  echo "  ⚠️  Ambiente funcional com $AVISOS aviso(s)"
  echo "  Resolva quando possível, mas não é bloqueante."
else
  echo "  ❌ $FALHAS verificação(ões) com problema(s)"
  if [[ $AVISOS -gt 0 ]]; then
    echo "  ⚠️  + $AVISOS aviso(s)"
  fi
  echo "  Resolva os itens marcados com ❌ e execute novamente."
fi
echo "═══════════════════════════════════════════════════════"

[[ $FALHAS -eq 0 ]] && exit 0 || exit 1
