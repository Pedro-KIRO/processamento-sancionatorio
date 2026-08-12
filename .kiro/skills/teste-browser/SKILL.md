---
name: teste-browser
description: Executar testes de interface via browser headless usando Playwright MCP — smoke tests, validação de login, verificação de telas. Ativa quando o dev menciona "testar no browser", "smoke test", "testar login", "verificar tela", "teste visual", "teste E2E", "testar a aplicação" ou "abrir a página".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: testing
---

# Teste Browser

Esta skill é ativada quando o dev precisa testar a aplicação via browser —
validar login, verificar se uma tela carrega, testar fluxos de usuário ou
rodar smoke tests após deploy.

## Pré-requisitos

- Playwright MCP configurado (`.kiro/settings/mcp.json` — já incluso no template)
- Aplicação rodando localmente (`npm run dev:api` + `npm run dev:web`)
- Node.js 18+

## O que o Kiro pode fazer

O Kiro tem acesso a um browser headless via Playwright MCP e pode:

| Ação | Quando usar |
|---|---|
| Navegar para URL | Verificar se a app responde |
| Capturar screenshot | Evidência visual do estado da tela |
| Clicar em elementos | Testar fluxos de navegação |
| Preencher formulários | Testar criação de registros |
| Verificar texto na tela | Confirmar que dados aparecem |
| Monitorar rede | Verificar chamadas à API |
| Mockar APIs | Testar frontend isoladamente |

## Tipos de teste

### 1. Smoke test (pós-deploy ou pós-setup)

Verificação rápida de que o sistema está no ar:

```
Navegue para http://localhost:5173 e verifique que:
- A página carrega sem erro
- O botão de login aparece
- Não há erros no console
```

### 2. Teste de login (Entra ID)

> ⚠️ Login com Entra ID real requer credenciais. Para teste local,
> verificar apenas que o redirect para o Entra acontece corretamente.

```
Navegue para http://localhost:5173, clique em "Entrar" e verifique que:
- O browser redireciona para login.microsoftonline.com
- A URL contém o tenant_id e client_id corretos
```

### 3. Teste de fluxo completo

```
1. Navegue para http://localhost:5173
2. (se já autenticado) Verifique que a HomePage carrega
3. Clique em <elemento do domínio>
4. Preencha o formulário com dados de teste
5. Submeta e verifique a mensagem de sucesso
```

### 4. Teste de API via browser

```
Navegue para http://localhost:3000/api/<endpoint> e verifique que:
- Retorna status 200
- O JSON contém os campos esperados
```

## O que o Kiro deve fazer ao ativar esta skill

1. **Verificar se a app está rodando** — testar conexão com `localhost:5173` e `localhost:3000`
2. **Inferir o tipo de teste do contexto** — se veio após onboarding → smoke test;
   se veio após implementar feature → teste de fluxo; se veio após deploy → smoke em hml.
   Só perguntar "O que você quer testar?" se o contexto for ambíguo.
3. **Executar os passos** usando as ferramentas do Playwright MCP
4. **Reportar o resultado** com evidências (screenshot se visual, texto se dado)
5. **Se falhar:** diagnosticar o problema (consultar skill `troubleshooting` se necessário)

## Integração com o fluxo de trabalho

| Momento | Tipo de teste |
|---|---|
| Após `/onboarding` (Etapa 8) | Smoke test — app sobe sem erros |
| Durante desenvolvimento | Teste de fluxo — validar a feature |
| Antes de abrir PR (`/pr-review`) | Smoke test + teste do fluxo alterado |
| Após deploy (`/deploy-sistema`) | Smoke test na URL de homologação |

## O que NÃO fazer

- Não testar com credenciais reais de produção
- Não rodar testes destrutivos (delete, reset) em homologação sem avisar
- Não depender exclusivamente de testes de browser — testes unitários e de integração continuam necessários
- Não tratar screenshots como documentação permanente — são evidências pontuais

## Referências

- Guia de cenários: [references/cenarios-teste.md](references/cenarios-teste.md)
- Configuração MCP: `.kiro/settings/mcp.json`
- Troubleshooting: skill `/troubleshooting`
