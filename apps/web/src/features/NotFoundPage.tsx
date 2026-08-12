import { Link } from 'react-router-dom'
import { Icone } from '../components/Icone'

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center py-32 gap-6 text-center">
      <div className="bg-error-container/20 p-6 rounded-full">
        <Icone nome="search_off" className="text-6xl text-error" />
      </div>
      <div>
        <h1 className="text-headline-lg text-on-surface mb-2">Página não encontrada</h1>
        <p className="text-body-lg text-on-surface-variant max-w-md">
          O endereço que você acessou não existe ou foi movido. Verifique a URL ou volte para a página inicial.
        </p>
      </div>
      <Link
        to="/"
        className="px-6 py-3 bg-primary text-white text-label-lg font-bold rounded-lg hover:bg-primary-container transition-colors inline-flex items-center gap-2"
      >
        <Icone nome="home" className="text-[18px]" />
        Voltar ao início
      </Link>
    </div>
  )
}
