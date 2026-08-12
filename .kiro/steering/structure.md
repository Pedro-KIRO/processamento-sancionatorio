---
inclusion: always
---

# Estrutura — Layout Canônico de um Repositório de Sistema

Todo sistema da plataforma segue este layout (gerado a partir do repositório-template):

```
detran-<sistema>/
├─ apps/
│  ├─ api/                # Backend NestJS (TypeScript estrito)
│  │  ├─ src/
│  │  │  ├─ <dominio>/    # Módulos por domínio: controller, service, module, dto
│  │  │  ├─ app.module.ts
│  │  │  └─ main.ts
│  │  └─ Dockerfile
│  └─ web/                # Frontend React + Vite
│     ├─ src/
│     │  ├─ components/
│     │  ├─ pages/
│     │  └─ auth/         # Integração MSAL/Entra
│     └─ Dockerfile
├─ prisma/
│  ├─ schema.prisma       # Schema PostgreSQL próprio do domínio
│  └─ migrations/
├─ .kiro/
│  └─ steering/           # Steerings canônicos (sincronizados) + dominio.md
├─ docker-compose.yml     # Postgres local + serviços
├─ .env.example
└─ package.json
```

## Convenções
- **Nomes de arquivo:** `kebab-case` para arquivos; `PascalCase` para classes/componentes.
- **Módulos NestJS:** um módulo por domínio, com `*.controller.ts`, `*.service.ts`,
  `*.module.ts` e DTOs em `dto/`.
- **Ordem de imports:** (1) libs externas, (2) `@detran/shared-contract`, (3) imports internos.
- **Organização por domínio**, não por tipo técnico.
- **Steerings:** os canônicos são sincronizados a partir do contrato compartilhado; cada
  sistema acrescenta apenas o seu `dominio.md`.
