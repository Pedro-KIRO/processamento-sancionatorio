---
name: upgrade-framework
description: Atualizar o sistema com as novidades do template (skills, steerings, scripts, dependências). Ativa quando o dev menciona "atualizar framework", "upgrade template", "atualizar template", "sincronizar template", "puxar novidades" ou "upgrade-framework".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: maintenance
---

# Upgrade Framework — Atualizar Sistema com Novidades do Template

Esta skill atualiza um sistema existente com as novidades do template
(steerings, skills, scripts, dependências e documentação).

## Quando usar

- Template recebeu novidades (nova lib, novo steering, novo script)
- Tech lead comunicou que há atualização disponível
- Dev quer garantir que está alinhado com o padrão mais recente

## Pré-requisitos (verificar automaticamente)

1. Estar na **raiz do repositório do sistema** (não no template)
2. Estar na **branch main**
3. **Working tree limpa** (sem alterações pendentes)
4. `manifest.json` existir na raiz
5. Node/npm acessíveis (nvm carregado)

Se algum falhar, orientar o dev sobre como resolver antes de continuar.

## Execução — O que o Kiro deve fazer

### 1. Verificar pré-requisitos

```bash
git branch --show-current  # deve ser "main"
git status --short         # deve estar vazio
test -f manifest.json      # deve existir
```

Se working tree não estiver limpa:
> "Você tem alterações pendentes. Faça commit ou stash antes de atualizar."

Se não estiver na main:
> "Troque para a branch main antes: `git checkout main && git pull`"

### 2. Rodar o script de upgrade

```bash
bash scripts/upgrade-framework.sh
```

O script:
- Adiciona o template como remote (se não existir)
- Compara versões via `manifest.json`
- Copia steerings, skills, scripts e configs do template
- Preserva `dominio.md` e todo código do sistema
- Mostra diff para revisão

Se o script disser "Já está na versão mais recente", informar ao dev e encerrar.

### 3. Sincronizar dependências do frontend

Após o upgrade de arquivos, verificar se o `package.json` do template tem
dependências que o projeto não tem.

As dependências canônicas do frontend (que todo sistema deve ter) são:

```
@mui/material@6
@mui/icons-material@6
@emotion/react
@emotion/styled
```

Para cada uma, verificar se já está no `apps/web/package.json`. Se não estiver:

```bash
cd apps/web
npm install @mui/material@6 @mui/icons-material@6 @emotion/react @emotion/styled --save
cd ../..
```

Se já estiver instalada, pular.

### 4. Verificar se o ThemeProvider está configurado

Verificar se `apps/web/src/main.tsx` já importa e usa:
- `ThemeProvider` de `@mui/material/styles`
- `CssBaseline` de `@mui/material`
- `detranTheme` de `./styles/muiTheme`

Se não estiver, adicionar o wrapper:

```tsx
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import detranTheme from "./styles/muiTheme";

// Envolver a App:
<ThemeProvider theme={detranTheme}>
  <CssBaseline />
  {/* ... resto da app */}
</ThemeProvider>
```

Se o arquivo `src/styles/muiTheme.ts` não existir, ele já deveria ter vindo
pelo upgrade (faz parte do template). Se não veio, copiar do template.

### 5. Verificar build

```bash
npx nest build --path apps/api/tsconfig.json
cd apps/web && npx vite build && cd ../..
rm -rf apps/web/dist
```

Se falhar, diagnosticar e corrigir antes de prosseguir.

### 6. Commitar

```bash
git add -A
git commit -m "chore: upgrade framework v<antiga> → v<nova>"
git push
```

Usar as versões que o script de upgrade mostrou no output.

### 7. Informar ao dev

```
✅ Framework atualizado!

Novidades aplicadas:
- Steerings e skills sincronizados
- Dependências do frontend atualizadas
- Build verificado (backend + frontend)

Pode continuar desenvolvendo normalmente.
```

## O que NÃO fazer

- Não rodar em branch que não seja main
- Não rodar com working tree suja
- Não sobrescrever `dominio.md` (o script já protege)
- Não alterar código do domínio do sistema (apps/api/src/app/*, prisma/schema.prisma)
- Não fazer upgrade se o dev está no meio de uma implementação — pedir para finalizar primeiro

## Troubleshooting

| Sintoma | Causa | Solução |
|---|---|---|
| "Já está na versão mais recente" | Template não foi atualizado | O template precisa ser atualizado pelo tech lead primeiro |
| Falha no fetch do template | SSH não configurado | Verificar `ssh -T git@github.com` |
| Build falha após upgrade | Breaking change no template | Verificar o diff e adaptar o código do sistema |
| npm install falha | Rede ou .npmrc | Verificar conexão e autenticação no GitHub Packages |

## Referências

- Script de upgrade: `scripts/upgrade-framework.sh`
- CONTRIBUTING seção 8: como atualizar o ambiente
- Steering tech.md: stack aprovada
