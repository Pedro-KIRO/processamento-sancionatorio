/**
 * Tela de login exibida quando o usuário não está autenticado.
 */
import { useMsal } from '@azure/msal-react'
import { Icone } from '../components/Icone'
import { loginScopes } from './msalConfig'

export function LoginPage() {
  const { instance } = useMsal()

  function handleLogin() {
    instance.loginRedirect(loginScopes)
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-xl shadow-card border border-outline-variant p-10 max-w-md w-full text-center space-y-8">
        <div>
          <img src="/logo-detran.png" alt="DETRAN-SP" className="h-16 mx-auto mb-4" />
          <h1 className="text-headline-md text-on-surface">Processamento Sancionatório</h1>
          <p className="text-body-md text-on-surface-variant mt-2">
            Sistema de gestão de processos administrativos sancionatórios — CPSAR
          </p>
        </div>

        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-primary text-white rounded-lg text-label-lg font-bold hover:bg-primary-container transition-colors shadow-md"
        >
          <svg className="w-5 h-5" viewBox="0 0 21 21" fill="none">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Entrar com conta Microsoft
        </button>

        <p className="text-[11px] text-outline">
          Use sua conta institucional (@detran.sp.gov.br) para acessar o sistema.
        </p>
      </div>
    </div>
  )
}
