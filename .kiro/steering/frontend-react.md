---
inclusion: fileMatch
fileMatchPattern: 'apps/web/**'
---

# Frontend — Padrões React + Vite

## Base

- React + Vite, TypeScript estrito. Componentes funcionais e hooks.
- Organização por **domínio/feature**, não por tipo de arquivo.

## Autenticação

- Login via **MSAL/Entra ID**. Token obtido pelo MSAL e enviado nas chamadas à API.
- Não armazene token em local inseguro; siga o padrão do helper de auth do contrato.

## Consumo da API e tipos

- Use os **tipos do `@detran/shared-contract`** nas respostas e formulários.
- Trate estados de carregamento e erro de forma explícita; nada de tela "muda" em falha.

---

## Assets visuais — REGRA OBRIGATÓRIA

> **Todos os ícones, logos, imagens e backgrounds devem vir EXCLUSIVAMENTE
> da pasta `src/assets/`.** Não é permitido:
> - Baixar ícones de fontes externas (Font Awesome, Heroicons, etc.)
> - Adicionar bibliotecas de ícones via npm (react-icons, lucide-react, etc.)
> - Usar ícones inline hardcoded ou emojis como substitutos
> - Criar assets novos diretamente no sistema sem aprovação

### Estrutura dos assets disponíveis

```
src/assets/
├── icons/          ← Ícones aprovados (SVG e PNG)
├── logos/          ← Logos institucionais
├── temas/          ← Paletas de cores de referência
├── backgrounds/    ← Fundos e gradientes
└── images/         ← Imagens ilustrativas
```

### Como usar

```tsx
// Importar ícone SVG
import dashboardIcon from "@/assets/icons/icon.dashboard.svg";

// Importar ícone PNG
import carroIcon from "@/assets/icons/icon.carro.png";

// Usar em componente
<img src={dashboardIcon} alt="Dashboard" width={24} height={24} />
```

### Convenção de nomes dos assets

- Formato: `<categoria>.<nome-kebab-case>.<extensão>`
- Exemplos: `icon.adicionar-pessoa.svg`, `logo.detran-horizontal-preto.png`
- Para ícones novos, preferir **SVG** com cor `#1E124A` e 24px

### Precisa de um ícone que não existe?

1. Verifique se já existe um equivalente em `src/assets/icons/`
2. Se não existir, proponha via PR no repositório do **template**
3. O tech lead aprova e faz merge
4. Após merge no template, o asset fica disponível para todos os sistemas

> **O Kiro não deve gerar código que importe ícones de fontes externas
> ou bibliotecas de terceiros. Sempre usar os assets de `src/assets/`.**

---

## UI e identidade visual

- **Tema obrigatório:** `src/styles/theme.css` — importado no `main.tsx`
- **Nunca usar cores hardcoded** — sempre via `var(--detran-*)`
- Cor primária de ícones: `var(--detran-icone)` → `#1E124A`
- Botões principais: `var(--detran-azul-escuro)` → `#002F6C`
- Links: `var(--detran-azul-claro)` → `#007BFF`
- Fundo de página: `var(--detran-fundo)` → `#F4F6F9`
- Texto: `var(--detran-texto-primario)` → `#1A202C`
- Fonte: **Open Sans** (carregada automaticamente pelo tema)
- Ícones SVG: Google Material Symbols, viewBox `0 -960 960 960`, 24px
- Ícones PNG: legados do domínio DETRAN, mantidos por compatibilidade
- Logos: usar apenas os da pasta `src/assets/logos/`
- Background: usar `bg.degrade.webp` ou cores sólidas do tema via variáveis

> **O Kiro deve gerar código usando `var(--detran-*)` para cores,
> `var(--detran-font-*)` para tipografia e `var(--detran-spacing-*)` para espaçamentos.**

## Componentes

- **Usar MUI (Material UI v6)** como biblioteca de componentes oficial.
- Tema customizado em `src/styles/muiTheme.ts` — já aplica cores, tipografia e
  bordas do design system DETRAN-SP automaticamente.
- Importar componentes de `@mui/material`: Button, TextField, Table, Card, Dialog, etc.
- Para ícones genéricos (setas, adicionar, editar): usar `@mui/icons-material`.
- Para ícones específicos do domínio DETRAN: usar `src/assets/icons/`.
- Ao gerar componentes de UI, seguir as specs em #[[file:.kiro/steering/design-componentes.md]]
- Ao definir tipografia, seguir os tokens em #[[file:.kiro/steering/design-tipografia.md]]
- Formulários sempre com validação no cliente espelhando as regras do backend.
- Tabelas com paginação obrigatória para listagens com mais de 10 itens.
- Loading states explícitos (nunca tela em branco durante carregamento).
- Mensagens de erro em português, claras e acionáveis.

## O que NÃO fazer

- ❌ Instalar `react-icons`, `@heroicons/react`, `lucide-react` ou similares
- ❌ Usar Font Awesome ou qualquer icon font via CDN
- ❌ Definir cores inline (`color: "#ff0000"`) — usar tokens do tema MUI ou var(--detran-*)
- ❌ Criar componentes de UI genéricos (Button, Modal) do zero — usar MUI
- ❌ Usar imagens do Google/internet sem autorização — apenas as de `src/assets/`
- ❌ Adicionar assets novos diretamente no sistema (devem ir pelo template)
- ❌ Instalar frameworks CSS adicionais (Tailwind, Bootstrap, Chakra)
- ❌ Instalar extensões/plugins do MUI (MUI X, DataGrid Pro) sem aprovação do tech lead
