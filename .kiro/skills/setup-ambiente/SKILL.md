---
name: setup-ambiente
description: Configurar ambiente de desenvolvimento completo no WSL — instalar Git, Node.js, Docker, gh CLI, gerar chave SSH via gh auth, clonar repos base. Ativa quando o dev menciona "configurar ambiente", "instalar git", "primeiro acesso", "setup", "preparar máquina", "nova máquina".
metadata:
  author: DTI/DETRAN-SP
  version: 3.0.0
  category: environment-setup
---

# Setup de Ambiente

Esta skill configura a estacao de desenvolvimento completa no WSL.
Ativa quando o dev menciona "configurar ambiente", "instalar", "primeiro acesso",
"setup", "preparar maquina", "nova maquina" ou similar.

## Como funciona

A skill coleta 3 dados do dev, executa um unico script shell e interpreta o resultado.
O script e idempotente — pode ser executado varias vezes sem efeitos colaterais.

## Dados a coletar (prompt unico)

Perguntar ao dev em um unico prompt:

> **Para configurar sua estacao, preciso de:**
> 1. Seu nome completo (ex.: `Luis Augusto Freire Calixto`)
> 2. Seu e-mail corporativo (ex.: `luis.calixto@detran.sp.gov.br`)
> 3. Seu Personal Access Token (PAT) do GitHub

## Execucao

Apos coletar os dados, executar:

```bash
cd ~/projetos/detran-dti-platform-template
export DEV_NOME="<nome>"
export DEV_EMAIL="<email>"
export DEV_PAT="<pat>"
bash .kiro/skills/setup-ambiente/scripts/setup-ambiente.sh
```

O script executa 7 fases na ordem:
1. Git (instala + configura identidade + credential.helper)
2. GitHub CLI (instala + autentica com PAT via --with-token)
3. SSH (gera chave sem passphrase + registra no GitHub + configura porta 443)
4. Clona repos base (template + contrato compartilhado)
5. Node.js (nvm + v20)
6. Docker (docker.io + docker-compose + grupo docker)
7. Verificacao final (8 checks)

## Notas importantes

- O script usa `sudo` — o dev precisara digitar a senha do WSL quando pedido.
- A chave SSH e gerada **sem passphrase** (menos friccao no dia a dia).
- O SSH e configurado para usar **porta 443** (`ssh.github.com`) por padrao,
  contornando bloqueio da porta 22 na rede corporativa.
- O `appendWindowsPath` e desabilitado no `/etc/wsl.conf` para evitar que
  binarios do Windows (npm global, etc.) interfiram no ambiente Linux.
- Apos o script, o dev deve **reiniciar o WSL** (`wsl --shutdown` no PowerShell
  e reabrir) para que o grupo docker e o wsl.conf tenham efeito.

## O que o Kiro faz apos o script

1. Verificar se o output mostra todos os checks OK
2. Se algum falhou, diagnosticar e orientar
3. Informar ao dev: "Reinicie o WSL e acione /onboarding para criar o sistema"

## O que o Kiro NAO deve fazer

- Montar comandos complexos inline com aspas/$ — o script ja resolve tudo
- Usar fs_write/fs_append para editar arquivos fora do workspace (~/.bashrc, ~/.ssh/)
- Misturar HTTPS e SSH — o padrao e SSH via porta 443 de ponta a ponta

## Referencias

- Script principal: [scripts/setup-ambiente.sh](scripts/setup-ambiente.sh)
- Script de verificacao: [scripts/verificar-ambiente.sh](scripts/verificar-ambiente.sh)
- Exemplos de nomes: [references/exemplos-nomes.md](references/exemplos-nomes.md)
- Apos o setup: skill `onboarding`
