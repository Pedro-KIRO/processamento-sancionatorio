#!/usr/bin/env bash
# Abre uma Pull Request no GitHub seguindo o padrão DTI.
#
# Uso:
#   bash scripts/abrir-pr.sh
#
# Pré-requisitos:
#   - Git instalado e configurado (nome + email)
#   - Branch atual NÃO é main
#   - GitHub CLI (gh) instalado e autenticado, OU usar a interface web
#
# O que faz:
#   1. Verifica se está numa branch feature (não main)
#   2. Adiciona e commita mudanças pendentes (se houver)
#   3. Push da branch
#   4. Abre PR via gh (se disponível) ou mostra a URL para abrir manualmente
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Verificar branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ -z "$BRANCH" ]]; then
    echo "ERRO: não é um repositório Git. Rode 'git init' primeiro."
    exit 1
fi
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
    echo "ERRO: você está na branch '$BRANCH'."
    echo "Crie uma branch de feature primeiro:"
    echo "  git checkout -b feature/minha-funcionalidade"
    exit 1
fi

echo "Branch: $BRANCH"
echo ""

# Commit pendente?
if [[ -n "$(git status --porcelain)" ]]; then
    echo "Há mudanças não commitadas. Commitando..."
    git add -A
    read -rp "Mensagem do commit: " MSG
    git commit -m "$MSG"
fi

# Push
echo "Enviando branch para o GitHub..."
git push -u origin "$BRANCH"

# Abrir PR
if command -v gh &>/dev/null; then
    echo ""
    echo "Abrindo PR via GitHub CLI..."
    gh pr create --fill --base main
else
    REPO_URL=$(git remote get-url origin 2>/dev/null | sed 's/\.git$//')
    echo ""
    echo "GitHub CLI não encontrado. Abra a PR manualmente:"
    echo "  ${REPO_URL}/compare/main...${BRANCH}"
fi

echo ""
echo "Pronto! Aguarde a revisão do Tech Lead."
