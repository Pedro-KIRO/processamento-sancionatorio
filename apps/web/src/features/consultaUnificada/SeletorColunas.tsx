import { useEffect, useRef, useState } from 'react'

import { Icone } from '../../components/Icone'
import { COLUNAS, type ChaveColuna } from './colunas'

interface Props {
  ocultas: ChaveColuna[]
  onChange: (ocultas: ChaveColuna[]) => void
}

/**
 * Menu para escolher quais colunas aparecem, no estilo de planilha.
 *
 * Ao menos uma coluna precisa continuar visível: uma tabela sem colunas não
 * mostra nada e não dá pista de como voltar.
 */
export function SeletorColunas({ ocultas, onChange }: Props) {
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

  function alternar(chave: ChaveColuna) {
    const escondida = ocultas.includes(chave)
    if (!escondida && ocultas.length >= COLUNAS.length - 1) return
    onChange(escondida ? ocultas.filter((c) => c !== chave) : [...ocultas, chave])
  }

  const visiveis = COLUNAS.length - ocultas.length

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setAberto((a) => !a)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container text-label-sm"
        title="Escolher colunas visíveis"
        aria-expanded={aberto}
        aria-haspopup="true"
      >
        <Icone nome="view_column" className="text-[18px]" />
        <span className="hidden sm:inline">
          Colunas ({visiveis}/{COLUNAS.length})
        </span>
        <Icone nome={aberto ? 'expand_less' : 'expand_more'} className="text-[16px]" />
      </button>

      {aberto && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-60 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-card z-30 py-1 max-h-80 overflow-y-auto"
        >
          {COLUNAS.map((coluna) => {
            const visivel = !ocultas.includes(coluna.chave)
            const ultima = visivel && visiveis <= 1
            return (
              <label
                key={coluna.chave}
                className={`flex items-center gap-2 px-3 py-2 text-body-md hover:bg-surface-container-low ${
                  ultima ? 'opacity-50 cursor-default' : 'cursor-pointer'
                }`}
                title={ultima ? 'Ao menos uma coluna precisa ficar visível' : undefined}
              >
                <input
                  type="checkbox"
                  checked={visivel}
                  disabled={ultima}
                  onChange={() => alternar(coluna.chave)}
                  className="accent-primary"
                />
                <span className="text-on-surface">{coluna.titulo}</span>
              </label>
            )
          })}

          {ocultas.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="w-full text-left px-3 py-2 mt-1 border-t border-outline-variant text-label-sm text-primary hover:bg-surface-container-low"
            >
              Mostrar todas
            </button>
          )}
        </div>
      )}
    </div>
  )
}
