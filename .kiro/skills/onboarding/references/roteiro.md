# Roteiro de Inicialização de Novo Sistema

Guia passo a passo para criar um sistema novo a partir do repositório-template.

> **O Kiro executa automaticamente todas as etapas marcadas como AUTOMÁTICO.**
> O dev só precisa responder perguntas e confirmar quando solicitado.
> Etapas marcadas como REQUER DEV precisam de ação humana (ex.: fornecer passphrase).

---

## Pré-requisitos

Antes de iniciar, o Kiro deve verificar (executando os comandos):

- [ ] Node.js 20+ instalado → `node --version`
- [ ] Docker instalado e daemon rodando → `docker info`
- [ ] `gh` CLI autenticado com protocolo SSH → `gh auth status`
- [ ] Template clonado em `~/projetos/detran-dti-platform-template`
- [ ] Contrato clonado em `~/projetos/detran-contrato-compartilhado`

Se algum pré-requisito falhar, o Kiro deve orientar a acionar `/setup-ambiente`.

---

## Etapa 1 — Criar o repositório (AUTOMÁTICO)

### O que o Kiro faz:

1. Garantir que está no diretório padrão de projetos:
   ```bash
   cd ~/projetos
   ```

2. Perguntar informações do sistema (se ainda não souber):
   - Nome do sistema (validar contra regex `^detran-dti-[a-z0-9]+(-[a-z0-9]+)*$`)
   - Nome do módulo principal
   - Descrição curta
   - Entidades canônicas consumidas

3. Confirmar: "O repositório será `Detran-SP/detran-dti-<sistema>`. Correto?"

4. Executar a criação:
   ```bash
   gh repo create Detran-SP/detran-dti-<sistema> \
     --template Detran-SP/detran-dti-platform-template \
     --private \
     --clone
   cd detran-dti-<sistema>
   ```

   > Se a chave SSH tiver passphrase, o clone vai pedir no terminal (REQUER DEV).

5. Verificar o remote:
   ```bash
   git remote -v
   ```
   Deve mostrar `Detran-SP/detran-dti-<sistema>` (nunca o template).

---

## Etapa 2 — Sincronizar os steerings (AUTOMÁTICO)

### O que o Kiro faz:

1. Executar:
   ```bash
   chmod +x ./scripts/sync-steering.sh
   ./scripts/sync-steering.sh ../detran-contrato-compartilhado
   ```

2. Resultado esperado: lista de 13 steerings com ✓ e mensagem final:
   ```
   Steerings sincronizados em .kiro/steering.
   O arquivo dominio.md NÃO foi sobrescrito (específico deste sistema).
   ```

---

## Etapa 3 — Preencher o domínio (AUTOMÁTICO — Kiro pergunta, dev responde)

### O que o Kiro faz:

1. Abrir `.kiro/steering/dominio.md`
2. Substituir cada `<<...>>` pelas respostas coletadas na Etapa 1
3. Para campos que o dev não souber, preencher com:
   `(A definir pelo dev responsável durante o desenvolvimento.)`
4. Verificar:
   ```bash
   grep -c "<<" .kiro/steering/dominio.md
   ```
   Deve retornar 0 (grep exit code 1 = nenhum match = sucesso).

---

## Etapa 4 — Configurar variáveis de ambiente (AUTOMÁTICO)

### O que o Kiro faz:

1. Copiar o arquivo de exemplo:
   ```bash
   cp .env.example .env
   ```

2. O `.env` já vem com valores funcionais para dev local:
   - `DATABASE_URL`: postgres local (detran/detran_local@localhost:5432)
   - `PORT`: 3000
   - Entra ID: campos vazios

3. Perguntar ao dev se tem Tenant ID e Client ID do Entra.
   Se não tiver, deixar vazio e avisar que login não funcionará.

---

## Etapa 5 — Instalar dependências (AUTOMÁTICO)

### O que o Kiro faz:

```bash
npm install
```

Resultado esperado: `added X packages` sem erros.
Warnings de `npm audit` são normais (não bloqueiam).

---

## Etapa 6 — Subir o PostgreSQL local (AUTOMÁTICO)

### O que o Kiro faz:

```bash
docker-compose up -d postgres
docker-compose ps
```

Resultado esperado: container com status `Up (healthy)`.

Se falhar:
- Erro de permissão → dev precisa fechar e reabrir o WSL (grupo docker)
- Container não sobe → verificar `docker-compose logs postgres --tail=20`

---

## Etapa 7 — Gerar Prisma e aplicar migrações (AUTOMÁTICO)

### O que o Kiro faz:

```bash
npx prisma generate
npx prisma migrate dev --name inicial
```

Resultado esperado:
- `✔ Generated Prisma Client`
- `Your database is now in sync with your schema`

Se erro de conexão: voltar à Etapa 6 (PostgreSQL não está rodando).

---

## Etapa 8 — Verificar build e app rodando (AUTOMÁTICO)

### Build (obrigatório):

```bash
npx nest build --path apps/api/tsconfig.json
cd apps/web && npx vite build && cd ../..
rm -rf apps/web/dist
```

Ambos exit code 0.

### App rodando (validação extra):

**Backend:**
```bash
npm run dev:api
# Esperar: "API rodando na porta 3000"
curl -s http://localhost:3000/<modulo>
# Esperado: []
```

**Frontend:**
```bash
npm run dev:web
# Esperar: "VITE ready"
curl -s http://localhost:5173 | head -5
# Esperado: <!DOCTYPE html>
```

Encerrar processos após validar.

> O build é o critério obrigatório. O teste de app rodando é bônus —
> se o build passou mas o app não sobe, não é bloqueante.

---

## Etapa 9 — Renomear o módulo de exemplo (AUTOMÁTICO)

### O que o Kiro faz:

1. Renomear pasta e arquivos:
   ```
   apps/api/src/app/exemplo/ → apps/api/src/app/<modulo>/
   exemplo.controller.ts    → <modulo>.controller.ts
   exemplo.service.ts       → <modulo>.service.ts
   exemplo.module.ts        → <modulo>.module.ts
   dto/criar-exemplo.dto.ts → dto/criar-<modulo>.dto.ts
   ```

2. Reescrever conteúdo de cada arquivo:
   - Substituir `Exemplo` → `<PascalCase>` em classes
   - Substituir `exemplo` → `<modulo>` em imports/caminhos/rotas
   - Substituir `exemploService` → `<camelCase>Service` em variáveis
   - **Remover todos os comentários `// TODO:`**

3. Atualizar `app.module.ts`:
   - Import: `import { <PascalCase>Module } from "./<modulo>/<modulo>.module";`
   - Array imports: `[<PascalCase>Module]`

4. Verificar build após renomeação:
   ```bash
   npx nest build --path apps/api/tsconfig.json
   ```

### Regras de nomenclatura:
- Arquivos: `kebab-case` (ex.: `criar-ponto.dto.ts`)
- Classes: `PascalCase` (ex.: `CriarPontoDto`)
- Variáveis: `camelCase` (ex.: `pontoService`)
- Rota controller: `kebab-case` (ex.: `@Controller("ponto")`)

---

## Etapa 10 — Commit e push inicial (AUTOMÁTICO + REQUER DEV para passphrase)

### O que o Kiro faz:

```bash
git add -A
git commit -m "chore: inicializa sistema detran-dti-<sistema> a partir do template"
git push -u origin main
```

> Se a chave SSH tiver passphrase, o push pedirá no terminal.
> Para evitar em próximos pushes:
> ```bash
> eval "$(ssh-agent -s)" && ssh-add ~/.ssh/id_ed25519
> ```

---

## Resultado final

Ao concluir todas as etapas, o Kiro informa:

```
✅ Sistema inicializado com sucesso!

   Repositório: https://github.com/Detran-SP/detran-dti-<sistema>
   Módulo:      <modulo> (rota: GET/POST /<modulo>)
   Banco:       PostgreSQL rodando, schema migrado
   Build:       Backend ✅  Frontend ✅

   Próximos passos:
   1. Modele o banco em prisma/schema.prisma com entidades do domínio
   2. Rode: npx prisma migrate dev --name <descricao>
   3. Implemente a lógica no service com PrismaService
   4. Para nova funcionalidade: abra uma Spec session no Kiro
   5. Para deploy: acione /deploy-sistema
```

---

## Resumo — Automático vs. Dev

| Etapa | Quem age | Dev precisa... |
|---|---|---|
| 1. Criar repositório | Kiro | Confirmar nome + fornecer passphrase SSH |
| 2. Sincronizar steerings | Kiro | Nada |
| 3. Preencher domínio | Kiro | Responder perguntas |
| 4. Configurar .env | Kiro | Informar Entra ID (se tiver) |
| 5. npm install | Kiro | Nada |
| 6. Subir PostgreSQL | Kiro | Nada |
| 7. Prisma generate/migrate | Kiro | Nada |
| 8. Verificar build/app | Kiro | Nada |
| 9. Renomear módulo | Kiro | Nada |
| 10. Commit e push | Kiro | Fornecer passphrase SSH |
