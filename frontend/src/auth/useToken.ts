/**
 * Hook para obter o token de acesso (para chamar a API do backend).
 * Em dev (sem auth), retorna null (API aceita sem token quando AUTH_ENABLED=false).
 */
import { useMsal } from '@azure/msal-react'
import { useCallback } from 'react'
import { apiScopes, authConfigurada } from './msalConfig'

/**
 * Retorna uma função que obtém o token silenciosamente (ou null em dev).
 * Uso: const getToken = useToken(); const token = await getToken();
 */
export function useToken() {
  const { instance, accounts } = useMsal()

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!authConfigurada) return null
    if (accounts.length === 0) return null

    try {
      const response = await instance.acquireTokenSilent({
        ...apiScopes,
        account: accounts[0],
      })
      return response.accessToken
    } catch {
      // Se silent falhar, tenta popup/redirect
      try {
        const response = await instance.acquireTokenRedirect(apiScopes)
        return null // Redirect não retorna direto
      } catch {
        return null
      }
    }
  }, [instance, accounts])

  return getToken
}
