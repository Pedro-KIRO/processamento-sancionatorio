/**
 * Configuração do MSAL (Microsoft Authentication Library) para login com Entra ID.
 *
 * Variáveis de ambiente (definir em .env.local ou .env):
 * - VITE_ENTRA_CLIENT_ID: Client ID do App Registration (tipo SPA)
 * - VITE_ENTRA_TENANT_ID: Tenant ID do Azure AD
 * - VITE_ENTRA_REDIRECT_URI: URI de redirecionamento (ex: http://localhost:5173)
 */
import { Configuration, LogLevel, PublicClientApplication } from '@azure/msal-browser'

const clientId = import.meta.env.VITE_ENTRA_CLIENT_ID ?? ''
const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID ?? ''
const redirectUri = import.meta.env.VITE_ENTRA_REDIRECT_URI ?? window.location.origin

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri,
    postLogoutRedirectUri: redirectUri,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      loggerCallback: (_level, message) => {
        if (import.meta.env.DEV) console.debug('[MSAL]', message)
      },
    },
  },
}

/** Scopes solicitados ao fazer login. */
export const loginScopes = {
  scopes: ['openid', 'profile', 'email'],
}

/** Scope para chamar a API do backend (usar o audience do backend). */
export const apiScopes = {
  scopes: [import.meta.env.VITE_ENTRA_API_SCOPE ?? `api://${clientId}/access_as_user`],
}

export const msalInstance = new PublicClientApplication(msalConfig)

/** Verifica se a autenticação está configurada (variáveis preenchidas). */
export const authConfigurada = Boolean(clientId && tenantId)

/**
 * Inicializa o MSAL e processa o redirect de volta do Azure.
 *
 * O MSAL v5 exige que initialize() + handleRedirectPromise() sejam chamados
 * ANTES de qualquer acquireToken ou loginRedirect. Sem isso, ao voltar do
 * login o app não processa a resposta e dá o erro "interaction_in_progress"
 * ou o Azure rejeita com "AADSTS9002326" (redirect URI não configurado como
 * SPA). Chamar uma vez na montagem do AuthProvider resolve os dois casos.
 */
export const msalReady: Promise<void> = (async () => {
  if (!authConfigurada) return
  await msalInstance.initialize()
  await msalInstance.handleRedirectPromise()
})()
