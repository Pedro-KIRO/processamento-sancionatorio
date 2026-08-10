/**
 * Guarda de autenticação: redireciona para login se não autenticado.
 * Em dev (sem config), libera direto.
 */
import { AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react'
import type { ReactNode } from 'react'
import { authConfigurada } from './msalConfig'
import { LoginPage } from './LoginPage'

export function AuthGuard({ children }: { children: ReactNode }) {
  if (!authConfigurada) {
    // Dev mode: sem autenticação, libera tudo
    return <>{children}</>
  }

  return (
    <>
      <AuthenticatedTemplate>{children}</AuthenticatedTemplate>
      <UnauthenticatedTemplate>
        <LoginPage />
      </UnauthenticatedTemplate>
    </>
  )
}
