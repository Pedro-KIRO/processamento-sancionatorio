/**
 * Provider de autenticação: envolve o app com MsalProvider quando auth está configurada.
 * Quando AUTH não está configurada (dev), renderiza os filhos diretamente.
 *
 * Aguarda a inicialização do MSAL (initialize + handleRedirectPromise) antes de
 * renderizar qualquer coisa. Isso evita o erro "interaction_in_progress" e o
 * problema de SPA redirect que ocorria antes.
 */
import { MsalProvider } from '@azure/msal-react'
import { useEffect, useState, type ReactNode } from 'react'
import { authConfigurada, msalInstance, msalReady } from './msalConfig'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [pronto, setPronto] = useState(!authConfigurada)

  useEffect(() => {
    if (!authConfigurada) return
    msalReady.then(() => setPronto(true))
  }, [])

  if (!pronto) {
    // Tela de loading enquanto o MSAL processa o redirect de volta do Azure
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-body-md text-on-surface-variant animate-pulse">
          Autenticando...
        </p>
      </div>
    )
  }

  if (!authConfigurada) {
    // Desenvolvimento: sem autenticação configurada, libera direto
    return <>{children}</>
  }

  return <MsalProvider instance={msalInstance}>{children}</MsalProvider>
}
