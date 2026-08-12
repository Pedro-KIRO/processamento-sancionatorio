---
name: setup-mcp
description: Configurar os MCP servers do Kiro para funcionar via WSL. Ativa quando o dev menciona "configurar MCP", "setup MCP", "MCP não conecta", "MCP failed", "connection failed MCP" ou "servers MCP".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: environment-setup
---

# Setup MCP — Configurar Servidores MCP no Kiro

Esta skill configura os MCP servers (playwright, postgres, context7) para
funcionar corretamente quando o Kiro roda no Windows e o Node.js está no WSL.

## Contexto do problema

- O Kiro roda no Windows e spawna processos MCP como processos Windows.
- O Node.js dos devs está instalado via **nvm** dentro do WSL.
- Sem configuração especial, o Kiro não encontra `npx` e todos os servers falham.
- A solução: usar `wsl` como comando + um wrapper script (`scripts/mcp-run.sh`)
  que carrega o nvm antes de executar o npx.

## Pré-requisitos

- WSL com Ubuntu-22.04 instalado
- Node.js instalado via nvm dentro do WSL
- Repositório clonado com `scripts/mcp-run.sh` presente

## Execução — O que o Kiro deve fazer

### 1. Detectar o usuário WSL

```bash
wsl -d Ubuntu-22.04 -- whoami
```

Guardar o resultado como `$WSL_USER`.

### 2. Detectar o usuário Windows

```powershell
$env:USERNAME
```

Guardar o resultado como `$WIN_USER`.

### 3. Verificar que o script wrapper existe

```bash
wsl -d Ubuntu-22.04 -- test -x /home/$WSL_USER/projetos/detran-dti-platform-template/scripts/mcp-run.sh && echo "OK"
```

Se não existir, orientar o dev a fazer `git pull` primeiro.

### 4. Verificar que o nvm funciona via wrapper

```bash
wsl -d Ubuntu-22.04 -- /home/$WSL_USER/projetos/detran-dti-platform-template/scripts/mcp-run.sh npx --version
```

Deve retornar uma versão (ex: `10.8.2`). Se falhar, diagnosticar.

### 5. Gerar e aplicar o mcp.json no user-level Windows

Criar/sobrescrever o arquivo `c:\Users\$WIN_USER\.kiro\settings\mcp.json` com:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "wsl",
      "args": ["-d", "Ubuntu-22.04", "--", "/home/$WSL_USER/projetos/detran-dti-platform-template/scripts/mcp-run.sh", "npx", "@playwright/mcp@latest", "--headless"],
      "disabled": false,
      "autoApprove": [
        "browser_navigate",
        "browser_snapshot",
        "browser_click",
        "browser_type",
        "browser_screenshot",
        "browser_wait_for_text"
      ]
    },
    "postgres": {
      "command": "wsl",
      "args": ["-d", "Ubuntu-22.04", "--", "/home/$WSL_USER/projetos/detran-dti-platform-template/scripts/mcp-run.sh", "npx", "-y", "@modelcontextprotocol/server-postgres", "postgresql://detran:detran_local@localhost:5432/detran"],
      "disabled": false,
      "autoApprove": ["query"]
    },
    "context7": {
      "command": "wsl",
      "args": ["-d", "Ubuntu-22.04", "--", "/home/$WSL_USER/projetos/detran-dti-platform-template/scripts/mcp-run.sh", "npx", "-y", "@upstash/context7-mcp@latest"],
      "disabled": false,
      "autoApprove": ["resolve-library-id", "get-library-docs"]
    }
  }
}
```

**Importante:** substituir `$WSL_USER` pelo valor real detectado no passo 1.

**Importante:** se o arquivo já existir, preservar quaisquer outros servers que
o dev tenha configurado manualmente — apenas adicionar/atualizar playwright,
postgres e context7.

### 6. Orientar o dev a reconectar

Informar:
> Configuração aplicada! Use o command palette → "Reconnect MCP Servers" ou
> clique em Retry no painel MCP Servers. Todos devem ficar verdes.

## Verificação

Após o dev reconectar, perguntar se os 3 servers conectaram:
- playwright → Connected (23 tools)
- postgres → Connected (1 tool)
- context7 → Connected (2 tools)

Se postgres falhar isolado, provavelmente o Docker/banco não está rodando.
Orientar: `docker-compose up -d postgres`.

## O que NÃO fazer

- Não colocar configs MCP no workspace-level (`.kiro/settings/mcp.json` do repo)
  — isso não funciona com paths UNC do WSL.
- Não instalar Node.js no Windows — o padrão é usar tudo via WSL.
- Não usar `bash -ic` nos args (instável com o Kiro).
- Não tentar configurar o prisma MCP server — não existe pacote npm para uso local.

## Troubleshooting

| Sintoma | Causa | Solução |
|---|---|---|
| Todos falham com "Connection closed" | nvm não carregado | Verificar `mcp-run.sh` existe e tem `chmod +x` |
| Postgres falha isolado | Docker parado | `docker-compose up -d postgres` |
| "command not found: wsl" | Kiro aberto no Linux puro | Essa config é só para Windows+WSL |
| npx --version falha no wrapper | nvm não instalado | Rodar skill `/setup-ambiente` primeiro |

## Referências

- Script wrapper: `scripts/mcp-run.sh`
- Config user-level: `c:\Users\<USUARIO>\.kiro\settings\mcp.json`
- Setup completo de ambiente: skill `/setup-ambiente`
