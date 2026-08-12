#!/usr/bin/env bash
# Sobe o ambiente de desenvolvimento local.
#
# Uso:
#   bash scripts/dev-start.sh            PostgreSQL no Docker + API NestJS + Vite
#   bash scripts/dev-start.sh --legado   sobe também o FastAPI (backend Python)
#
# ---------------------------------------------------------------------------
# Topologia durante a migração
# ---------------------------------------------------------------------------
#   Vite (5173)  --/api-->  NestJS (3001)  --não portado-->  FastAPI (8080)
#
# O navegador conhece um endereço só. A API NestJS repassa ao FastAPI tudo que
# ainda não foi portado (ver apps/api/src/app/legacy/). Por isso, enquanto
# houver domínio no Python, use --legado; sem ele as telas não migradas
# respondem 502.
#
# Conforme .kiro/steering/onboarding-fase0.md, o Docker deve estar instalado
# DENTRO do WSL (via apt), não via Docker Desktop.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

COM_LEGADO=false
if [[ "${1:-}" == "--legado" ]]; then
    COM_LEGADO=true
fi

if [[ ! -f .env ]]; then
    echo "ERRO: .env não encontrado na raiz. Copie de .env.example e preencha."
    echo "      cp .env.example .env"
    exit 1
fi

PIDS=()
encerrar() {
    echo ""
    echo "Encerrando..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
}
trap encerrar EXIT INT TERM

echo "=== PostgreSQL (Docker) ==="
docker compose up -d postgres

echo "Aguardando o banco aceitar conexão..."
for _ in $(seq 1 30); do
    if docker compose exec -T postgres pg_isready -q 2>/dev/null; then
        echo "Banco pronto."
        break
    fi
    sleep 1
done

echo ""
echo "=== Prisma Client ==="
npm run prisma:generate

if [[ "$COM_LEGADO" == true ]]; then
    echo ""
    echo "=== Backend legado — FastAPI (8080) ==="
    (
        cd "$PROJECT_DIR/backend"
        if [[ -f .venv/Scripts/python.exe ]]; then
            # venv criado no Windows, acessível pelo Git Bash / WSL
            .venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload
        else
            python -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload
        fi
    ) &
    PIDS+=($!)
fi

echo ""
echo "=== API NestJS (3001) ==="
npm run dev:api &
PIDS+=($!)

echo ""
echo "=== Frontend Vite (5173) ==="
npm run dev:web &
PIDS+=($!)

echo ""
echo "---------------------------------------------"
echo " Site:   http://localhost:5173"
echo " API:    http://localhost:3001/api"
echo " Health: http://localhost:3001/health"
if [[ "$COM_LEGADO" == true ]]; then
    echo " Legado: http://localhost:8080/docs"
else
    echo ""
    echo " AVISO: FastAPI não subiu. Telas de domínios ainda não portados"
    echo "        vão responder 502. Use --legado para subir o backend Python."
fi
echo "---------------------------------------------"
echo ""
echo "Ctrl+C para parar tudo."
wait
