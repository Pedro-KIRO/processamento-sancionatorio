# Guia de Integração — `@detran-sp/shared-contract`

Este guia orienta desenvolvedores da plataforma DETRAN-SP na integração com o pacote `@detran-sp/shared-contract`, que centraliza tipos canônicos, autenticação (Microsoft Entra ID) e tokens de UI. Ao final, você terá o pacote instalado, a autenticação configurada e rotas protegidas funcionando no seu sistema.

---

## 1. Instalação e Configuração do Registry

O pacote `@detran-sp/shared-contract` é publicado no **GitHub Packages** (registry npm privado da organização). Para instalá-lo, você precisa configurar o registry e um token de acesso.

### 1.1 Configurar o `.npmrc`

Crie (ou edite) o arquivo `.npmrc` na raiz do seu projeto com o seguinte conteúdo:

```ini
@detran-sp:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Isso instrui o npm a buscar qualquer pacote com escopo `@detran-sp` no GitHub Packages, usando o token definido na variável de ambiente `GITHUB_TOKEN`.

### 1.2 Obter o `GITHUB_TOKEN`

O `GITHUB_TOKEN` deve ser um **Personal Access Token (classic)** com o scope `read:packages` habilitado.

Para gerar o token:

1. Acesse [github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens).
2. Clique em **Generate new token (classic)**.
3. Marque o scope **`read:packages`**.
4. Gere o token e copie o valor.
5. Defina a variável de ambiente no seu shell ou arquivo `.env`:

```bash
export GITHUB_TOKEN=ghp_SEU_TOKEN_AQUI
```

> ⚠️ **Nunca versione o token no repositório.** Use `.env` local (já incluído no `.gitignore`) ou variáveis de ambiente do sistema/CI.

### 1.3 Instalar o pacote

Com o `.npmrc` configurado e o `GITHUB_TOKEN` disponível no ambiente, execute:

```bash
npm install @detran-sp/shared-contract
```

A instalação deve concluir sem erros e o pacote aparecerá em `node_modules/@detran-sp/shared-contract`.

### 1.4 Troubleshooting — Erro 401 Unauthorized

Se ao executar `npm install` você receber:

```
npm ERR! 401 Unauthorized - GET https://npm.pkg.github.com/@detran-sp%2fshared-contract
```

**Causas comuns:**

| Causa | Ação corretiva |
|-------|----------------|
| Arquivo `.npmrc` ausente ou sem a linha de escopo | Crie o `.npmrc` na raiz do projeto com o conteúdo da seção 1.1 |
| Variável `GITHUB_TOKEN` não definida no ambiente | Exporte a variável (`export GITHUB_TOKEN=...`) ou adicione ao `.env` |
| Token sem o scope `read:packages` | Gere um novo PAT classic com o scope `read:packages` habilitado |
| Token expirado ou revogado | Gere um novo token e atualize a variável de ambiente |

Após corrigir, execute novamente:

```bash
npm install @detran-sp/shared-contract
```

---

## 2. Portal — Login via Entra ID

O Portal é a aplicação principal da plataforma e a **única** que interage diretamente com o Microsoft Entra ID. Ele é responsável por:

1. Realizar o login OIDC do servidor.
2. Obter e renovar access tokens.
3. Distribuir tokens aos sistemas embarcados em iframe via `postMessage`.

### 2.1 Configurar a instância MSAL

Importe `createMsalConfig` do pacote compartilhado para criar a instância `PublicClientApplication`:

```typescript
import { createMsalConfig } from '@detran-sp/shared-contract';

const msalInstance = createMsalConfig({
  clientId: import.meta.env.VITE_AZURE_CLIENT_ID,
  tenantId: import.meta.env.VITE_AZURE_TENANT_ID,
  redirectUri: import.meta.env.VITE_REDIRECT_URI,
});
```

A função configura internamente:
- `authority` apontando para `https://login.microsoftonline.com/{tenantId}`
- Cache em `sessionStorage` (sem cookies)

**Antes de qualquer operação de autenticação**, inicialize a instância:

```typescript
await msalInstance.initialize();
```

A inicialização é necessária para que o MSAL processe redirects pendentes (retorno do Entra ID após login). Faça isso uma única vez na raiz da aplicação (ex.: `main.tsx` ou componente `<App>`).

> ℹ️ **Sobre a chamada manual a `initialize()`:** O hook `useAuth` (seção §2.2) já chama `msalInstance.initialize()` internamente no seu `useEffect`. A chamada manual acima é necessária **apenas** se você usar os helpers MSAL diretamente (ex.: `acquireTokenSilent`, `loginRedirect`) sem passar pelo `useAuth`. Se utilizar `useAuth`, a chamada manual pode ser omitida — chamar duas vezes é seguro (o MSAL ignora inicializações subsequentes), mas desnecessário.

### 2.2 Usar o hook `useAuth`

O hook `useAuth` gerencia todo o estado de autenticação. Importe-o e passe a instância MSAL e os escopos desejados:

```typescript
import { useAuth } from '@detran-sp/shared-contract';

function App() {
  const {
    isAuthenticated,
    isLoading,
    user,
    token,
    error,
    login,
    logout,
  } = useAuth({
    msalInstance,
    scopes: ['api://<CLIENT_ID_DA_API>/.default'],
  });

  if (isLoading) return <Loading />;
  if (!isAuthenticated) return <button onClick={login}>Entrar</button>;

  return (
    <main>
      <p>Bem-vindo, {user?.nome}</p>
      <button onClick={logout}>Sair</button>
    </main>
  );
}
```

#### Parâmetros do hook

| Parâmetro | Tipo | Obrigatório | Descrição |
|-----------|------|:-----------:|-----------|
| `msalInstance` | `PublicClientApplication` | Sim (modo `entra`) | Instância criada por `createMsalConfig` |
| `scopes` | `string[]` | Não | Escopos solicitados na aquisição de token (ex.: `['api://xxx/.default']`) |
| `authMode` | `'simulated' \| 'entra'` | Não | Modo de operação. Default: lido de `VITE_AUTH_MODE` ou `'entra'` |

#### Estado retornado

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `isAuthenticated` | `boolean` | `true` quando há sessão ativa |
| `isLoading` | `boolean` | `true` durante inicialização / verificação |
| `user` | `UsuarioAutenticado \| null` | Dados do usuário (`sub`, `email`, `nome`, `roles`, `tenantId`) |
| `token` | `string \| null` | Access token JWT atual |
| `error` | `Error \| null` | Erro ocorrido durante autenticação |
| `login` | `() => Promise<void>` | Inicia fluxo de login (redirect para Entra ID) |
| `logout` | `() => Promise<void>` | Inicia fluxo de logout |

> ⚠️ **Campo `roles` no objeto `user`:** Em modo `entra` no frontend (Portal), o array `roles` é sempre `[]` — roles são resolvidas exclusivamente no backend via `PortalRolesClient` (seção §3.4). O campo `roles` é preenchido apenas em modo `simulated`, com os valores definidos na variável `VITE_SIMULATED_USER_ROLES`.

#### Modo simulado para desenvolvimento local

Para desenvolver sem depender do Entra ID, configure a variável de build:

```bash
VITE_AUTH_MODE=simulated
```

Ou passe explicitamente no hook:

```typescript
const auth = useAuth({ authMode: 'simulated' });
```

No modo simulado, o hook retorna um usuário fixo e um token simulado sem qualquer chamada de rede. Veja a seção §5 para detalhes completos.

### 2.3 Enviar token para sistemas em iframe via `postMessage`

Após obter o token (campo `token` do hook), o Portal deve enviá-lo aos iframes dos sistemas:

```typescript
const IFRAME_ORIGIN = 'https://sistema.detran.sp.gov.br';

function enviarTokenParaIframe(iframe: HTMLIFrameElement, token: string) {
  iframe.contentWindow?.postMessage(
    { type: 'AUTH_TOKEN', token },
    IFRAME_ORIGIN,
  );
}
```

#### Estrutura da mensagem

```typescript
{ type: 'AUTH_TOKEN', token: '<access_token_jwt>' }
```

- `type`: identificador fixo `'AUTH_TOKEN'` — o iframe usa esse campo para filtrar mensagens relevantes.
- `token`: access token JWT obtido do Entra ID.

> ⚠️ **Segurança:** O segundo argumento de `postMessage` (`targetOrigin`) **deve ser a origem exata** do sistema em iframe (ex.: `'https://sistema.detran.sp.gov.br'`). **Nunca use `'*'`** — isso exporia o token a qualquer janela que intercepte a mensagem.

### 2.4 Fluxo de renovação de token

Tokens do Entra ID expiram (geralmente em 1 hora). Quando o iframe detecta que o token expirou (recebe HTTP 401 do backend), ele envia uma mensagem ao Portal solicitando renovação:

```typescript
// Mensagem enviada pelo iframe ao Portal
window.parent.postMessage({ type: 'TOKEN_EXPIRED' }, PORTAL_ORIGIN);
```

O Portal deve escutar essa mensagem e renovar o token:

```typescript
import { acquireTokenSilent } from '@detran-sp/shared-contract';

const SCOPES = ['api://<CLIENT_ID_DA_API>/.default'];
const IFRAME_ORIGIN = 'https://sistema.detran.sp.gov.br';

window.addEventListener('message', async (event) => {
  // Validar origem
  if (event.origin !== IFRAME_ORIGIN) return;

  // Verificar tipo da mensagem
  if (event.data?.type !== 'TOKEN_EXPIRED') return;

  // Renovar token silenciosamente
  const novoToken = await acquireTokenSilent(msalInstance, SCOPES);

  // Reenviar token ao iframe apenas se obteve token válido
  if (novoToken) {
    const iframe = document.querySelector<HTMLIFrameElement>('#iframe-sistema');
    iframe?.contentWindow?.postMessage(
      { type: 'AUTH_TOKEN', token: novoToken },
      IFRAME_ORIGIN,
    );
  }
});
```

> ⚠️ **Edge case — retorno de string vazia:** `acquireTokenSilent` pode retornar string vazia (`''`) quando o fallback para redirect é necessário (cache expirado, refresh token revogado). O Portal **DEVE verificar** se o token não é vazio antes de enviar via `postMessage` (guard `if (novoToken)` acima). Se o retorno for vazio, não envie a mensagem e aguarde o fluxo de redirect completar — ao retornar, `useAuth` processará o redirect e o token ficará disponível para redistribuição (ver seção §2.5).

O fluxo completo:

1. Iframe recebe HTTP 401 do backend → envia `{ type: 'TOKEN_EXPIRED' }` ao Portal.
2. Portal chama `acquireTokenSilent(msalInstance, scopes)`.
3. Se obtiver novo token → reenvia `{ type: 'AUTH_TOKEN', token }` ao iframe.

### 2.5 Fallback para login interativo

Se `acquireTokenSilent` falhar (cache expirado, refresh token revogado ou sessão do Entra ID encerrada), a função executa automaticamente um **fallback para login interativo via redirecionamento** (`loginRedirect`). Isso recarrega a página do Portal.

Após o redirect de volta ao Portal:

1. O hook `useAuth` processa a resposta do redirect via `msalInstance.handleRedirectPromise()`.
2. O novo token fica disponível no campo `token` do estado.
3. O Portal **redistribui o token** a todos os iframes ativos:

```typescript
function redistribuirTokenAosIframes(token: string) {
  const iframes = document.querySelectorAll<HTMLIFrameElement>('[data-sistema]');

  iframes.forEach((iframe) => {
    const origin = iframe.dataset.origin; // ex.: 'https://sistema.detran.sp.gov.br'
    if (origin) {
      iframe.contentWindow?.postMessage(
        { type: 'AUTH_TOKEN', token },
        origin,
      );
    }
  });
}
```

> ⚠️ **Importante:** Após um redirect, o Portal deve iterar todos os iframes e reenviar o token. Os iframes devem ser resilientes — ao receberem um novo `AUTH_TOKEN`, substituem o token em memória e retomam requisições pendentes.

---

## 3. Backend — Validação de Token (NestJS)

O backend de um sistema **nunca faz login no Entra ID**. O token JWT chega via header `Authorization: Bearer <token>`, enviado pelo frontend (que o recebeu do Portal via `postMessage`). O papel do backend é **validar** esse token e extrair os dados do usuário autenticado.

O pacote `@detran-sp/shared-contract` fornece tudo o que é necessário: módulo de autenticação, guards e decorators prontos para uso.

### 3.1 Registrar o `AuthModule`

Importe `AuthModule` do pacote e registre-o no `AppModule` via `AuthModule.forRoot()`:

```typescript
import { Module } from '@nestjs/common';
import { AuthModule } from '@detran-sp/shared-contract';

@Module({
  imports: [AuthModule.forRoot()],
})
export class AppModule {}
```

O módulo é **global** — uma vez importado no `AppModule`, os guards e providers ficam disponíveis em toda a aplicação sem necessidade de reimportação.

#### Interface `AuthModuleOptions`

`AuthModule.forRoot()` aceita um objeto opcional de configuração. Quando um campo não é informado, o valor é lido da variável de ambiente correspondente:

```typescript
interface AuthModuleOptions {
  /** Modo de autenticação. Default: process.env.AUTH_MODE */
  authMode?: 'simulated' | 'entra';

  /** Tenant ID do Entra ID. Default: process.env.AZURE_TENANT_ID */
  tenantId?: string;

  /** Client ID da aplicação registrada. Default: process.env.AZURE_CLIENT_ID */
  clientId?: string;

  /** URL base da API do portal para consulta de roles. Default: process.env.PORTAL_API_URL */
  portalApiUrl?: string;

  /** TTL do cache de roles em segundos. Default: 300 */
  rolesCacheTtlSeconds?: number;

  /** Chave de assinatura para tokens simulados. Default: process.env.AUTH_SIMULATOR_SIGNING_KEY */
  simulatorSigningKey?: string;

  /** Quando true, rejeita AUTH_MODE=simulated fora de NODE_ENV=development/local/test. Default: false */
  strictEnvironmentCheck?: boolean;
}
```

Exemplo com opções explícitas:

```typescript
AuthModule.forRoot({
  authMode: 'entra',
  tenantId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  clientId: 'yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy',
  portalApiUrl: 'https://portal-api.detran.sp.gov.br',
  rolesCacheTtlSeconds: 600,
  strictEnvironmentCheck: true,
})
```

Na prática, a maioria dos sistemas usa apenas `AuthModule.forRoot()` sem argumentos e configura tudo via variáveis de ambiente (ver seção 3.6).

### 3.2 Proteger rotas com `JwtAuthGuard`

Para exigir autenticação em um endpoint, aplique `@UseGuards(JwtAuthGuard)`:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@detran-sp/shared-contract';

@Controller('meu-recurso')
export class MeuRecursoController {
  @Get()
  @UseGuards(JwtAuthGuard)
  listar() {
    return { dados: [] };
  }
}
```

**Comportamento:**

- O guard extrai o token do header `Authorization: Bearer <token>`.
- Se o header estiver ausente, não iniciar com `Bearer ` ou o token estiver vazio, a requisição é rejeitada com **HTTP 401** e a mensagem `"Token de autenticação não fornecido."`.
- Se o token existir mas for inválido (assinatura incorreta, expirado, audience/issuer incompatível), a requisição também resulta em **HTTP 401**.
- Se o token for válido, o guard popula `request.user` com os dados do `UsuarioAutenticado` e permite o acesso.

### 3.3 Extrair dados do usuário com `@getUsuarioAutenticado()`

Após a validação pelo `JwtAuthGuard`, os dados do usuário ficam disponíveis via decorator de parâmetro:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  getUsuarioAutenticado,
  UsuarioAutenticado,
} from '@detran-sp/shared-contract';

@Controller('perfil')
export class PerfilController {
  @Get()
  @UseGuards(JwtAuthGuard)
  meuPerfil(@getUsuarioAutenticado() usuario: UsuarioAutenticado) {
    return {
      id: usuario.sub,
      email: usuario.email,
      nome: usuario.nome,
      roles: usuario.roles,
      tenant: usuario.tenantId,
    };
  }
}
```

#### Tipo `UsuarioAutenticado`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `sub` | `string` | Object ID do usuário no Entra ID |
| `email` | `string` | E-mail corporativo |
| `nome` | `string` | Nome completo do usuário |
| `roles` | `string[]` | App Roles atribuídas (ex.: `'Sistema.Admin'`, `'Sistema.Usuario'`) |
| `tenantId` | `string` | Tenant ID da organização |

> ⚠️ **Nunca redeclare `UsuarioAutenticado` localmente.** Importe sempre do `@detran-sp/shared-contract` para garantir compatibilidade com o contrato.

### 3.4 Autorização por roles com `RolesGuard` + `@Roles()`

Para restringir acesso a usuários com roles específicas, combine `JwtAuthGuard` com `RolesGuard` e o decorator `@Roles()`:

```typescript
import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
  getUsuarioAutenticado,
  UsuarioAutenticado,
} from '@detran-sp/shared-contract';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminController {
  @Get('dashboard')
  @Roles('Sistema.Admin')
  dashboard(@getUsuarioAutenticado() usuario: UsuarioAutenticado) {
    return { mensagem: `Bem-vindo, ${usuario.nome}` };
  }

  @Get('status')
  // Sem @Roles() — qualquer usuário autenticado acessa
  status() {
    return { status: 'ok' };
  }
}
```

**Comportamento do `RolesGuard`:**

| Cenário | Resultado |
|---------|-----------|
| Endpoint com `@Roles('NomeDaRole')` e usuário **possui** a role | Acesso permitido (HTTP 200) |
| Endpoint com `@Roles('NomeDaRole')` e usuário **não possui** a role | **HTTP 403** — `"Acesso negado. Roles necessárias: NomeDaRole."` |
| Endpoint **sem** `@Roles()` (mesmo com `RolesGuard` ativo) | Acesso permitido sem consulta de roles |

O `RolesGuard` consulta as roles do usuário na **Portal API** (via `PORTAL_API_URL`) e mantém um **cache** configurável (`rolesCacheTtlSeconds`, default 300s) para evitar chamadas repetidas.

> ℹ️ **Ausência intencional do header `Authorization`:** A chamada `GET {portalApiUrl}/usuarios/{sub}/roles` feita pelo `PortalRolesClient` é realizada **sem** header `Authorization` por decisão arquitetural. Trata-se de comunicação service-to-service em rede interna — a Portal API autentica a chamada por mecanismo de rede (VPN/rede privada), não por token Bearer. Se a Portal API for exposta publicamente no futuro, será necessário adicionar autenticação service-to-service (ex.: client credentials OAuth 2.0 ou mTLS).

### 3.5 Modos de autenticação

O `AuthModule` suporta dois modos de operação, controlados pela variável `AUTH_MODE`:

#### Modo `entra` (homologação e produção)

Valida tokens JWT emitidos pelo Microsoft Entra ID. Verifica assinatura via JWKS, audience, issuer e expiração.

```env
AUTH_MODE=entra
AZURE_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_CLIENT_ID=yyyyyyyy-yyyy-yyyy-yyyy-yyyyyyyyyyyy
PORTAL_API_URL=https://portal-api.detran.sp.gov.br
```

#### Modo `simulated` (desenvolvimento local)

Valida tokens assinados com uma chave simétrica local (HS256). Não depende do Entra ID nem do Portal para autenticação — ideal para desenvolvimento sem infraestrutura externa.

```env
AUTH_MODE=simulated
AUTH_SIMULATOR_SIGNING_KEY=minha-chave-secreta-de-dev
PORTAL_API_URL=http://localhost:3000
```

> ⚠️ **O modo `simulated` é exclusivo para desenvolvimento local** (`NODE_ENV=development`, `local` ou `test`). Nunca use em homologação ou produção.

#### Restrição de ambiente (`strictEnvironmentCheck`)

Quando `strictEnvironmentCheck: true` está configurado no `AuthModule.forRoot()`, o módulo **lança uma exceção e impede a inicialização** se `AUTH_MODE=simulated` for usado fora dos ambientes permitidos (development, local, test):

```
Error: AUTH_MODE=simulated não é permitido em ambiente production.
Configure AUTH_MODE=entra para homologação e produção.
```

Com `strictEnvironmentCheck: false` (default), o módulo apenas emite um **warning** no log, mas permite a inicialização.

### 3.6 Variáveis de ambiente por modo

| Variável | Modo `entra` | Modo `simulated` | Descrição |
|----------|:------------:|:----------------:|-----------|
| `AUTH_MODE` | **obrigatória** (`entra`) | **obrigatória** (`simulated`) | Define qual validador de token será usado |
| `AZURE_TENANT_ID` | **obrigatória** | não usada | Tenant ID do Entra ID |
| `AZURE_CLIENT_ID` | **obrigatória** | não usada | Client ID da aplicação registrada |
| `PORTAL_API_URL` | **obrigatória** | **obrigatória** | URL base da API do Portal (consulta de roles) |
| `AUTH_SIMULATOR_SIGNING_KEY` | não usada | **obrigatória** | Chave para assinatura/validação de tokens simulados (HS256) |

### 3.7 Resumo do fluxo

```
Frontend (iframe)                          Backend (NestJS)
     │                                          │
     │  GET /api/recurso                        │
     │  Authorization: Bearer <token>           │
     │─────────────────────────────────────────►│
     │                                          │── JwtAuthGuard extrai e valida token
     │                                          │── Popula request.user (UsuarioAutenticado)
     │                                          │── RolesGuard verifica @Roles() (se houver)
     │                                          │
     │  200 OK / 401 / 403                      │
     │◄─────────────────────────────────────────│
```

O backend **nunca inicia um fluxo de login**. Sua responsabilidade é exclusivamente **validar** o token que chega no header e **autorizar** o acesso com base nas roles do usuário.


---

## 4. Frontend — React no Iframe

O frontend de um sistema embarcado em iframe **não instala nem usa MSAL**. Toda a autenticação com o Entra ID é responsabilidade exclusiva do Portal (seção §2). O frontend do sistema recebe o token **pronto** via `postMessage` e o utiliza para se comunicar com seu backend.

### 4.1 Receber o token via `postMessage`

O Portal envia o token assim que o iframe carrega (e a cada renovação). O frontend deve escutar o evento `message` e validar a origem:

```typescript
const PORTAL_ORIGIN = import.meta.env.VITE_PORTAL_ORIGIN;
// ex.: 'https://portal.detran.sp.gov.br'

window.addEventListener('message', (event) => {
  // 1. Validar a origem — descartar mensagens de origens desconhecidas
  if (event.origin !== PORTAL_ORIGIN) return;

  // 2. Verificar o tipo da mensagem
  if (event.data?.type !== 'AUTH_TOKEN') return;

  // 3. Extrair e armazenar o token
  const token = event.data.token;
  setToken(token); // atualiza estado (ver seção 4.2)
});
```

**Regras de validação:**

| Verificação | Motivo |
|-------------|--------|
| `event.origin !== PORTAL_ORIGIN` | Garante que apenas mensagens do Portal sejam aceitas — protege contra injeção de token por terceiros |
| `event.data?.type !== 'AUTH_TOKEN'` | Filtra apenas mensagens de token, ignorando outros eventos postMessage que possam transitar na janela |

> ⚠️ **Nunca omita a validação de `event.origin`.** Sem ela, qualquer página aberta na mesma janela poderia injetar um token malicioso no seu sistema.

### 4.2 Armazenamento do token — somente em memória

O token recebido deve ser armazenado **exclusivamente em memória** — nunca em `localStorage` ou `sessionStorage`. Isso minimiza a superfície de ataque contra XSS: se o token não está persistido no storage do navegador, um script injetado não consegue extraí-lo facilmente.

#### Exemplo com React state

```typescript
import { useState, useEffect, useCallback } from 'react';

const PORTAL_ORIGIN = import.meta.env.VITE_PORTAL_ORIGIN;

export function usePortalToken() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== PORTAL_ORIGIN) return;
      if (event.data?.type !== 'AUTH_TOKEN') return;

      setToken(event.data.token);
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return token;
}
```

> ℹ️ **`usePortalToken()` é um exemplo de implementação local.** Este hook **NÃO é exportado** pelo pacote `@detran-sp/shared-contract` — você deve criá-lo no projeto do seu sistema. O hook `useAuth` (seção §2.2) é para uso exclusivo no Portal; sistemas embarcados em iframe devem implementar `usePortalToken()` (ou equivalente) localmente para receber o token via `postMessage`.

#### Exemplo com variável de módulo (fora de React)

```typescript
// auth-state.ts
const PORTAL_ORIGIN = import.meta.env.VITE_PORTAL_ORIGIN;

let currentToken: string | null = null;

export function getToken(): string | null {
  return currentToken;
}

export function initTokenListener() {
  window.addEventListener('message', (event) => {
    if (event.origin !== PORTAL_ORIGIN) return;
    if (event.data?.type !== 'AUTH_TOKEN') return;

    currentToken = event.data.token;
  });
}
```

> ⚠️ **Nunca armazene o token em `localStorage` ou `sessionStorage`.** Esses mecanismos são acessíveis por qualquer script executando na mesma origem, ampliando o impacto de vulnerabilidades XSS.

### 4.3 Enviar token ao backend

Todas as chamadas autenticadas ao backend devem incluir o token no header `Authorization`:

```typescript
async function fetchComAuth(url: string, options: RequestInit = {}) {
  const token = getToken(); // ou use o valor do hook usePortalToken()

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  return response;
}
```

O backend (seção §3) espera o header no formato exato `Authorization: Bearer <token>`. Requisições sem esse header ou com token inválido resultam em HTTP 401.

### 4.4 Detectar token expirado e solicitar renovação

Quando o backend retorna **HTTP 401**, significa que o token está expirado ou inválido. O frontend deve solicitar ao Portal um novo token via `postMessage`:

```typescript
const PORTAL_ORIGIN = import.meta.env.VITE_PORTAL_ORIGIN;

async function fetchComAuth(url: string, options: RequestInit = {}) {
  const token = getToken();

  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.status === 401) {
    // Solicitar renovação ao Portal
    window.parent.postMessage({ type: 'TOKEN_EXPIRED' }, PORTAL_ORIGIN);

    // Aguardar novo token antes de retentar
    const novoToken = await aguardarNovoToken();
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${novoToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  return response;
}
```

#### Aguardar novo token

Após solicitar renovação, o frontend deve aguardar o Portal reenviar o token via `postMessage` antes de retentar a requisição:

```typescript
function aguardarNovoToken(): Promise<string> {
  return new Promise((resolve) => {
    function handler(event: MessageEvent) {
      if (event.origin !== PORTAL_ORIGIN) return;
      if (event.data?.type !== 'AUTH_TOKEN') return;

      window.removeEventListener('message', handler);
      resolve(event.data.token);
    }

    window.addEventListener('message', handler);
  });
}
```

**Fluxo de renovação completo:**

```
Frontend (iframe)          Portal              Entra ID
     │                       │                    │
     │── 401 do backend ──►  │                    │
     │  postMessage          │                    │
     │  { type:              │                    │
     │    'TOKEN_EXPIRED' }  │                    │
     │──────────────────────►│                    │
     │                       │── acquireTokenSilent
     │                       │───────────────────►│
     │                       │◄───────────────────│
     │                       │  novo access token │
     │◄──────────────────────│                    │
     │  postMessage          │                    │
     │  { type: 'AUTH_TOKEN',│                    │
     │    token: novo }      │                    │
     │                       │                    │
     │── retenta requisição  │                    │
     │   com novo token      │                    │
```

> ⚠️ **Retenha requisições pendentes enquanto aguarda o novo token.** Não dispare múltiplas mensagens `TOKEN_EXPIRED` em sequência — envie uma única solicitação e aguarde a resposta.

### 4.5 Estado de carregamento (aguardando primeiro token)

Quando o iframe é carregado, o frontend ainda não possui token. Nesse estado, o sistema **não deve fazer chamadas autenticadas ao backend** — elas falhariam com 401.

Exiba um indicador de carregamento até receber o primeiro token do Portal:

```typescript
import { usePortalToken } from './usePortalToken';

function App() {
  const token = usePortalToken();

  // Enquanto não receber o primeiro token, exibir loading
  if (!token) {
    return (
      <div className="loading-container">
        <p>Aguardando autenticação do Portal...</p>
      </div>
    );
  }

  // Token disponível — renderizar a aplicação normalmente
  return <MainApp />;
}
```

**Regras para o estado de carregamento:**

| Situação | Comportamento correto |
|----------|----------------------|
| Token ainda não recebido (`null`) | Exibir loading, bloquear chamadas ao backend |
| Primeiro token recebido | Renderizar aplicação, liberar chamadas ao backend |
| Token renovado (recebido após expiração) | Substituir token em memória, retentar requisições pendentes |

### 4.6 Resumo — Estrutura das mensagens `postMessage`

| Direção | Mensagem | Descrição |
|---------|----------|-----------|
| Portal → Iframe | `{ type: 'AUTH_TOKEN', token: '<jwt>' }` | Token de acesso (envio inicial e renovações) |
| Iframe → Portal | `{ type: 'TOKEN_EXPIRED' }` | Solicitação de renovação de token |

### 4.7 Checklist de implementação

- [ ] Registrar listener de `message` com validação de `event.origin`
- [ ] Filtrar mensagens pelo campo `type === 'AUTH_TOKEN'`
- [ ] Armazenar token em estado React ou variável de módulo (nunca storage)
- [ ] Enviar `Authorization: Bearer <token>` em toda chamada ao backend
- [ ] Interceptar HTTP 401 e enviar `{ type: 'TOKEN_EXPIRED' }` ao Portal
- [ ] Aguardar novo token antes de retentar requisições
- [ ] Exibir estado de carregamento enquanto `token === null`
- [ ] **Não** instalar ou importar `@azure/msal-browser` no projeto do sistema


---

## 5. Modo Simulador — Desenvolvimento Local

> ⚠️ **O modo simulador é exclusivo para desenvolvimento local.** Nunca ative `AUTH_MODE=simulated` em ambientes de homologação ou produção. A opção `strictEnvironmentCheck: true` no `AuthModule.forRoot()` bloqueia a inicialização caso essa regra seja violada.

O simulador permite desenvolver e testar sem depender do Portal ou do Microsoft Entra ID. Ele gera tokens JWT assinados localmente (HS256) que são aceitos pelo mesmo `JwtAuthGuard` usado em produção — a diferença é apenas a chave de assinatura e o algoritmo.

### 5.1 Ativação no backend (NestJS)

Configure as seguintes variáveis de ambiente no `.env` do backend:

```env
AUTH_MODE=simulated
AUTH_SIMULATOR_SIGNING_KEY=minha-chave-secreta-qualquer
PORTAL_API_URL=http://localhost:3000
```

| Variável | Descrição |
|----------|-----------|
| `AUTH_MODE=simulated` | Ativa o modo simulador no `AuthModule` |
| `AUTH_SIMULATOR_SIGNING_KEY` | String arbitrária usada para assinar e validar tokens JWT locais (algoritmo HS256). Pode ser qualquer valor — ex.: `dev-secret-123` |
| `PORTAL_API_URL` | URL base da API do Portal (obrigatória em qualquer modo). Em dev local, aponte para o endereço local do portal ou use um placeholder funcional |

Ao iniciar o backend em modo simulado, o `AuthModule` registra automaticamente o controller do simulador e emite o seguinte warning no console:

```
[AuthSimulatorController] Auth Simulator endpoint ativo. Este endpoint deve ser usado APENAS em desenvolvimento local.
```

### 5.2 Endpoint `POST /auth/simulator/token`

Quando o modo simulador está ativo, o `AuthModule` expõe automaticamente o endpoint para geração de tokens:

```
POST /auth/simulator/token
Content-Type: application/json
```

#### Body (opcional)

O body é opcional. Se omitido (ou enviado vazio), o endpoint retorna um token com valores padrão. Você pode personalizar qualquer claim:

```typescript
interface SimulatorClaims {
  sub: string;            // Identificador do usuário
  email: string;          // E-mail corporativo
  nome: string;           // Nome completo
  roles: string[];        // Roles atribuídas
  tenantId: string;       // Tenant ID da organização
  expiresInSeconds?: number; // Tempo de expiração em segundos
}
```

#### Valores padrão (quando body é omitido)

| Claim | Valor padrão |
|-------|-------------|
| `sub` | `simulated-user-001` |
| `email` | `dev@detran.sp.gov.br` |
| `nome` | `Usuário Simulado` |
| `roles` | `['Sistema.Usuario']` |
| `tenantId` | `simulated-tenant-id` |
| `expiresInSeconds` | `3600` (1 hora) |

#### Exemplos de uso

**Gerar token com valores padrão:**

```bash
curl -X POST http://localhost:3000/auth/simulator/token
```

**Gerar token com claims personalizadas:**

```bash
curl -X POST http://localhost:3000/auth/simulator/token \
  -H "Content-Type: application/json" \
  -d '{
    "sub": "meu-usuario-teste",
    "email": "teste@detran.sp.gov.br",
    "nome": "Usuário de Teste",
    "roles": ["Sistema.Admin", "Sistema.Usuario"],
    "tenantId": "meu-tenant",
    "expiresInSeconds": 7200
  }'
```

#### Estrutura da resposta

```json
{
  "access_token": "<jwt_assinado_hs256>",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `access_token` | `string` | Token JWT assinado com a `AUTH_SIMULATOR_SIGNING_KEY` via HS256 |
| `token_type` | `string` | Sempre `"Bearer"` — compatível com o formato OAuth2 |
| `expires_in` | `number` | Tempo até expiração em segundos |

O token retornado pode ser usado diretamente no header `Authorization: Bearer <access_token>` para chamar rotas protegidas com `@UseGuards(JwtAuthGuard)`.

### 5.3 Ativação no frontend (React)

Para que o hook `useAuth` opere em modo simulado (sem depender do MSAL ou do Portal), configure a variável de build:

```env
VITE_AUTH_MODE=simulated
```

Com essa variável definida, o hook retorna automaticamente um usuário simulado e um token fixo, sem realizar chamadas de rede.

#### Variáveis opcionais para personalizar o usuário simulado

| Variável | Descrição | Valor padrão |
|----------|-----------|-------------|
| `VITE_SIMULATED_USER_SUB` | Identificador do usuário | `simulated-user-001` |
| `VITE_SIMULATED_USER_EMAIL` | E-mail corporativo | `dev@detran.sp.gov.br` |
| `VITE_SIMULATED_USER_NOME` | Nome completo | `Usuário Simulado` |
| `VITE_SIMULATED_USER_ROLES` | Roles (separadas por vírgula) | `Sistema.Usuario` |
| `VITE_SIMULATED_USER_TENANT_ID` | Tenant ID da organização | `simulated-tenant-id` |

#### Exemplo de `.env` para frontend em modo simulador

```env
VITE_AUTH_MODE=simulated
VITE_SIMULATED_USER_SUB=dev-001
VITE_SIMULATED_USER_EMAIL=dev@detran.sp.gov.br
VITE_SIMULATED_USER_NOME=Dev Local
VITE_SIMULATED_USER_ROLES=Sistema.Admin,Sistema.Usuario
VITE_SIMULATED_USER_TENANT_ID=tenant-dev
```

#### Uso no código

Não há mudança no código — o hook `useAuth` detecta o modo automaticamente:

```typescript
import { useAuth } from '@detran-sp/shared-contract';

function App() {
  const { isAuthenticated, user, token } = useAuth();
  // Em modo simulated: isAuthenticated=true, user preenchido, token fixo
}
```

Ou passe explicitamente:

```typescript
const auth = useAuth({ authMode: 'simulated' });
```

### 5.4 Quando usar o simulador

| Cenário | Usar simulador? |
|---------|:--------------:|
| Desenvolvimento local (backend + frontend) | ✅ Sim |
| Testes de integração em CI | ✅ Sim |
| Homologação | ❌ Não — use `AUTH_MODE=entra` |
| Produção | ❌ Não — use `AUTH_MODE=entra` |

> ⚠️ **Em homologação e produção, sempre use `AUTH_MODE=entra` com tokens reais do Microsoft Entra ID.** O modo simulador não valida identidade real e não deve ser exposto a ambientes acessíveis externamente.


---

## 6. Variáveis de Ambiente — Referência Consolidada

Esta seção reúne **todas** as variáveis de ambiente utilizadas pela plataforma de autenticação, separadas por contexto (backend / frontend) e organizadas em obrigatórias e opcionais.

### 6.1 Variáveis obrigatórias

As variáveis abaixo são exigidas para o funcionamento da autenticação. A coluna **Condição** indica em qual modo (`entra`, `simulated` ou ambos) a variável é requerida.

| Variável | Descrição | Valores aceitos | Condição | Contexto |
|----------|-----------|-----------------|----------|----------|
| `AUTH_MODE` | Define o modo de validação de tokens JWT | `simulated` \| `entra` | Sempre | Backend |
| `AZURE_TENANT_ID` | Tenant ID da organização no Microsoft Entra ID | UUID (formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) | Apenas `AUTH_MODE=entra` | Backend |
| `AZURE_CLIENT_ID` | Client ID da aplicação registrada no Entra ID | UUID | Apenas `AUTH_MODE=entra` | Backend |
| `PORTAL_API_URL` | URL base da API do Portal (consulta de roles) | URL válida (ex.: `https://portal-api.detran.sp.gov.br`) | Sempre (ambos os modos) | Backend |
| `AUTH_SIMULATOR_SIGNING_KEY` | Chave simétrica (HS256) para assinar/validar tokens simulados | String arbitrária (mín. recomendado: 32 caracteres) | Apenas `AUTH_MODE=simulated` | Backend |
| `VITE_AZURE_CLIENT_ID` | Client ID da aplicação (Portal) para configuração MSAL | UUID | Sempre (Portal) | Frontend |
| `VITE_AZURE_TENANT_ID` | Tenant ID da organização para configuração MSAL | UUID | Sempre (Portal) | Frontend |
| `VITE_REDIRECT_URI` | URI de redirecionamento após login no Entra ID | URL válida (ex.: `http://localhost:5173`) | Sempre (Portal) | Frontend |

### 6.2 Variáveis opcionais

As variáveis abaixo possuem valor padrão e só precisam ser definidas se você quiser sobrescrever o comportamento default.

| Variável | Descrição | Valores aceitos | Valor padrão | Contexto |
|----------|-----------|-----------------|--------------|----------|
| `VITE_AUTH_MODE` | Modo de autenticação do frontend (hook `useAuth`) | `simulated` \| `entra` | `entra` | Frontend |
| `VITE_SIMULATED_USER_SUB` | Identificador do usuário simulado | String | `simulated-user-001` | Frontend |
| `VITE_SIMULATED_USER_EMAIL` | E-mail do usuário simulado | String (e-mail) | `dev@detran.sp.gov.br` | Frontend |
| `VITE_SIMULATED_USER_NOME` | Nome completo do usuário simulado | String | `Usuário Simulado` | Frontend |
| `VITE_SIMULATED_USER_ROLES` | Roles do usuário simulado (separadas por vírgula) | String (lista CSV) | `Sistema.Usuario` | Frontend |
| `VITE_SIMULATED_USER_TENANT_ID` | Tenant ID do usuário simulado | String | `simulated-tenant-id` | Frontend |
| `rolesCacheTtlSeconds` | TTL do cache de roles no backend (opção de `AuthModule.forRoot()`) | Número inteiro (segundos) | `300` | Backend (código) |

### 6.3 Exemplo `.env` — Desenvolvimento local (modo simulador)

Este arquivo é funcional para desenvolvimento local sem dependência do Entra ID ou Portal real:

```env
# ─── Backend ───────────────────────────────────────────────
AUTH_MODE=simulated
AUTH_SIMULATOR_SIGNING_KEY=chave-secreta-desenvolvimento-local
PORTAL_API_URL=http://localhost:3000

# ─── Frontend ──────────────────────────────────────────────
VITE_AUTH_MODE=simulated
VITE_AZURE_CLIENT_ID=00000000-0000-0000-0000-000000000000
VITE_AZURE_TENANT_ID=00000000-0000-0000-0000-000000000000
VITE_REDIRECT_URI=http://localhost:5173

# Personalizações opcionais do usuário simulado (valores padrão já funcionam)
# VITE_SIMULATED_USER_SUB=simulated-user-001
# VITE_SIMULATED_USER_EMAIL=dev@detran.sp.gov.br
# VITE_SIMULATED_USER_NOME=Usuário Simulado
# VITE_SIMULATED_USER_ROLES=Sistema.Usuario
# VITE_SIMULATED_USER_TENANT_ID=simulated-tenant-id
```

> ⚠️ **Este `.env` é para uso exclusivo em desenvolvimento local.** Nunca utilize `AUTH_MODE=simulated` em homologação ou produção.

### 6.4 Exemplo `.env` — Homologação / Produção (Entra ID real)

Substitua os placeholders `<...>` pelos valores reais do seu ambiente:

```env
# ─── Backend ───────────────────────────────────────────────
AUTH_MODE=entra
AZURE_TENANT_ID=<TENANT_ID_DA_ORGANIZACAO>
AZURE_CLIENT_ID=<CLIENT_ID_DA_APLICACAO_REGISTRADA>
PORTAL_API_URL=<URL_BASE_DA_API_DO_PORTAL>

# ─── Frontend ──────────────────────────────────────────────
VITE_AZURE_CLIENT_ID=<CLIENT_ID_DA_APLICACAO_REGISTRADA>
VITE_AZURE_TENANT_ID=<TENANT_ID_DA_ORGANIZACAO>
VITE_REDIRECT_URI=<URL_DE_REDIRECT_APOS_LOGIN>
```

**Onde obter os valores:**

| Placeholder | Onde encontrar |
|-------------|----------------|
| `<TENANT_ID_DA_ORGANIZACAO>` | Azure Portal → Microsoft Entra ID → Visão geral → Tenant ID |
| `<CLIENT_ID_DA_APLICACAO_REGISTRADA>` | Azure Portal → App Registrations → sua aplicação → Application (client) ID |
| `<URL_BASE_DA_API_DO_PORTAL>` | URL onde a API do Portal está hospedada (ex.: `https://portal-api.detran.sp.gov.br`) |
| `<URL_DE_REDIRECT_APOS_LOGIN>` | URL registrada como Redirect URI na App Registration (ex.: `https://portal.detran.sp.gov.br`) |

> ⚠️ **Nunca versione o arquivo `.env` com valores reais.** Mantenha um `.env.example` com placeholders no repositório e configure os valores reais apenas no ambiente de deploy ou via secrets do CI/CD.


---

## 7. Checklist de Validação — Modo Simulador

> ⚠️ **Esta checklist valida apenas o modo simulador local (`AUTH_MODE=simulated`).** A validação em ambiente de homologação ou produção requer um token real emitido pelo Portal via Microsoft Entra ID — o fluxo é diferente e depende de infraestrutura externa configurada.

Siga os passos abaixo **na ordem apresentada** para confirmar que a integração com o `@detran-sp/shared-contract` está funcionando corretamente no seu ambiente de desenvolvimento local.

### 7.1 Instalar o pacote

```bash
npm install @detran-sp/shared-contract
```

**Resultado esperado:** instalação concluída sem erros. O pacote aparece em `node_modules/@detran-sp/shared-contract`.

Se ocorrer erro 401, revise a seção §1 (configuração do `.npmrc` e `GITHUB_TOKEN`).

### 7.2 Configurar variáveis de ambiente

Crie (ou atualize) o arquivo `.env` na raiz do backend com as variáveis para modo simulador:

```env
AUTH_MODE=simulated
AUTH_SIMULATOR_SIGNING_KEY=chave-secreta-desenvolvimento-local
PORTAL_API_URL=http://localhost:3000
```

Consulte a seção §6 para a referência completa de variáveis.

### 7.3 Subir o backend NestJS

Inicie a aplicação backend:

```bash
npm run start:dev
```

**Resultado esperado:** o servidor inicia sem erros. Confirme no log a mensagem:

```
[AuthSimulatorController] Auth Simulator endpoint ativo. Este endpoint deve ser usado APENAS em desenvolvimento local.
```

Se essa mensagem **não** aparecer, verifique se `AUTH_MODE=simulated` está definido corretamente no `.env`.

### 7.4 Gerar token via simulador

Com o backend rodando, gere um token de teste:

```bash
curl -s -X POST http://localhost:3000/auth/simulator/token | json_pp
```

**Resultado esperado:** resposta JSON com a estrutura:

```json
{
  "access_token": "<jwt_assinado>",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Copie o valor de `access_token` para usar nos próximos passos.

### 7.5 Chamar rota protegida com token válido

Envie uma requisição a qualquer rota protegida com `@UseGuards(JwtAuthGuard)`, passando o token no header:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer <TOKEN_OBTIDO_NO_PASSO_ANTERIOR>" \
  http://localhost:3000/sua-rota-protegida
```

**Resultado esperado:** HTTP **200** (ou o status de sucesso da rota). Se receber 401, verifique se o token foi copiado corretamente e se a `AUTH_SIMULATOR_SIGNING_KEY` é a mesma nos passos 7.2 e 7.4.

### 7.6 Validação negativa — rota sem header `Authorization`

```bash
curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/sua-rota-protegida
```

**Resultado esperado:** HTTP **401** — o guard rejeita requisições sem token.

### 7.7 Validação negativa — rota com token inválido

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer token-invalido-qualquer" \
  http://localhost:3000/sua-rota-protegida
```

**Resultado esperado:** HTTP **401** — o guard rejeita tokens com assinatura inválida.

### 7.8 Verificar publicação do pacote no registry

Para confirmar que o pacote está publicado e acessível no GitHub Packages:

```bash
npm view @detran-sp/shared-contract --registry=https://npm.pkg.github.com
```

**Resultado esperado:** exibe informações do pacote (nome, versão, descrição). Se retornar erro 404 ou 401, revise as credenciais de acesso ao registry (seção §1).

### Resumo da checklist

| # | Passo | Resultado esperado |
|---|-------|--------------------|
| 1 | `npm install @detran-sp/shared-contract` | Sem erros |
| 2 | Configurar `.env` com `AUTH_MODE=simulated` | Arquivo criado |
| 3 | Iniciar backend (`npm run start:dev`) | Log "Auth Simulator endpoint ativo" |
| 4 | `POST /auth/simulator/token` | JSON com `access_token` |
| 5 | Rota protegida com token válido | HTTP 200 |
| 6 | Rota protegida sem header `Authorization` | HTTP 401 |
| 7 | Rota protegida com token inválido | HTTP 401 |
| 8 | `npm view` no registry | Versão do pacote exibida |

> ⚠️ **Próximo passo após a checklist:** se todos os itens passaram, sua integração local está funcional. Para testar em homologação, configure `AUTH_MODE=entra` com as credenciais reais do Entra ID (seção §6.4) e obtenha um token válido através do fluxo de login do Portal.

---

## 8. Diagrama de Fluxo de Autenticação

O diagrama abaixo representa o fluxo completo de autenticação na plataforma, desde o login do Portal no Entra ID até a validação do token no backend de um sistema. Ele mostra como os quatro participantes se comunicam e evidencia que **sistemas nunca acessam o Entra ID diretamente** — o token sempre é intermediado pelo Portal.

```mermaid
sequenceDiagram
    participant Portal
    participant EntraID as Entra ID
    participant Iframe as Frontend Sistema (iframe)
    participant Backend as Backend Sistema

    Portal->>EntraID: Login OIDC (redirect)
    EntraID-->>Portal: Access Token (JWT)
    Portal->>Iframe: postMessage({ type: 'AUTH_TOKEN', token })
    Note over Iframe: Sistemas NUNCA acessam<br/>Entra ID diretamente
    Iframe->>Backend: GET /api/recurso<br/>Authorization: Bearer <token>
    Backend->>Backend: JwtAuthGuard valida token
    alt Token válido
        Backend-->>Iframe: 200 OK (dados)
    else Token inválido ou ausente
        Backend-->>Iframe: 401 Unauthorized
    end
    Iframe->>Portal: postMessage({ type: 'TOKEN_EXPIRED' })
    Portal->>EntraID: acquireTokenSilent
    EntraID-->>Portal: Novo Access Token
    Portal->>Iframe: postMessage({ type: 'AUTH_TOKEN', token: novo })
```

### Pontos-chave do fluxo

| Etapa | Descrição |
|-------|-----------|
| **Login OIDC** | O Portal é o único que interage com o Entra ID. O login ocorre via redirect e o Entra ID retorna um access token JWT. |
| **Distribuição via postMessage** | O Portal envia o token ao iframe do sistema usando `postMessage` com `targetOrigin` específica (nunca `'*'`). |
| **Validação no backend** | O frontend do sistema envia o token no header `Authorization: Bearer` e o `JwtAuthGuard` valida assinatura, audience, issuer e expiração. |
| **Caminho de falha** | Se o token for inválido ou ausente, o backend retorna HTTP 401. O frontend detecta a falha e solicita renovação ao Portal. |
| **Renovação** | O Portal invoca `acquireTokenSilent` no Entra ID e reenvia o novo token ao iframe. O ciclo se repete sem intervenção do usuário. |

> ⚠️ **Princípio fundamental:** Sistemas (frontend e backend) nunca acessam o Entra ID diretamente. O Portal centraliza toda interação com o provedor de identidade e distribui tokens via `postMessage`. Isso simplifica a arquitetura de segurança e evita que múltiplas aplicações gerenciem fluxos OIDC independentemente.
