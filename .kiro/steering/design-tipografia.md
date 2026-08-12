---
inclusion: fileMatch
fileMatchPattern: 'apps/web/**'
---

# Tipografia — Tokens Semânticos

> Baseado no UI KIT Detran-SP v2.0 (Figma).
> O Kiro DEVE usar estes tokens ao gerar qualquer texto na interface.

## Regras gerais

- Fonte: Open Sans (carregada via theme.css)
- Pesos permitidos: Light (300), Regular (400), Semibold (600)
- Letter-spacing: 0% (exceto Overline que usa 4%)
- Nunca usar tamanhos fora da escala definida
- Responsivo: usar variantes Desktop para telas >= 768px, Mobile para < 768px

---

## Display (uso moderado — apenas landing pages e banners)

| Variante | Size | Weight | Line-height |
|----------|------|--------|-------------|
| Display/Desktop | 90px | Semibold (600) | 120px |
| Display/Mobile | 40px | Semibold (600) | 56px |

---

## Heading Desktop (>= 768px)

| Token | Size | Weight | Line-height |
|-------|------|--------|-------------|
| H1/Desktop | 64px | Regular (400) | 96px |
| H2/Desktop | 48px | Regular (400) | 64px |
| H3/Desktop | 40px | Light/Regular/Semibold | 56px |
| H4/Desktop | 32px | Regular/Semibold | 48px |
| H5/Desktop | 24px | Regular/Semibold | 36px |
| H6/Desktop | 20px | Semibold (600) | 28px |

---

## Heading Mobile (< 768px)

| Token | Size | Weight | Line-height |
|-------|------|--------|-------------|
| H1/Mobile | 32px | Regular (400) | 48px |
| H2/Mobile | 28px | Regular (400) | 40px |
| H3/Mobile | 24px | Light/Regular/Semibold | 36px |
| H4/Mobile | 20px | Regular/Semibold | 28px |
| H5/Mobile | 18px | Regular/Semibold | 28px |
| H6/Mobile | 16px | Semibold (600) | 28px |

---

## Paragraph (corpo de texto)

| Token | Size | Weight | Line-height |
|-------|------|--------|-------------|
| Paragraph/Large | 18px | Regular (400) | 28px |
| Paragraph/Medium | 16px | Regular (400) | 24px |
| Paragraph/Small | 14px | Regular (400) | 21px |
| Paragraph/X-Small | 12px | Regular (400) | 18px |

**Uso:** textos corridos, descrições, conteúdo principal.

---

## Label (rótulos de campos e elementos)

| Token | Size | Weight | Line-height |
|-------|------|--------|-------------|
| Label/Large | 18px | Semibold (600) | 28px |
| Label/Medium | 16px | Semibold (600) | 24px |
| Label/Small | 14px | Semibold (600) | 21px |
| Label/X-Small | 12px | Semibold (600) | 18px |

**Uso:** labels de inputs, títulos de seções, botões, tabs.

---

## Placeholder (texto dentro de inputs vazios)

| Token | Size | Weight | Line-height |
|-------|------|--------|-------------|
| Placeholder/Large | 18px | Regular (400) | 28px |
| Placeholder/Medium | 16px | Regular (400) | 24px |
| Placeholder/Small | 14px | Regular (400) | 21px |
| Placeholder/X-Small | 12px | Regular (400) | 18px |

**Uso:** texto de placeholder em campos de formulário. Cor: `var(--detran-texto-secundario)`.

---

## Input (texto digitado pelo usuário)

| Token | Size | Weight | Line-height |
|-------|------|--------|-------------|
| Input/Large | 18px | Regular (400) | 28px |
| Input/Medium | 16px | Regular (400) | 24px |
| Input/Small | 14px | Regular (400) | 21px |
| Input/X-Small | 12px | Regular (400) | 18px |

**Uso:** valor digitado dentro de inputs. Cor: `var(--detran-texto-primario)`.

---

## Overline (categorias, indicações pequenas)

| Token | Size | Weight | Line-height | Letter-spacing |
|-------|------|--------|-------------|---------------|
| Overline/Large | 18px | Regular (400) | 28px | 4% |
| Overline/Medium | 16px | Regular (400) | 24px | 4% |
| Overline/Small | 14px | Regular (400) | 21px | 4% |
| Overline/X-Small | 12px | Regular (400) | 18px | 4% |

**Uso:** etiquetas de categoria, breadcrumbs, metadados. Geralmente em MAIÚSCULAS.

---

## Link (texto clicável)

| Token | Size | Weight | Line-height |
|-------|------|--------|-------------|
| Link/Large | 18px | Regular (400) | 28px |
| Link/Medium | 16px | Regular (400) | 24px |
| Link/Small | 14px | Regular (400) | 21px |

**Uso:** links inline, navegação textual. Cor: `var(--detran-azul-claro)`. Hover: underline + `var(--detran-azul-medio)`.

---

## Caption (textos auxiliares pequenos)

| Token | Size | Weight | Line-height |
|-------|------|--------|-------------|
| Caption/Large | 14px | Regular (400) | 21px |
| Caption/Medium | 12px | Regular (400) | 18px |
| Caption/Small | 10px | Regular (400) | 18px |
| Caption/X-Small | 10px | Regular (400) | 18px |

**Uso:** timestamps, notas de rodapé, textos auxiliares abaixo de campos, créditos.

---

## Tag (rótulos em badges/chips)

| Token | Size | Weight | Line-height |
|-------|------|--------|-------------|
| Tag/Large | 14px | Semibold (600) | 21px |
| Tag/Medium | 12px | Semibold (600) | 18px |
| Tag/Small | 10px | Semibold (600) | 18px |
| Tag/X-Small | 10px | Semibold (600) | 18px |

**Uso:** texto dentro de badges, chips, tags de status.

---

## Responsivo — Desktop vs Mobile

Os sistemas internos usam estas variantes por breakpoint:

| Elemento | Desktop (>= 768px) | Mobile (< 768px) |
|----------|-------------------|------------------|
| Paragraph | Large / Medium | Medium / Small / X-Small |
| Label | Large / Medium / Small | Medium / Small / X-Small |
| Input | Large / Medium | Medium / Small |
| Placeholder | Large / Medium | Medium / Small |
| Link | Large / Medium | Medium / Small |
| Caption | Large / Medium | Medium / Small / X-Small |
| Overline | Large / Medium | Small / X-Small |
| Tag | Large | Medium / Small / X-Small |

---

## Mapeamento para CSS Variables

Ao gerar código, o Kiro deve usar as variáveis do `theme.css`:

| Uso no código | Variável CSS |
|---------------|-------------|
| Tamanho 10px | `var(--detran-font-size-10)` |
| Tamanho 12px | `var(--detran-font-size-12)` |
| Tamanho 14px | `var(--detran-font-size-14)` |
| Tamanho 16px | `var(--detran-font-size-16)` |
| Tamanho 18px | `var(--detran-font-size-18)` |
| Tamanho 20px | `var(--detran-font-size-20)` |
| Tamanho 24px | `var(--detran-font-size-24)` |
| Tamanho 32px | `var(--detran-font-size-32)` |
| Tamanho 40px | `var(--detran-font-size-40)` |
| Tamanho 48px | `var(--detran-font-size-48)` |
| Tamanho 64px | `var(--detran-font-size-64)` |
| Tamanho 90px | `var(--detran-font-size-90)` |
| Peso Light | `var(--detran-font-weight-light)` |
| Peso Regular | `var(--detran-font-weight-regular)` |
| Peso Semibold | `var(--detran-font-weight-semibold)` |

---

## Padrão para sistemas internos (admin/dashboard)

Para os sistemas internos da DTI, os tamanhos mais comuns são:

| Elemento | Desktop | Mobile |
|----------|---------|--------|
| Título da página | H3 (40px) | H3/Mobile (24px) |
| Subtítulo de seção | H5 (24px) | H5/Mobile (18px) |
| Corpo de texto | Paragraph/Medium (16px) | Paragraph/Medium (16px) |
| Labels de formulário | Label/Small (14px) | Label/Small (14px) |
| Texto de tabela | Paragraph/Small (14px) | Paragraph/Small (14px) |
| Cabeçalho de tabela | Label/Small (14px) | Label/Small (14px) |
| Botões | Label/Small (14px) | Label/Small (14px) |
| Texto auxiliar/helper | Paragraph/X-Small (12px) | Paragraph/X-Small (12px) |
| Breadcrumbs | Overline/Small (14px) | Overline/X-Small (12px) |
