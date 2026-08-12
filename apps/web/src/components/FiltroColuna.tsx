import { useEffect, useRef, useState } from 'react'

import { Icone } from './Icone'

interface Props {
  /** Título da coluna, usado nos rótulos de acessibilidade. */
  coluna: string
  /** Fica destacado quando há filtro aplicado nesta coluna. */
  ativo: boolean
  /** Limpa o filtro da coluna. */
  onLimpar: () => void
  children: React.ReactNode
}

/**
 * Ícone de filtro no cabeçalho da coluna, que abre os controles ao ser clicado.
 *
 * Antes os campos ficavam sempre visíveis numa segunda faixa do cabeçalho, o
 * que enchia o topo da tabela de caixas brancas e roubava altura da área de
 * leitura. Agora só o ícone aparece, e ele muda de cor quando a coluna está
 * filtrada — assim continua evidente que existe filtro ativo mesmo fechado.
 */
export function FiltroColuna({ coluna, ativo, onLimpar, children }: Props) {
  const [aberto, setAberto] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return

    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false)
      }
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false)
    }

    document.addEventListener('mousedown', aoClicarFora)
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('mousedown', aoClicarFora)
      document.removeEventListener('keydown', aoTeclar)
    }
  }, [aberto])

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        onClick={() => setAberto((a) => !a)}
        className={`p-0.5 rounded transition-colors ${
          ativo
            ? 'text-primary bg-primary-fixed/30'
            : 'text-outline-variant hover:text-primary hover:bg-surface-container'
        }`}
        title={ativo ? `Filtro aplicado em ${coluna}` : `Filtrar ${coluna}`}
        aria-label={ativo ? `Filtro aplicado em ${coluna}` : `Filtrar ${coluna}`}
        aria-expanded={aberto}
      >
        <Icone nome={ativo ? 'filter_alt' : 'filter_list'} className="text-[15px]" />
      </button>

      {aberto && (
        <div className="absolute left-0 top-full mt-1 z-30 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-card p-3 normal-case min-w-[180px]">
          <p className="text-label-sm text-on-surface-variant mb-2">{coluna}</p>
          {children}
          {ativo && (
            <button
              onClick={() => { onLimpar(); setAberto(false) }}
              className="mt-2 w-full text-label-sm text-primary hover:underline text-left"
            >
              Limpar filtro
            </button>
          )}
        </div>
      )}
    </div>
  )
}
