# Dockerfile do backend (FastAPI + Python 3.12)
# Para desenvolvimento local via docker-compose e para CI/CD (GitHub Actions).
#
# Build:   docker build -t processamento-api ./backend
# Run:     docker run -p 8000:8000 processamento-api

FROM python:3.12-slim AS base

WORKDIR /app

# Instala dependências do sistema (para psycopg2 e outros)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
