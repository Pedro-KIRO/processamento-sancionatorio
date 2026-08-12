---
name: novo-asset
description: Adicionar novo asset visual (icone, logo, imagem) ao sistema e ao template simultaneamente. Ativa quando o dev menciona "novo icone", "adicionar imagem", "preciso de um asset", "exportar do figma", "novo logo", "asset que nao existe" ou "adicionar ao template".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: assets
---

# Novo Asset

Esta skill conduz o processo de adicionar um asset visual novo (icone, logo,
imagem, background) ao sistema atual E ao template, garantindo que ambos
fiquem sincronizados.

## Quando usar

- O dev precisa de um icone/imagem que nao existe em `src/assets/`
- O dev exportou algo do Figma e quer adicionar ao projeto
- O UX criou um asset novo que precisa entrar na plataforma

## Pre-requisitos

- O arquivo do asset ja foi exportado (SVG ou PNG)
- O dev sabe em qual categoria ele se encaixa (icon, logo, img, tema, bg)
- O template esta clonado em `~/projetos/detran-dti-platform-template/`

## O que o Kiro faz (AUTOMATICO)

### Etapa 1 — Coletar informacoes

Perguntar ao dev:

1. "Qual e o arquivo do asset?" (caminho ou o dev cola/arrasta)
2. "Qual categoria?" (icon, logo, img, tema, bg)
3. "Qual nome descritivo?" (ex.: `aprovacao`, `selo-digital`, `banner-ferias`)

### Etapa 2 — Validar e nomear

- Aplicar a convencao: `<categoria>.<nome-kebab-case>.<extensao>`
- Validar que o nome esta em kebab-case, sem acentos, sem espacos
- Verificar se ja existe um asset com o mesmo nome (evitar duplicatas)
- Para icones SVG novos: verificar se usa a cor `#1E124A` e viewBox `0 -960 960 960`

Exemplos de nomes gerados:
- `icon.aprovacao.svg`
- `logo.selo-digital.png`
- `img.banner-ferias.png`

### Etapa 3 — Adicionar ao sistema atual

O asset vai para a pasta correta do sistema que o dev esta desenvolvendo:

```bash
cp <arquivo-origem> apps/web/src/assets/<categoria>s/<nome-final>
```

Mapear categoria para pasta:
- `icon` → `assets/icons/`
- `logo` → `assets/logos/`
- `img` → `assets/images/`
- `tema` → `assets/temas/`
- `bg` → `assets/backgrounds/`

Informar ao dev:
```
Asset adicionado ao sistema: apps/web/src/assets/<categoria>s/<nome-final>
Voce ja pode usar no codigo. Ele sera incluido no seu PR normalmente.
```

### Etapa 4 — Replicar no template (automatico, sem intervencao do dev)

O Kiro copia o mesmo asset para o template e abre um PR separado.
O dev NAO precisa fazer nada — isso e transparente para ele.

```bash
cd ~/projetos/detran-dti-platform-template
git checkout main && git pull
git checkout -b chore/asset-<nome>
cp <arquivo-origem> apps/web/src/assets/<categoria>s/<nome-final>
git add apps/web/src/assets/<categoria>s/<nome-final>
git commit -m "chore(assets): adiciona <categoria> <nome>"
git push -u origin chore/asset-<nome>
gh pr create --title "chore(assets): adiciona <categoria> <nome>" \
  --body "Asset exportado do Figma pelo dev durante desenvolvimento. Categoria: <categoria>. Arquivo: <nome-final>." \
  --base main
```

> **Nota:** o PR no template fica pendente de aprovacao do tech lead.
> O dev continua trabalhando normalmente no sistema dele.
> Quando o tech lead aprovar, todos os sistemas futuros ja nascerao com esse asset.

### Etapa 5 — Confirmar ao dev

```
Asset adicionado com sucesso!

  No seu sistema: apps/web/src/assets/<categoria>s/<nome-final>
  No template:    PR aberto automaticamente (aguardando aprovacao do tech lead)

  Para usar no codigo:
  import asset from "@/assets/<categoria>s/<nome-final>";

  Voce nao precisa fazer mais nada com o template.
  Continue seu desenvolvimento normalmente.
```

## Fluxo do Figma ao codigo

1. Dev abre o Figma (link no CONTRIBUTING)
2. Encontra o objeto desejado
3. Clica com botao direito → "Copy as" → SVG (para icones) ou PNG (para imagens)
4. Salva o arquivo localmente (ex.: `~/Downloads/meu-icone.svg`)
5. Aciona `/novo-asset` no Kiro
6. Kiro conduz o processo automaticamente

## Regras

- Nomes em kebab-case, sem acentos
- Icones novos preferencialmente em SVG
- Cor padrao de icones SVG: `#1E124A`
- Nunca sobrescrever asset existente sem aprovacao
- O PR no template e separado do PR de desenvolvimento do sistema

## Referencia visual

Figma UI KIT: (inserir link compartilhavel aqui)

Ver `apps/web/src/assets/README.md` para convencao completa de nomes.
