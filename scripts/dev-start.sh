#!/usr/bin/env bash
# Sobe o ambiente de desenvolvimento local.
#
# Uso:
#   bash scripts/dev-start.sh          (com Docker)
#   bash scripts/dev-start.sh --local  (sem Docker, SQLite)
#
# Com Docker: sobe PostgreSQL + API + Web via docker-compose.
# Sem Docker (--local): usa o venv existente + SQLite, como hoje.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ "${1:-}" == "--local" ]]; then
    echo "=== Modo local (sem Docker) ==="
    echo ""
    echo "Backend: uvicorn (hot-reload)"
    cd "$PROJECT_DIR/backend"
    if [[ -f .venv/Scripts/python.exe ]]; then
        # Windows (Git Bash / WSL com acesso ao venv Windows)
        .venv/Scripts/python.exe -m uvicorn app.main:app --reload &
    else
        python -m uvicorn app.main:app --reload &
    fi
    API_PID=$!

    echo "Frontend: vite dev server"
    cd "$PROJECT_DIR/frontend"
    npm run dev &
    WEB_PID=$!

    echo ""
    echo "API:  http://localhost:8000/docs"
    echo "Site: http://localhost:5173"
    echo ""
    echo "Ctrl+C para parar tudo."
    trap "kill $API_PID $WEB_PID 2>/dev/null" EXIT INT TERM
    wait
else
    echo "=== Modo Docker ==="
    cd "$PROJECT_DIR"
    docker-compose up --build -d
    echo ""
    echo "Containers subindo..."
    echo "API:  http://localhost:8000/docs"
    echo "Site: http://localhost:5173"
    echo "DB:   postgresql://detran:detran_local@localhost:5432/processamento"
    echo ""
    echo "Logs: docker-compose logs -f"
    echo "Parar: docker-compose down"
fi
