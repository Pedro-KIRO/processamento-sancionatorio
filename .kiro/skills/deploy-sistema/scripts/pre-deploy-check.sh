#!/usr/bin/env bash
# pre-deploy-check.sh
# --------------------------------------------------------------------------
# Verifica se a imagem Docker foi construída em homologação antes de permitir
# qualquer promoção para produção. Deve ser executado ANTES do deploy em prod.
#
# Uso:
#   ./scripts/pre-deploy-check.sh <nome-do-sistema> [<tag-da-imagem>]
#
# Exemplo:
#   ./scripts/pre-deploy-check.sh portal
#   ./scripts/pre-deploy-check.sh portal sha-a1b2c3d
#
# Se a tag não for informada, verifica a tag "latest".
#
# Exit codes:
#   0 — imagens encontradas no registry (pode promover)
#   1 — imagem NÃO encontrada (não promover)
#   2 — argumentos inválidos
# --------------------------------------------------------------------------

set -euo pipefail

REGISTRY="${DOCKER_REGISTRY:-ghcr.io/detran-sp}"

# --- Validação de argumentos ---
if [[ $# -lt 1 ]]; then
  echo "❌ Uso: $0 <nome-do-sistema> [<tag-da-imagem>]"
  echo "   Exemplo: $0 portal"
  echo "   Exemplo: $0 portal sha-a1b2c3d"
  exit 2
fi

SISTEMA="$1"
TAG="${2:-latest}"

echo "🔍 Verificando imagens no registry para: ${SISTEMA} (tag: ${TAG})"
echo "   Registry: ${REGISTRY}"
echo ""

# --- Verifica imagem da API ---
API_IMAGE="${REGISTRY}/detran-dti-${SISTEMA}-back:${TAG}"
echo -n "   API  (${API_IMAGE}) ... "
if docker manifest inspect "${API_IMAGE}" > /dev/null 2>&1; then
  echo "✅ encontrada"
else
  echo "❌ NÃO encontrada"
  echo ""
  echo "🚫 Promoção bloqueada: a imagem da API não existe no registry."
  echo "   Certifique-se de que o build foi executado em homologação antes de promover."
  exit 1
fi

# --- Verifica imagem do Web ---
WEB_IMAGE="${REGISTRY}/detran-dti-${SISTEMA}-front:${TAG}"
echo -n "   Web  (${WEB_IMAGE}) ... "
if docker manifest inspect "${WEB_IMAGE}" > /dev/null 2>&1; then
  echo "✅ encontrada"
else
  echo "❌ NÃO encontrada"
  echo ""
  echo "🚫 Promoção bloqueada: a imagem Web não existe no registry."
  echo "   Certifique-se de que o build foi executado em homologação antes de promover."
  exit 1
fi

# --- Tudo certo ---
echo ""
echo "✅ Ambas as imagens existem no registry. Promoção liberada."
exit 0
