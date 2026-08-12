---
name: onboarding
description: Criar repositorio do sistema a partir do template e inicializa-lo ate compilar. Ativa quando o dev menciona "novo sistema", "inicializar", "criar sistema", "comecar projeto", "setup do sistema" ou "onboarding".
metadata:
  author: DTI/DETRAN-SP
  version: 3.1.0
  category: onboarding
---

# Onboarding de Novo Sistema

Esta skill cria um sistema novo a partir do template e o inicializa ate
compilar sem erros. Ativa quando o dev menciona "novo sistema", "inicializar",
"criar sistema", "comecar projeto" ou similar.

## Regras de execução de comandos no WSL (CRITICO — ler antes de executar)

O Kiro roda no Windows e executa comandos no WSL via `wsl -d Ubuntu-22.04 -- bash ...`.
Existem armadilhas que causam falhas silenciosas se ignoradas:

### 1. nvm não está no PATH por padrão

SEMPRE prefixar comandos que usem `node`, `npm` ou `npx` com:
```
wsl -d Ubuntu-22.04 -- bash -lc "source ~/.nvm/nvm.sh && <comando>"
```
Sem isso, `node: command not found`.

### 2. Escrita de arquivos — usar fs_write do Kiro

Para criar ou editar arquivos (.ts, .tsx, .json, .html, .md) no repositório
do sistema, usar EXCLUSIVAMENTE a ferramenta `fs_write` do Kiro com o caminho
UNC do WSL:
```
\\wsl$\Ubuntu-22.04\home\<usuario>\projetos\detran-dti-<sistema>\<caminho>
```

**NUNCA usar:**
- `Set-Content` do PowerShell → corrompe aspas (smart quotes), adiciona BOM,
  insere espaços em strings. Causa erros como `Unterminated string literal`.
- Heredocs (`<< 'EOF'`) via `wsl -- bash -c` → escape de aspas quebra no
  pipeline Windows→cmd→WSL.
- `echo` com aspas complexas → interpolação imprevisível.

**Se `fs_write` falhar** (erro de permissão em diretórios fora do workspace):
usar `printf` com escapes simples:
```bash
wsl -d Ubuntu-22.04 -- bash -c "printf '%s\n' 'linha1' 'linha2' > /caminho/arquivo"
```

### 3. SSH com passphrase pode travar

Operações que usam SSH (clone, push) podem travar se a chave tem passphrase
e o ssh-agent não está rodando. Solução:
- Usar `timeout 30s` em comandos SSH para evitar travamento infinito.
- Se der timeout, informar ao dev:
  > Execute no terminal: `eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519`
  > Depois retorne aqui e tente novamente.

### 4. docker-compose up -d não é long-running

O `docker-compose up -d` retorna imediatamente (modo detached). Pode ser
executado normalmente com `execute_pwsh`. Usar `ignoreWarning: true` se o
sistema alertar sobre long-running.

## Pre-requisitos (verificar antes de comecar)

O Kiro deve executar estes comandos e confirmar que passam:

```bash
node --version         # 20+
docker --version       # instalado
gh auth status         # autenticado, protocolo SSH
```

Se algum falhar, orientar o dev a acionar `/setup-ambiente` primeiro.

## Diretiva de execução contínua (OBRIGATÓRIO)

Após coletar os 4 parâmetros do dev (nome, módulo, descrição, entidades) e
confirmar, executar **TODAS as etapas em sequência sem parar para perguntas
intermediárias**. O Kiro NÃO deve:

- Perguntar se o dev tem valores do Entra ID (deixar vazio por padrão)
- Pedir confirmação entre etapas
- Esperar input do dev após a coleta inicial
- Pausar para mostrar resultados parciais

Se alguma etapa falhar, o Kiro deve **resolver e continuar** automaticamente.
Só pausar e informar o dev se for **impossível prosseguir** (ex.: Docker não
instalado, GitHub inacessível, SSH travou por passphrase).

O objetivo é: **o dev fornece 4 dados, senta e espera ~2 minutos, e recebe
o sistema pronto com os links de validação.**

## As 9 etapas (executar na ordem)

### Etapa 1 — Validar nome e criar repositorio

1. Perguntar ao dev em um unico prompt:

> **Para inicializar o sistema, preciso de:**
> 1. Nome do sistema (ex.: `ponto-digital`, `ferias`, `controle-acesso`)
> 2. Nome do modulo principal da API (ex.: `ponto`, `solicitacao`, `acesso`)
>    Se nao informar, o Kiro deriva do nome do sistema (primeira palavra antes do hifen).
> 3. Descricao curta (1-2 frases): o que o sistema faz e para quem?
> 4. Entidades canonicas que consome do contrato (ex.: Servidor, Departamento — ou "nenhuma")

2. Validar nome contra regex: `^detran-dti-[a-z0-9]+(-[a-z0-9]+)*$`
3. Confirmar: "O repositorio sera `Detran-SP/detran-dti-<sistema>`, modulo `<modulo>`. Correto?"
4. Executar:

```bash
cd ~/projetos
gh repo create Detran-SP/detran-dti-<sistema> \
  --template Detran-SP/detran-dti-platform-template \
  --private \
  --clone
cd detran-dti-<sistema>
```

5. Verificar remote:
```bash
git remote -v
```
Deve mostrar `detran-dti-<sistema>`, NAO o template.

> **Nota:** o `gh repo create --clone` usa SSH automaticamente (configurado no setup-ambiente).
> Se a chave SSH tiver passphrase, o terminal vai pedir — o dev fornece normalmente.
> Usar timeout de 60s. Se travar, pedir ao dev para desbloquear o ssh-agent
> e re-executar.

### Etapa 2 — Sincronizar steerings

```bash
chmod +x ./scripts/sync-steering.sh
./scripts/sync-steering.sh ../detran-contrato-compartilhado
```

Se o contrato nao estiver em `~/projetos/`, clonar primeiro:
```bash
git clone git@github.com:Detran-SP/detran-contrato-compartilhado.git ~/projetos/detran-contrato-compartilhado
```

Resultado esperado: lista de steerings com checkmark (✓) e mensagem final
"Steerings sincronizados em .kiro/steering."

### Etapa 3 — Preencher dominio.md

Usar as respostas ja coletadas na Etapa 1. Perguntar apenas o que faltar:
- Regras de negocio (pode ser "a definir")
- Regra de autorizacao (pode ser "a definir")
- Modulos NestJS previstos (usar o nome do modulo coletado)
- Integracoes (ou "nenhuma prevista")

Substituir todos os `<<...>>` no `.kiro/steering/dominio.md` usando `fs_write`
com o caminho UNC completo do arquivo no novo repositório:
```
\\wsl$\Ubuntu-22.04\home\<usuario>\projetos\detran-dti-<sistema>\.kiro\steering\dominio.md
```

Se o dev nao souber, preencher com "(A definir pelo dev responsavel durante o desenvolvimento.)"

Verificar: `grep -c "<<" .kiro/steering/dominio.md` deve retornar 0.
**Nota:** o bloco de instrucao "Como usar" tambem contem `<<...>>` como exemplo.
Remover ou reescrever esse bloco para eliminar TODOS os `<<`.

### Etapa 4 — Configurar .env

```bash
cp .env.example .env
```

O `.env` vem com valores padrao para desenvolvimento local:
- Banco: `postgresql://detran:detran_local@localhost:5432/detran`
- Porta API: 3001
- `AUTH_MODE=dev` e `DEV_USER=dev@detran.sp.gov.br` (identidade sem token)
- Entra ID: campos vazios (o dev preenche depois quando tiver os valores)
- `PERMISSIONS_DATABASE_URL`: vazio (o dev preenche com a connection string
  somente-leitura do banco do Gestão de Acessos quando disponível)

NAO perguntar ao dev sobre Entra ID ou PERMISSIONS_DATABASE_URL — deixar vazio e seguir.

### Etapa 5 — Instalar dependencias

```bash
source ~/.nvm/nvm.sh
npm install
```

Verificar exit code 0. Warnings de `npm audit` sao normais e nao bloqueiam.
Se falhar com erro de rede ou permissao, resolver antes de continuar.

### Etapa 6 — Subir PostgreSQL

```bash
docker-compose up -d postgres
```

Aguardar alguns segundos e verificar:
```bash
docker-compose ps
```

Confirmar que o container esta com status `Up (healthy)`.
Se nao subiu, verificar logs:
```bash
docker-compose logs postgres --tail=20
```

> **Nota:** se der erro de permissao no Docker, o dev precisa fechar e reabrir
> o terminal WSL (efeito do `usermod -aG docker` do setup-ambiente).

### Etapa 7 — Prisma generate + migrate

```bash
source ~/.nvm/nvm.sh
npx prisma generate
npx prisma migrate dev --name inicial
```

Resultado esperado:
- `generate`: "Generated Prisma Client"
- `migrate`: "Your database is now in sync with your schema"

Se falhar com erro de conexao, verificar se o PostgreSQL esta rodando (Etapa 6).

### Etapa 8 — Verificar build e app rodando

**Build (obrigatorio):**
```bash
source ~/.nvm/nvm.sh
npx nest build --path apps/api/tsconfig.json
cd apps/web && npx vite build && cd ../..
rm -rf apps/web/dist
```

Ambos devem terminar sem erro (exit code 0).

**App rodando (recomendado mas nao bloqueante):**

Iniciar API:
```bash
source ~/.nvm/nvm.sh && npm run dev:api
```

Esperar pela mensagem `API rodando na porta 3001`, depois testar:
```bash
curl -s http://localhost:3001/<modulo>
```

Resultado esperado: `[]` (lista vazia).

Iniciar frontend (em outro terminal):
```bash
source ~/.nvm/nvm.sh && npm run dev:web
```

Esperar pela mensagem `VITE ready`, depois testar:
```bash
curl -s http://localhost:5173 | head -5
```

Resultado esperado: HTML com `<!DOCTYPE html>`.

Encerrar ambos apos validar (Ctrl+C).

> Se o build passou mas o app nao sobe, nao e bloqueante para o onboarding.
> O dev pode investigar depois com `/troubleshooting`.

### Etapa 9 — Renomear modulo de exemplo

Usar o nome do modulo coletado na Etapa 1.

#### 9.1 — Derivar os nomes automaticamente

A partir do nome em `kebab-case`, derivar:
- **Pasta/arquivo:** `<modulo>` (ex.: `ponto`)
- **PascalCase:** `<Modulo>` (ex.: `Ponto`, `ControleAcesso`)
- **camelCase:** `<modulo>` (ex.: `ponto`, `controleAcesso`)

#### 9.2 — Renomear pasta e arquivos

```
apps/api/src/app/exemplo/                    → apps/api/src/app/<modulo>/
apps/api/src/app/<modulo>/exemplo.controller.ts  → <modulo>.controller.ts
apps/api/src/app/<modulo>/exemplo.service.ts     → <modulo>.service.ts
apps/api/src/app/<modulo>/exemplo.module.ts      → <modulo>.module.ts
apps/api/src/app/<modulo>/dto/criar-exemplo.dto.ts → dto/criar-<modulo>.dto.ts
```

#### 9.3 — Reescrever conteudo dos arquivos (sem TODOs)

**IMPORTANTE:** usar `fs_write` do Kiro para escrever cada arquivo abaixo.
O caminho UNC segue o padrao:
```
\\wsl$\Ubuntu-22.04\home\<usuario>\projetos\detran-dti-<sistema>\apps\api\src\app\<modulo>\<arquivo>
```
NUNCA usar heredocs, `Set-Content`, ou `echo` para escrever estes arquivos.

**criar-<modulo>.dto.ts:**
```typescript
import { IsString, IsNotEmpty, MaxLength } from "class-validator";

export class Criar<PascalCase>Dto {
  @IsString()
  @IsNotEmpty({ message: "O nome não pode ser vazio." })
  @MaxLength(150)
  nome!: string;
}
```

**<modulo>.service.ts:**
```typescript
import { Injectable, NotFoundException } from "@nestjs/common";
import { Criar<PascalCase>Dto } from "./dto/criar-<modulo>.dto";

export interface Item<PascalCase> {
  id: string;
  nome: string;
  criadoEm: Date;
}

@Injectable()
export class <PascalCase>Service {
  private readonly itens: Item<PascalCase>[] = [];

  listarTodos(): Item<PascalCase>[] {
    return this.itens;
  }

  buscarPorId(id: string): Item<PascalCase> {
    const item = this.itens.find((i) => i.id === id);
    if (!item) {
      throw new NotFoundException(`Item ${id} não encontrado.`);
    }
    return item;
  }

  criar(dto: Criar<PascalCase>Dto): Item<PascalCase> {
    const novoItem: Item<PascalCase> = {
      id: crypto.randomUUID(),
      nome: dto.nome,
      criadoEm: new Date(),
    };
    this.itens.push(novoItem);
    return novoItem;
  }
}
```

**<modulo>.controller.ts:**
```typescript
import { Controller, Get, Post, Body, Param, UseGuards } from "@nestjs/common";

import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import { UsuarioAtual } from "../auth/usuario-atual.decorator";
import { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";

import { <PascalCase>Service } from "./<modulo>.service";
import { Criar<PascalCase>Dto } from "./dto/criar-<modulo>.dto";

@Controller("<modulo>")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class <PascalCase>Controller {
  constructor(private readonly <camelCase>Service: <PascalCase>Service) {}

  @Get()
  @RequirePermission("<sistema>:<modulo>:listar")
  listarTodos(@UsuarioAtual() usuario: UsuarioAtualInfo) {
    return this.<camelCase>Service.listarTodos();
  }

  @Get(":id")
  @RequirePermission("<sistema>:<modulo>:listar")
  buscarPorId(
    @Param("id") id: string,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ) {
    return this.<camelCase>Service.buscarPorId(id);
  }

  @Post()
  @RequirePermission("<sistema>:<modulo>:criar")
  criar(
    @Body() dto: Criar<PascalCase>Dto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ) {
    return this.<camelCase>Service.criar(dto);
  }
}
```

> **Nota:** `<sistema>` = valor de `SYSTEM_PREFIX` em
> `apps/api/src/app/permissions/parse-identifier.ts` (nome kebab-case do sistema,
> ex.: `controle-ferias`). A ordem dos guards importa: identidade primeiro,
> permissão depois.

**<modulo>.module.ts:**
```typescript
import { Module } from "@nestjs/common";
import { <PascalCase>Controller } from "./<modulo>.controller";
import { <PascalCase>Service } from "./<modulo>.service";

@Module({
  controllers: [<PascalCase>Controller],
  providers: [<PascalCase>Service],
})
export class <PascalCase>Module {}
```

**app.module.ts:**
```typescript
import { Module } from "@nestjs/common";
import { <PascalCase>Module } from "./<modulo>/<modulo>.module";

@Module({
  imports: [
    <PascalCase>Module,
  ],
})
export class AppModule {}
```

#### 9.4 — Verificar build apos renomeacao

```bash
source ~/.nvm/nvm.sh && npx nest build --path apps/api/tsconfig.json
```

Se der erro de import/referencia, corrigir antes de continuar.

#### 9.5 — Verificar build do frontend

As telas do frontend (LoginPage, HomePage, index.html) já vêm prontas no template
com conteúdo genérico da plataforma DTI/DETRAN-SP. NÃO é necessário personalizar
durante o onboarding — são telas de boas-vindas e orientação que servem para
qualquer sistema.

Apenas verificar que o frontend compila:
```bash
source ~/.nvm/nvm.sh && cd apps/web && npx vite build && cd ../..
rm -rf apps/web/dist
```

Se o dev quiser personalizar depois (titulo, descricao especifica), pode usar
a skill `/personalizar-app`.

#### 9.6 — Confirmar ao dev

```
✅ Módulo renomeado: exemplo → <modulo>
   Rota: GET/POST /<modulo>

   Próximo passo: modele o banco em prisma/schema.prisma
```

### Etapa final — Commit, push e subir o app

```bash
git add -A
git commit -m "chore: inicializa sistema detran-dti-<sistema> a partir do template"
git push -u origin main
```

> **Nota:** o push usa SSH. Se a chave tem passphrase e o ssh-agent não está
> desbloqueado, vai travar. Usar timeout de 30s. Se travar:
> - Informar ao dev para executar no terminal:
>   `eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519`
> - Depois re-executar o push.

Apos o push, subir o ambiente automaticamente:

1. Verificar que PostgreSQL esta rodando:
   ```bash
   docker-compose ps
   ```
   Se nao estiver: `docker-compose up -d postgres` e aguardar healthy.

2. Iniciar API em background:
   ```bash
   source ~/.nvm/nvm.sh && npm run dev:api
   ```
   Aguardar ate aparecer: `API rodando na porta 3000`

3. Iniciar frontend em background:
   ```bash
   source ~/.nvm/nvm.sh && npm run dev:web
   ```
   Aguardar ate aparecer: `VITE ready`

4. Validar que esta respondendo:
   ```bash
   curl -s http://localhost:3001/<modulo>   # Esperado: []
   curl -s http://localhost:5173 | head -3  # Esperado: <!DOCTYPE html>
   ```

5. **Apresentar ao dev os links para validacao e instrucao de troca de pasta:**

```
══════════════════════════════════════════════════════════════════
  ✅ Sistema detran-dti-<sistema> inicializado com sucesso!
══════════════════════════════════════════════════════════════════

  📦 Repositório: https://github.com/Detran-SP/detran-dti-<sistema>

  Ambiente local rodando:
  ────────────────────────────────────────────────────────────────
  🗄️  PostgreSQL:  localhost:5432
  🔧 API:         http://localhost:3001/<modulo>
  🌐 Frontend:    http://localhost:5173
  ────────────────────────────────────────────────────────────────

  👉 Valide agora:
     • Abra http://localhost:5173 no browser — deve mostrar a tela
       de boas-vindas com as orientações para o desenvolvedor.
     • Acesse http://localhost:3001/<modulo> — deve retornar [].

  ⚠️  PRÓXIMO PASSO OBRIGATÓRIO — Abrir a pasta do novo sistema:
  ────────────────────────────────────────────────────────────────
  O Kiro está com o template aberto. Para trabalhar no seu sistema,
  abra a pasta correta:

     File → Open Folder → cole este caminho:
     \\wsl$\Ubuntu-22.04\home\<usuario>\projetos\detran-dti-<sistema>

  Após abrir, o Kiro carrega os steerings e skills do novo sistema.
  ────────────────────────────────────────────────────────────────

  Após abrir a pasta correta, inicie o desenvolvimento:
  ────────────────────────────────────────────────────────────────
  1. Abra uma Spec session no Kiro
     Command Palette → Kiro: New Spec Session
  2. Descreva a funcionalidade (regra de negócio) que quer implementar
  3. O Kiro conduz por Requirements → Design → Tasks
  4. Aprove cada etapa e deixe o Kiro executar

  Skills úteis:
     /criar-modulo      — novo módulo de domínio
     /git-flow          — branches e PRs
     /pr-review         — revisão antes de mergear
     /teste-browser     — testar via browser headless
     /dev-start         — subir o ambiente novamente
     /troubleshooting   — quando algo quebrar

══════════════════════════════════════════════════════════════════
```

> **IMPORTANTE:** o Kiro deve SEMPRE apresentar essa mensagem final com os links
> e a instrução de troca de pasta ao concluir o onboarding. Não encerrar sem
> mostrar o caminho UNC da pasta do novo sistema ao dev.

## Criterio de "pronto"

- [ ] Repositorio criado na organizacao Detran-SP
- [ ] Remote aponta para o repo correto (nao o template)
- [ ] Steerings sincronizados (13 arquivos)
- [ ] `dominio.md` sem `<<...>>` restantes
- [ ] `.env` criado a partir do `.env.example`
- [ ] `npm install` sem erros
- [ ] PostgreSQL rodando (container healthy)
- [ ] Prisma migrado (tabelas criadas)
- [ ] Backend compila sem erros (`nest build`)
- [ ] Frontend compila sem erros (`vite build`)
- [ ] API responde em http://localhost:3001/<modulo> (retorna `[]`)
- [ ] Frontend responde em http://localhost:5173 (retorna HTML)
- [ ] Modulo de exemplo renomeado para o dominio real
- [ ] Frontend compila sem erros apos renomeacao
- [ ] Push inicial realizado
- [ ] App rodando localmente (API + frontend)

## O que o Kiro NAO deve deixar passar

- Nome do sistema fora do padrao (`^detran-dti-[a-z0-9]+(-[a-z0-9]+)*$`)
- Remote apontando para o template apos o clone
- `dominio.md` com `<<...>>` restantes
- Build com erros
- Modulo ainda chamado "exemplo" apos a Etapa 9
- Push direto em main sem commit inicial

## Referências

- Roteiro detalhado: [references/roteiro.md](references/roteiro.md)
- Exemplos de nomes: ver skill setup-ambiente → references/exemplos-nomes.md
- Steerings canonicos: `.kiro/steering/`
- Dominio do sistema: `.kiro/steering/dominio.md`
