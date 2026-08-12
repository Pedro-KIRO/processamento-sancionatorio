#!/usr/bin/env bash
# ==========================================================================
# destruir-sistema.sh — Remove completamente um sistema criado pelo onboarding
# ==========================================================================
#
# !! ATENCAO: ESTE SCRIPT APAGA TUDO SEM POSSIBILIDADE DE RESTAURAR !!
#
# O que ele faz:
#   1. Deleta o repositorio no GitHub (Detran-SP/detran-dti-<sistema>)
#   2. Remove a pasta local (~/projetos/detran-dti-<sistema>)
#   3. Para e remove o container PostgreSQL do sistema
#   4. Remove o volume Docker (dados do banco)
#
# Uso: bash destruir-sistema.sh
#
# Quando usar:
#   - Testes de validacao do fluxo de onboarding
#   - Resetar um sistema que deu errado durante a criacao
#   - NUNCA em sistemas com desenvolvimento real em andamento
#
# ==========================================================================

set -uo pipefail

# --- Cores ---
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${RED}"
echo "============================================"
echo "  DESTRUIR SISTEMA — OPERACAO IRREVERSIVEL"
echo "============================================"
echo -e "${NC}"
echo "Este script vai APAGAR PERMANENTEMENTE:"
echo "  - Repositorio no GitHub"
echo "  - Pasta local com todo o codigo"
echo "  - Container e volume PostgreSQL (dados do banco)"
echo ""
echo -e "${YELLOW}Nao ha como desfazer. Use apenas para testes.${NC}"
echo ""

# Coletar nome do sistema
read -rp "Nome do sistema a destruir (ex.: controle-acesso): " SISTEMA_NOME

if [[ -z "$SISTEMA_NOME" ]]; then
  echo -e "${RED}[ERRO]${NC} Nome nao informado. Abortando."
  exit 1
fi

REPO_NOME="detran-dti-${SISTEMA_NOME}"
REPO_FULL="Detran-SP/${REPO_NOME}"

echo ""
echo -e "${RED}Vai destruir:${NC}"
echo "  Repositorio: https://github.com/${REPO_FULL}"
echo "  Pasta local: ~/projetos/${REPO_NOME}"
echo "  Container:   ${REPO_NOME}_postgres_1"
echo "  Volume:      ${REPO_NOME}_postgres_data"
echo ""
read -rp "Tem certeza? Digite o nome do sistema para confirmar: " CONFIRMA

if [[ "$CONFIRMA" != "$SISTEMA_NOME" ]]; then
  echo -e "${YELLOW}[!]${NC} Nome nao confere. Abortando."
  exit 1
fi

echo ""

# 1. Deletar repositorio no GitHub
echo -n "  Deletando repositorio no GitHub... "
if gh repo delete "$REPO_FULL" --yes 2>/dev/null; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${YELLOW}nao encontrado ou sem permissao${NC}"
fi

# 2. Remover pasta local
echo -n "  Removendo pasta local... "
if [[ -d "$HOME/projetos/${REPO_NOME}" ]]; then
  rm -rf "$HOME/projetos/${REPO_NOME}"
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${YELLOW}nao existe${NC}"
fi

# 3. Parar e remover container
echo -n "  Removendo container Docker... "
if docker rm -f "${REPO_NOME}_postgres_1" 2>/dev/null; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${YELLOW}nao encontrado${NC}"
fi

# 4. Remover volume
echo -n "  Removendo volume Docker... "
if docker volume rm "${REPO_NOME}_postgres_data" 2>/dev/null; then
  echo -e "${GREEN}OK${NC}"
else
  echo -e "${YELLOW}nao encontrado${NC}"
fi

echo ""
echo -e "${GREEN}[OK]${NC} Sistema ${SISTEMA_NOME} destruido completamente."
echo ""
