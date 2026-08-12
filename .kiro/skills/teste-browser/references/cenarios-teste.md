# Cenários de Teste Browser

Cenários prontos para o Kiro executar via Playwright MCP.
Copie e cole no chat ou peça ao Kiro para executar diretamente.

---

## Cenário 1 — Smoke test básico

**Objetivo:** verificar que frontend e backend estão respondendo.

**Passos para o Kiro:**
1. Navegar para `http://localhost:5173`
2. Verificar que a página carrega (não é tela branca)
3. Capturar screenshot como evidência
4. Navegar para `http://localhost:3000/api` (ou health endpoint)
5. Verificar que retorna resposta (200 ou JSON)

**Resultado esperado:**
- Frontend: página com conteúdo visível
- Backend: resposta HTTP sem erro

---

## Cenário 2 — Redirect de login

**Objetivo:** confirmar que o botão de login redireciona para o Entra ID.

**Passos para o Kiro:**
1. Navegar para `http://localhost:5173`
2. Encontrar e clicar no botão "Entrar" (ou similar)
3. Verificar que a URL mudou para `login.microsoftonline.com`
4. Verificar que a URL contém o `client_id` configurado no `.env`
5. Capturar screenshot da tela de login do Entra

**Resultado esperado:**
- Redirect acontece para o Entra ID
- URL contém o tenant e client corretos

---

## Cenário 3 — Verificar HomePage autenticada

**Objetivo:** confirmar que após login a HomePage carrega corretamente.

> ⚠️ Este cenário requer que o browser já tenha sessão ativa
> (storage state salvo) ou que se use token mockado.

**Passos para o Kiro:**
1. Navegar para `http://localhost:5173`
2. Se pedir login, verificar que o redirect funciona (cenário 2)
3. Se já autenticado, verificar que:
   - O nome do usuário aparece na tela
   - O menu/navegação do sistema está visível
   - Não há erros no console
4. Capturar screenshot

---

## Cenário 4 — CRUD básico do domínio

**Objetivo:** testar o fluxo completo de criação de um registro.

**Passos para o Kiro:**
1. Navegar para a página de listagem do domínio
2. Clicar em "Novo" ou "Criar"
3. Preencher o formulário com dados de teste:
   - Usar dados fictícios mas válidos
   - Preencher todos os campos obrigatórios
4. Submeter o formulário
5. Verificar mensagem de sucesso
6. Verificar que o item aparece na listagem
7. Capturar screenshot do resultado

**Resultado esperado:**
- Formulário aceita dados válidos
- Registro aparece na listagem após criação

---

## Cenário 5 — Validação de formulário

**Objetivo:** confirmar que o frontend valida entrada inválida.

**Passos para o Kiro:**
1. Navegar para o formulário de criação
2. Submeter o formulário VAZIO (sem preencher nada)
3. Verificar que mensagens de erro aparecem
4. Preencher com dados inválidos (ex.: texto em campo numérico)
5. Verificar que a validação bloqueia a submissão
6. Capturar screenshot com as mensagens de erro

**Resultado esperado:**
- Mensagens de erro claras em português
- Formulário não submete com dados inválidos

---

## Cenário 6 — Smoke test em homologação

**Objetivo:** verificar que o deploy em homologação funcionou.

**Passos para o Kiro:**
1. Navegar para `https://homolog.<sistema>.detran.sp.gov.br`
2. Verificar que a página carrega (não 502/503)
3. Verificar que o botão de login aparece
4. Clicar em login e confirmar redirect para Entra
5. Navegar para `https://homolog.<sistema>.detran.sp.gov.br/api/health`
6. Verificar resposta 200
7. Capturar screenshots de cada etapa

**Resultado esperado:**
- App acessível via HTTPS
- Login redireciona corretamente
- API responde

---

## Cenário 7 — Verificação de responsividade

**Objetivo:** confirmar que a interface funciona em diferentes tamanhos de tela.

**Passos para o Kiro:**
1. Navegar para a HomePage
2. Capturar screenshot em desktop (1920x1080)
3. Redimensionar para tablet (768x1024)
4. Capturar screenshot
5. Redimensionar para mobile (375x667)
6. Capturar screenshot
7. Verificar que nenhum elemento fica inacessível

---

## Como usar estes cenários

No chat do Kiro, peça diretamente:

```
Execute o cenário 1 (smoke test básico)
```

Ou descreva o que quer testar em linguagem natural:

```
Testa se o login está funcionando — quero ver o redirect para o Entra
```

O Kiro vai usar o Playwright MCP para executar os passos e reportar o resultado.
