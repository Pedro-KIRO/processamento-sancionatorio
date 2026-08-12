---
inclusion: fileMatch
fileMatchPattern: 'apps/web/**'
---

# Design de Componentes — Specs para geração de UI

> Este steering define como o Kiro deve gerar componentes visuais.
> Baseado no UI KIT Detran-SP (Figma). Referência completa em `docs/design-system/`.

## Regras gerais

- Todas as cores via `var(--detran-*)` — nunca hex direto
- Fonte: `var(--detran-font-family)` (Open Sans)
- Espaçamentos: `var(--detran-spacing-*)` — nunca valores arbitrários
- Border radius: `var(--detran-radius-*)` — nunca valores arbitrários
- Ícones: importar de `src/assets/icons/` — nunca inline ou bibliotecas externas

---

## Button

### Variantes

| Variante | Fundo | Texto | Borda |
|----------|-------|-------|-------|
| primary | `var(--detran-azul-escuro)` | `var(--detran-texto-invertido)` | nenhuma |
| secondary | transparente | `var(--detran-azul-escuro)` | 1px solid `var(--detran-azul-escuro)` |
| danger | `var(--detran-erro)` | `var(--detran-texto-invertido)` | nenhuma |
| ghost | transparente | `var(--detran-azul-claro)` | nenhuma |

### Tamanhos

| Tamanho | Padding | Font-size | Min-height |
|---------|---------|-----------|-----------|
| sm | `var(--detran-spacing-xs)` `var(--detran-spacing-sm)` | `var(--detran-font-size-xs)` | 32px |
| md | `var(--detran-spacing-sm)` `var(--detran-spacing-md)` | `var(--detran-font-size-sm)` | 40px |
| lg | `var(--detran-spacing-md)` `var(--detran-spacing-lg)` | `var(--detran-font-size-base)` | 48px |

### Estados

- Hover Primary: `box-shadow: 0px 0px 1px 5px var(--detran-cyan-400)` (#E6F0FC)
- Hover Secondary: `box-shadow: 0px 0px 1px 5px var(--detran-neutral-300)` (#EAECEE)
- Hover Tertiary/Ghost: `box-shadow: 0px 0px 1px 5px var(--detran-blue-400)` (#A4CFED)
- Hover Danger: `box-shadow: 0px 0px 1px 5px var(--detran-red-400)` (#FFE5E5)
- Disabled: opacity 0.5, cursor not-allowed, sem sombra
- Focus: outline 2px solid `var(--detran-azul-claro)`, offset 2px
- Loading: texto substituído por spinner, botão desabilitado

### Implementação

```tsx
<button className="btn btn-primary btn-md">Salvar</button>
```

---

## Input Text

### Estrutura

```
Label (obrigatório)
[Input field]
Helper text ou mensagem de erro
```

### Estilos

| Propriedade | Valor |
|-------------|-------|
| Altura | 40px |
| Padding | `var(--detran-spacing-sm)` `var(--detran-spacing-md)` |
| Borda | 1px solid `var(--detran-borda)` |
| Border-radius | `var(--detran-radius-sm)` |
| Font-size | `var(--detran-font-size-base)` |
| Placeholder | color `var(--detran-texto-secundario)` |

### Estados

| Estado | Borda | Fundo | Sombra |
|--------|-------|-------|--------|
| Default | `var(--detran-borda)` | `var(--detran-branco)` | nenhuma |
| Hover | `var(--detran-borda)` | `var(--detran-branco)` | `var(--detran-shadow-input-hover)` |
| Focus | `var(--detran-azul-claro)` | `var(--detran-branco)` | `var(--detran-shadow-input-focus)` |
| Error | `var(--detran-erro)` | `var(--detran-branco)` | nenhuma |
| Disabled | `var(--detran-borda)` | `var(--detran-fundo)` | nenhuma |

### Variantes de sombra para inputs

| Variante | Uso | CSS Variable |
|----------|-----|-------------|
| Search | Campos de busca fixos na interface | `var(--detran-shadow-input-search)` |
| Focus | Estado ativo do input (guia atenção) | `var(--detran-shadow-input-focus)` |
| Dropdown | Lista suspensa aberta (profundidade) | `var(--detran-shadow-input-dropdown)` |
| Hover (checkbox) | Foco visual suave ao passar mouse | `var(--detran-shadow-input-hover)` |

### Label

- Font-size: `var(--detran-font-size-sm)`
- Font-weight: 600
- Color: `var(--detran-texto-primario)`
- Margin-bottom: `var(--detran-spacing-xs)`

### Mensagem de erro

- Font-size: `var(--detran-font-size-xs)`
- Color: `var(--detran-erro)`
- Margin-top: `var(--detran-spacing-xs)`

---

## Table

### Estrutura

```
[Header com título + ações (filtro, busca, adicionar)]
[Cabeçalho da tabela]
[Linhas de dados]
[Paginação]
```

### Estilos

| Elemento | Propriedade | Valor |
|----------|-------------|-------|
| Container | border | 1px solid `var(--detran-borda)` |
| Container | border-radius | `var(--detran-radius-md)` |
| Container | overflow | hidden |
| Header row | background | `var(--detran-fundo)` |
| Header row | font-weight | 600 |
| Header row | font-size | `var(--detran-font-size-sm)` |
| Header row | color | `var(--detran-texto-secundario)` |
| Body row | border-bottom | 1px solid `var(--detran-borda)` |
| Body row | padding | `var(--detran-spacing-sm)` `var(--detran-spacing-md)` |
| Body row hover | background | `var(--detran-fundo)` |
| Body cell | font-size | `var(--detran-font-size-sm)` |

### Paginação (obrigatória para listas > 10 itens)

- Posição: abaixo da tabela, alinhado à direita
- Mostra: "Página X de Y" + botões anterior/próximo
- Itens por página padrão: 10

---

## Card

### Estilos

| Propriedade | Valor |
|-------------|-------|
| Background | `var(--detran-branco)` |
| Border | 1px solid `var(--detran-borda)` |
| Border-radius | `var(--detran-radius-md)` |
| Padding | `var(--detran-spacing-lg)` |
| Shadow | `var(--detran-shadow-sm)` |

### Hover (se clicável)

- Shadow: `var(--detran-shadow-md)`
- Cursor: pointer

---

## Alert / Notificação

### Variantes

| Tipo | Fundo | Borda-left | Ícone cor |
|------|-------|-----------|-----------|
| success | #f0fdf4 | 4px `var(--detran-sucesso)` | `var(--detran-sucesso)` |
| error | #fef2f2 | 4px `var(--detran-erro)` | `var(--detran-erro)` |
| warning | #fffbeb | 4px `var(--detran-aviso)` | `var(--detran-aviso)` |
| info | #f0f9ff | 4px `var(--detran-info)` | `var(--detran-info)` |

### Estrutura

```
[Ícone] [Título (bold)] [Botão fechar (opcional)]
        [Mensagem descritiva]
```

### Estilos comuns

- Padding: `var(--detran-spacing-md)`
- Border-radius: `var(--detran-radius-sm)`
- Font-size título: `var(--detran-font-size-sm)`, weight 600
- Font-size mensagem: `var(--detran-font-size-sm)`, weight 400

---

## Badge / Tag

### Variantes

| Tipo | Fundo | Texto |
|------|-------|-------|
| default | `var(--detran-fundo)` | `var(--detran-texto-primario)` |
| primary | #e0edff | `var(--detran-azul-escuro)` |
| success | #dcfce7 | #166534 |
| error | #fee2e2 | #991b1b |
| warning | #fef3c7 | #92400e |

### Estilos

- Padding: 2px 8px
- Border-radius: `var(--detran-radius-full)`
- Font-size: `var(--detran-font-size-xs)`
- Font-weight: 500

---

## Modal / Dialog

### Estrutura

```
[Overlay escuro (rgba(0,0,0,0.5))]
  [Container centralizado]
    [Header: título + botão fechar]
    [Body: conteúdo]
    [Footer: botões de ação]
```

### Estilos

| Elemento | Propriedade | Valor |
|----------|-------------|-------|
| Container | background | `var(--detran-branco)` |
| Container | border-radius | `var(--detran-radius-lg)` |
| Container | shadow | `var(--detran-shadow-lg)` |
| Container | max-width | 500px |
| Container | width | 90% |
| Header | padding | `var(--detran-spacing-lg)` |
| Header | border-bottom | 1px solid `var(--detran-borda)` |
| Body | padding | `var(--detran-spacing-lg)` |
| Footer | padding | `var(--detran-spacing-md)` `var(--detran-spacing-lg)` |
| Footer | border-top | 1px solid `var(--detran-borda)` |
| Footer | text-align | right |

---

## Sidebar / Menu lateral

### Estilos

| Propriedade | Valor |
|-------------|-------|
| Width | 260px |
| Background | `var(--detran-branco)` |
| Border-right | 1px solid `var(--detran-borda)` |
| Padding-top | `var(--detran-spacing-lg)` |

### Item de menu

| Estado | Background | Texto | Border-left |
|--------|-----------|-------|-------------|
| Default | transparente | `var(--detran-texto-secundario)` | nenhuma |
| Hover | `var(--detran-fundo)` | `var(--detran-texto-primario)` | nenhuma |
| Ativo | `var(--detran-fundo)` | `var(--detran-azul-escuro)` | 3px `var(--detran-azul-escuro)` |

### Item de menu — estilos

- Padding: `var(--detran-spacing-sm)` `var(--detran-spacing-md)`
- Font-size: `var(--detran-font-size-sm)`
- Ícone: 20px, margin-right `var(--detran-spacing-sm)`, cor segue o texto
- Transição: background 0.2s ease

---

## Header / TopBar

### Estilos

| Propriedade | Valor |
|-------------|-------|
| Height | 64px |
| Background | `var(--detran-branco)` |
| Border-bottom | 1px solid `var(--detran-borda)` |
| Padding | 0 `var(--detran-spacing-lg)` |
| Display | flex, align-items center, justify-content space-between |

### Conteúdo

- Esquerda: logo (32px height) + nome do sistema (font-size lg, weight 600)
- Direita: nome do usuário + avatar + botão sair

---

## Checkbox

### Estilos

| Estado | Borda | Fundo | Ícone | Sombra |
|--------|-------|-------|-------|--------|
| Unchecked | 2px solid `var(--detran-borda)` | `var(--detran-branco)` | nenhum | nenhuma |
| Checked | 2px solid `var(--detran-azul-escuro)` | `var(--detran-azul-escuro)` | check branco | nenhuma |
| Hover | 2px solid `var(--detran-borda)` | `var(--detran-branco)` | — | `0 0 0 4px var(--detran-cyan-400)` |
| Disabled | 2px solid `var(--detran-borda)` | `var(--detran-fundo)` | cinza | nenhuma |

- Tamanho: 20px x 20px
- Border-radius: `var(--detran-radius-sm)`
- Label: margin-left `var(--detran-spacing-sm)`, font-size `var(--detran-font-size-sm)`
- A sombra de hover (`0 0 0 4px Cyan/400`) é a mesma usada em inputs (foco visual suave)

---

## Loading / Spinner

- Cor: `var(--detran-azul-escuro)`
- Tamanho padrão: 24px
- Animação: rotate 360deg, 1s linear infinite
- Usar em: botões (substituir texto), telas de carregamento (centralizado)
- Nunca deixar tela em branco — sempre mostrar loading

---

## Empty State

Quando uma listagem não tem dados:

```
[Ícone ilustrativo (64px, cor --detran-texto-secundario)]
[Título: "Nenhum registro encontrado"]
[Descrição: texto explicativo]
[Botão de ação (opcional): "Criar primeiro registro"]
```

- Centralizado vertical e horizontalmente
- Padding: `var(--detran-spacing-2xl)`
- Título: font-size lg, weight 600
- Descrição: font-size sm, color texto-secundario

---

## Breadcrumb

```
Home > Módulo > Página atual
```

- Separador: ">" ou "/" em cor texto-secundario
- Items: font-size sm, color azul-claro (link), último item color texto-primario (não clicável)
- Margin-bottom: `var(--detran-spacing-md)`

---

## Tooltip

- Background: `var(--detran-texto-primario)` (escuro)
- Color: `var(--detran-texto-invertido)`
- Padding: `var(--detran-spacing-xs)` `var(--detran-spacing-sm)`
- Border-radius: `var(--detran-radius-sm)`
- Font-size: `var(--detran-font-size-xs)`
- Max-width: 200px
- Aparece em hover com delay 300ms

---

## Elevação e Sombras

O sistema usa 4 níveis de elevação para criar hierarquia visual:

| Nível | Elevação | CSS Variable | Valor real | Uso |
|-------|----------|-------------|------------|-----|
| Flat | 0dp | `var(--detran-shadow-flat)` + borda | Sem sombra, stroke 1px Neutral/400 | Cards, inputs, containers |
| Light | 2dp | `var(--detran-shadow-sm)` | `0 1px 8px 0 Neutral/400` | Tooltips, dropdowns, botões, cards pequenos |
| Medium | 4dp | `var(--detran-shadow-md)` | `0 2px 12px -1px Neutral/400` | Popups, sidebars, modais médios |
| Dark | 8dp | `var(--detran-shadow-lg)` | `0 4px 14px 2px Neutral/400` | Modais grandes, alertas críticos |

### Input/Checkbox hover

- `var(--detran-shadow-input-hover)`: `0 0 0 4px var(--detran-cyan-400)`
- Indica foco visual suave sem roubar atenção

### Regras de uso

- Flat (0dp): elemento no mesmo nível da superfície, separado apenas por borda
- Light (2dp): separação sutil do fundo, dá leveza
- Medium (4dp): destaque moderado, elemento flutua sobre o conteúdo
- Dark (8dp): máxima elevação, se sobressai sobre tudo

### Quando usar cada nível

| Elemento | Elevação |
|----------|----------|
| Card em repouso | Flat (borda) ou Light |
| Card hover | Light → Medium (transição) |
| Dropdown/Popover | Light |
| Sidebar | Light |
| Modal médio | Medium |
| Modal grande | Dark + backdrop blur |
| Toast/Snackbar | Medium |
| Header fixo (scroll) | Light |
| Alerta crítico sobreposto | Dark |

### Backdrop blur (desfoques)

Usar em modais e overlays para separar camadas:

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}
```

### O que NÃO fazer

- Não usar sombras fora dos 4 níveis definidos
- Não combinar múltiplas sombras no mesmo elemento
- Não usar sombra em elementos planos (texto, ícones inline)
- Não inventar valores de sombra — sempre usar `var(--detran-shadow-*)`

---

## Grid & Breakpoints

Sistema de grid baseado em Bootstrap 3.4 (12 colunas, gutter 30px).

### Breakpoints

| Nome | Classe | Min-width | Container |
|------|--------|-----------|-----------|
| Phone (xs) | `.col-xs-*` | 0 | auto (fluid) |
| Tablet (sm) | `.col-sm-*` | 768px | 750px |
| Desktop (md) | `.col-md-*` | 992px | 970px |
| Desktop large (lg) | `.col-lg-*` | 1200px | 1170px |

### Media queries para uso em CSS

```css
/* Tablet e acima */
@media (min-width: 768px) { }

/* Desktop e acima */
@media (min-width: 992px) { }

/* Desktop large */
@media (min-width: 1200px) { }

/* Apenas mobile */
@media (max-width: 767px) { }
```

### Regras

- Grid de 12 colunas — usar proporções (col-6 = metade, col-4 = terço)
- Gutter: 30px (15px de padding em cada lado da coluna)
- Container centralizado com max-width por breakpoint
- Mobile first: começar pelo layout mobile e expandir com media queries
- Sidebar: largura fixa (260px), conteúdo principal ocupa o restante
