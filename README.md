# Processamento Sancionatório CPSAR

Sistema de gestão do ciclo de vida de processos administrativos sancionatórios contra agentes regulados pelo DETRAN-SP, integrado ao SEI.

## Stack

| Camada | Tecnologia |
|--------|------------|
| Backend | Python 3.12+ · FastAPI · SQLAlchemy · SQLite (dev) / PostgreSQL (prod) |
| Frontend | React 18 · TypeScript · Vite · Tailwind CSS (Material Design 3) |
| Integrações | API SEI · Microsoft Graph (SharePoint) · Entra ID (auth) |
| Infra | Docker · GitHub Actions · PostgreSQL 16 |

## Pré-requisitos

- **Git** (para versionamento e push)
- **Node.js 20+** (frontend)
- **Python 3.12+** (backend)
- **Docker Desktop** (opcional — necessário para PostgreSQL local e deploy)

## Como rodar (desenvolvimento local)

### Modo sem Docker (SQLite, como hoje)

```bash
# Backend
cd backend
python -m venv .venv
.venv/Scripts/activate  # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend (outro terminal)
cd frontend
npm install
npm run dev
```

### Modo com Docker (PostgreSQL)

```bash
docker-compose up -d
```

- **API:** http://localhost:8000/docs
- **Site:** http://localhost:5173
- **Banco:** postgresql://detran:detran_local@localhost:5432/processamento

## Testes

```bash
# Backend (269 testes)
cd backend
python -m pytest -q

# Frontend (36 testes)
cd frontend
npm test
```

## Estrutura do projeto

```
├── backend/                 # API FastAPI
│   ├── app/                 # Código da aplicação
│   │   ├── api/routes/      # Endpoints
│   │   ├── core/            # Config e auth
│   │   ├── db/              # Models e conexão
│   │   ├── integrations/    # Clientes SEI e Graph
│   │   ├── services/        # Regras de negócio
│   │   └── schemas/         # Pydantic schemas
│   ├── automacoes/          # Scripts agendados
│   ├── scripts/             # Migrações e utilitários
│   ├── tests/               # Testes pytest
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/                # React SPA
│   ├── src/
│   │   ├── api/             # Cliente HTTP
│   │   ├── components/      # Componentes reutilizáveis
│   │   ├── features/        # Telas por domínio
│   │   └── lib/             # Utilitários
│   ├── Dockerfile
│   └── package.json
├── prisma/                  # Schema do banco (preparação para migração)
├── docs/                    # Documentação
│   ├── dominio.md           # Definição do domínio (padrão DTI)
│   ├── negocio/             # Regras de negócio e fases
│   └── tecnica/             # Documentação técnica completa
├── scripts/                 # Dev scripts (abrir-pr, dev-start)
├── .github/                 # CI/CD e templates de PR
├── docker-compose.yml       # Ambiente completo
└── .gitignore
```

## Fluxo de desenvolvimento (padrão DTI)

1. Criar branch de feature: `git checkout -b feature/minha-funcionalidade`
2. Desenvolver e testar localmente
3. Abrir PR: `bash scripts/abrir-pr.sh`
4. Aguardar revisão do Tech Lead
5. Tech Lead faz merge e deploy

> **O dev não faz push em main, merge próprio nem deploy.**

## Documentação adicional

- [Domínio e vocabulário](docs/dominio.md)
- [Documentação técnica completa](docs/tecnica/documentacao-tecnica.md)
- [Fases do processo administrativo](docs/negocio/fases-processo-administrativo.md)
