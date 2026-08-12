---
name: personalizar-app
description: Personalizar as telas do template com o nome e descrição do sistema real — substituir placeholders pela identidade do sistema. Ativa quando o dev menciona "personalizar tela", "tela de boas-vindas", "nome do sistema na tela", "ajustar frontend", "placeholder" ou "substituir template".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: code-generation
---

# Personalizar App — Telas do Sistema

Esta skill substitui os placeholders do template pelas informações reais do
sistema: nome, descrição e orientações para o dev. Ativa quando o dev menciona
"personalizar tela", "boas-vindas", "nome do sistema" ou similar.

## Quando usar

- Após o onboarding (automático — o onboarding pode chamar esta skill)
- Quando o dev perceber que as telas ainda mostram "Sistema DTI / DETRAN-SP" genérico
- Quando quiser ajustar a mensagem de boas-vindas

## Informações necessárias

O Kiro extrai do `dominio.md` (ou pergunta se não encontrar):
- **Nome do sistema** (ex.: `Ponto Digital`)
- **Descrição curta** (ex.: `Sistema integrado de Ponto para funcionários Detran SP`)

## O que o Kiro faz (AUTOMÁTICO)

### 1. Atualizar `apps/web/src/pages/LoginPage.tsx`

Substituir:
- `"Sistema DTI / DETRAN-SP"` → nome real do sistema
- `"Acesso restrito a servidores autorizados."` → manter (é padrão)

Resultado:
```tsx
<h1><NOME_SISTEMA></h1>
<p style={{ color: "#555" }}><DESCRICAO> — DETRAN-SP</p>
<p>Acesso restrito a servidores autorizados.</p>
```

### 2. Atualizar `apps/web/src/pages/HomePage.tsx`

Substituir o conteúdo pelo template de boas-vindas:

```tsx
import { useMsal } from "@azure/msal-react";
import { useAuth } from "../auth/use-auth";

export function HomePage() {
  const { instance } = useMsal();
  const { conta } = useAuth();

  function fazerLogout() {
    instance.logoutPopup().catch(console.error);
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "720px", margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "1.5rem" }}><NOME_SISTEMA> — DETRAN-SP</h1>
        <button onClick={fazerLogout} style={{ cursor: "pointer" }}>Sair</button>
      </header>

      <section style={{ marginTop: "2rem" }}>
        <h2>
          Bem-vindo, <strong>{conta?.name ?? "desenvolvedor"}</strong>!
        </h2>

        <div style={{ marginTop: "1.5rem", padding: "1.5rem", background: "#f0f4f8", borderRadius: "8px" }}>
          <h3 style={{ marginTop: 0 }}>🚀 Sistema inicializado com sucesso</h3>
          <p>
            O sistema <strong><NOME_SISTEMA></strong> está configurado e pronto para desenvolvimento.
          </p>

          <h4>Próximos passos:</h4>
          <ol style={{ lineHeight: "1.8" }}>
            <li>
              Abra uma <strong>Spec session</strong> no Kiro para especificar a primeira funcionalidade
              <br />
              <code style={{ background: "#e2e8f0", padding: "2px 6px", borderRadius: "4px" }}>
                Kiro: New Spec Session (Command Palette)
              </code>
            </li>
            <li>
              Descreva a funcionalidade — o Kiro conduz por <em>Requirements → Design → Tasks</em>
            </li>
            <li>Aprove cada etapa e deixe o Kiro executar as tasks</li>
          </ol>

          <h4>Skills úteis durante o desenvolvimento:</h4>
          <ul style={{ lineHeight: "1.8" }}>
            <li><code>/criar-modulo</code> — adicionar novo módulo de domínio na API</li>
            <li><code>/git-flow</code> — dúvidas sobre branches e PRs</li>
            <li><code>/pr-review</code> — revisão antes de abrir PR</li>
            <li><code>/teste-browser</code> — testar a aplicação via browser</li>
            <li><code>/troubleshooting</code> — quando algo quebrar</li>
          </ul>
        </div>

        <p style={{ marginTop: "1.5rem", color: "#666", fontSize: "0.9rem" }}>
          Esta tela será substituída pelas funcionalidades reais do sistema durante o desenvolvimento.
        </p>
      </section>
    </main>
  );
}
```

### 3. Atualizar `index.html`

Substituir o conteudo inteiro do `apps/web/index.html` pelo template abaixo,
trocando `<NOME_SISTEMA>` e `<MODULO>` pelos valores reais:

```html
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title><NOME_SISTEMA> - DETRAN-SP</title>
    <style>
      #dev-orientation {
        font-family: system-ui, -apple-system, sans-serif;
        max-width: 680px;
        margin: 3rem auto;
        padding: 2rem;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        color: #1e293b;
        line-height: 1.6;
      }
      #dev-orientation h1 { font-size: 1.4rem; margin-top: 0; }
      #dev-orientation h2 { font-size: 1.1rem; margin-top: 1.5rem; }
      #dev-orientation code {
        background: #e2e8f0;
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 0.9em;
      }
      #dev-orientation ol, #dev-orientation ul { padding-left: 1.5rem; }
      #dev-orientation li { margin-bottom: 0.5rem; }
      #dev-orientation .note {
        margin-top: 1.5rem;
        padding: 0.75rem 1rem;
        background: #eff6ff;
        border-left: 3px solid #3b82f6;
        border-radius: 4px;
        font-size: 0.9rem;
      }
    </style>
  </head>
  <body>
    <noscript>
      <div id="dev-orientation">
        <h1>🚀 <NOME_SISTEMA> — DETRAN-SP</h1>
        <p>Sistema inicializado e pronto para desenvolvimento.</p>
        <h2>Próximos passos — iniciar as regras de negócio:</h2>
        <ol>
          <li>Abra uma <strong>Spec session</strong> no Kiro<br />
            <code>Command Palette → Kiro: New Spec Session</code></li>
          <li>Descreva a funcionalidade que deseja implementar</li>
          <li>O Kiro conduz por <strong>Requirements → Design → Tasks</strong></li>
          <li>Aprove cada etapa e deixe o Kiro executar as tasks</li>
        </ol>
        <h2>Skills úteis:</h2>
        <ul>
          <li><code>/criar-modulo</code> — novo módulo de domínio na API</li>
          <li><code>/git-flow</code> — branches e PRs</li>
          <li><code>/pr-review</code> — revisão antes de abrir PR</li>
          <li><code>/teste-browser</code> — testar via browser</li>
          <li><code>/dev-start</code> — subir o ambiente local</li>
        </ul>
        <div class="note">
          Esta tela será substituída automaticamente pelas funcionalidades reais
          conforme você implementar via Spec sessions.
        </div>
      </div>
    </noscript>

    <div id="root"></div>

    <div id="dev-orientation">
      <h1>🚀 <NOME_SISTEMA> — DETRAN-SP</h1>
      <p>Sistema inicializado e pronto para desenvolvimento.</p>
      <h2>Próximos passos — iniciar as regras de negócio:</h2>
      <ol>
        <li>Abra uma <strong>Spec session</strong> no Kiro<br />
          <code>Command Palette → Kiro: New Spec Session</code></li>
        <li>Descreva a funcionalidade que deseja implementar</li>
        <li>O Kiro conduz por <strong>Requirements → Design → Tasks</strong></li>
        <li>Aprove cada etapa e deixe o Kiro executar as tasks</li>
      </ol>
      <h2>Skills úteis:</h2>
      <ul>
        <li><code>/criar-modulo</code> — novo módulo de domínio na API</li>
        <li><code>/git-flow</code> — branches e PRs</li>
        <li><code>/pr-review</code> — revisão antes de abrir PR</li>
        <li><code>/teste-browser</code> — testar via browser</li>
        <li><code>/dev-start</code> — subir o ambiente local</li>
      </ul>
      <div class="note">
        Esta tela será substituída automaticamente pelas funcionalidades reais
        conforme você implementar via Spec sessions.
      </div>
    </div>

    <script type="module" src="/src/main.tsx"></script>
    <script>
      // Esconde a orientação quando o React montar
      document.addEventListener('DOMContentLoaded', function() {
        var observer = new MutationObserver(function() {
          var root = document.getElementById('root');
          if (root && root.children.length > 0) {
            var orientation = document.getElementById('dev-orientation');
            if (orientation && !orientation.closest('noscript')) {
              orientation.style.display = 'none';
            }
            observer.disconnect();
          }
        });
        observer.observe(document.getElementById('root'), { childList: true });
      });
    </script>
  </body>
</html>
```

> **Comportamento:** via curl (sem JS) mostra a orientacao completa.
> No browser, quando o React monta, o `MutationObserver` esconde o bloco
> e o app React assume a tela normalmente.

### 4. Reescrever `README.md` com informações do sistema

O README do template deve ser substituído por um README específico do sistema.

Template do novo README:

```markdown
# detran-dti-<sistema>

<DESCRICAO_CURTA>

---

## Como rodar localmente

### Pré-requisitos

- Node.js 20+
- Docker e Docker Compose
- PostgreSQL (via docker-compose)

### Subir o ambiente

```bash
docker-compose up -d postgres
npm install
npx prisma generate
npx prisma migrate dev
npm run dev:api     # Terminal 1
npm run dev:web     # Terminal 2
```

Ou no Kiro: `/dev-start`

### URLs locais

| Serviço | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| API | http://localhost:3000/<MODULO> |
| PostgreSQL | localhost:5432 |

---

## Stack

- **Backend:** NestJS + TypeScript estrito + Prisma
- **Frontend:** React + Vite + MSAL (Entra ID)
- **Banco:** PostgreSQL
- **Auth:** Microsoft Entra ID (OIDC)

---

## Estrutura do projeto

```
apps/
├── api/          ← Backend NestJS
│   └── src/app/<MODULO>/  ← Módulo principal
└── web/          ← Frontend React
    └── src/pages/
prisma/
└── schema.prisma ← Schema do banco
```

---

## Desenvolvimento

- Para nova funcionalidade: abra uma **Spec session** no Kiro
- Para novo módulo: `/criar-modulo`
- Para branches e PRs: `/git-flow`
- Para revisão: `/pr-review`

---

## Convenção de commits

```
feat(<escopo>): descrição
fix(<escopo>): descrição
docs: descrição
chore: descrição
```

---

## Deploy

Merge em `main` → deploy automático em homologação.
Produção: tag `v*` + aprovação do tech lead.

Detalhes: `/deploy-sistema`
```

O Kiro substitui `<sistema>`, `<DESCRICAO_CURTA>`, `<MODULO>` pelos valores reais.

### 5. Verificar build

```bash
cd apps/web && npx vite build && cd ../..
rm -rf apps/web/dist
```

### 6. Confirmar ao dev

```
✅ Sistema personalizado:
   - README.md: documentação específica do sistema
   - LoginPage: nome e descrição do sistema
   - HomePage: tela de boas-vindas com orientações
   - index.html: título atualizado

   As telas serão substituídas pelas funcionalidades reais
   conforme você implementar via Spec sessions.
```

## Integração com o onboarding

Esta skill deve ser chamada automaticamente pela skill `/onboarding` após a
Etapa 9 (renomeação do módulo), usando o nome do sistema coletado na Etapa 1.

Se executada separadamente, o Kiro lê o nome de `.kiro/steering/dominio.md`.

## O que NÃO fazer

- Não remover a estrutura MSAL/auth das páginas
- Não alterar `App.tsx` (rotas são adicionadas pelo dev durante desenvolvimento)
- Não adicionar dependências extras só para a tela de boas-vindas
