import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { buscar, rotaDoResultado, type ResultadoBusca } from '../features/busca/api'
import { formatarRazaoSocial, mascararDocumento } from '../lib/format'
import { Icone } from './Icone'

/**
 * Pesquisa global do cabeçalho, com sugestões.
 *
 * Antes o Enter mandava sempre para "Processos em Andamento", o que levava à
 * tela errada quando o número pesquisado era de um relatório ainda na Caixa de
 * Entrada. Agora as sugestões aparecem conforme se digita, cada uma marcada
 * como Relatório ou Processo, e a navegação vai para a tela do item escolhido.
 *
 * Navegação por teclado: setas para percorrer, Enter para abrir, Esc para
 * fechar. Enter sem seleção abre o primeiro resultado.
 */
export function PesquisaGlobal() {
  const navigate = useNavigate()
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<ResultadoBusca[]>([])
  const [aberto, setAberto] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [selecionado, setSelecionado] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Busca com atraso, para não disparar uma consulta por tecla digitada.
  useEffect(() => {
    const limpo = termo.trim()
    if (limpo.length < 2) {
      setResultados([])
      setCarregando(false)
      return
    }
    let ativo = true
    setCarregando(true)
    const t = setTimeout(() => {
      buscar(limpo)
        .then((r) => {
          if (!ativo) return
          setResultados(r.resultados)
          setSelecionado(-1)
          setAberto(true)
        })
        .catch(() => { if (ativo) setResultados([]) })
        .finally(() => { if (ativo) setCarregando(false) })
    }, 300)
    return () => { ativo = false; clearTimeout(t) }
  }, [termo])

  // Clique fora fecha as sugestões.
  useEffect(() => {
    function aoClicar(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setAberto(false)
      }
    }
    document.addEventListener('mousedown', aoClicar)
    return () => document.removeEventListener('mousedown', aoClicar)
  }, [])

  function abrir(r: ResultadoBusca) {
    setAberto(false)
    setTermo('')
    setResultados([])
    inputRef.current?.blur()
    navigate(rotaDoResultado(r))
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setAberto(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAberto(true)
      setSelecionado((i) => (resultados.length === 0 ? -1 : (i + 1) % resultados.length))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelecionado((i) => (resultados.length === 0 ? -1 : (i <= 0 ? resultados.length : i) - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const escolhido = resultados[selecionado >= 0 ? selecionado : 0]
      if (escolhido) abrir(escolhido)
    }
  }

  const mostrarPainel = aberto && termo.trim().length >= 2

  return (
    <div ref={containerRef} className="hidden md:block relative w-72">
      <div className="flex items-center bg-surface-container-low rounded-full px-4 py-2 focus-within:ring-2 focus-within:ring-primary-container/30">
        <Icone nome="search" className="text-outline" />
        <input
          ref={inputRef}
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          onKeyDown={aoTeclar}
          onFocus={() => { if (resultados.length > 0) setAberto(true) }}
          className="bg-transparent border-none outline-none ml-2 w-full text-body-md placeholder:text-outline"
          placeholder="Pesquisar Nº SEI, CNPJ ou razão social/nome..."
          aria-label="Pesquisar relatório ou processo"
          aria-expanded={mostrarPainel}
          aria-autocomplete="list"
          role="combobox"
        />
        {carregando && (
          <Icone nome="progress_activity" className="animate-spin text-[16px] text-outline shrink-0" />
        )}
        {!carregando && termo && (
          <button
            onClick={() => { setTermo(''); setResultados([]); setAberto(false) }}
            className="shrink-0 hover:text-primary transition-colors"
            aria-label="Limpar pesquisa"
            title="Limpar"
          >
            <Icone nome="close" className="text-[16px] text-outline" />
          </button>
        )}
      </div>

      {mostrarPainel && (
        <ul
          role="listbox"
          className="absolute top-full left-0 right-0 mt-2 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-lg overflow-hidden z-50 max-h-80 overflow-y-auto"
        >
          {resultados.length === 0 && !carregando && (
            <li className="px-4 py-3 text-body-md text-on-surface-variant">
              Nada encontrado para "{termo.trim()}".
            </li>
          )}
          {resultados.map((r, i) => {
            const ehProcesso = r.tipo === 'processo'
            return (
              <li key={`${r.caixa_entrada_id}-${r.tipo}-${i}`} role="option" aria-selected={i === selecionado}>
                <button
                  onClick={() => abrir(r)}
                  onMouseEnter={() => setSelecionado(i)}
                  className={`w-full text-left px-4 py-2.5 border-b border-outline-variant/40 last:border-b-0 transition-colors ${
                    i === selecionado ? 'bg-primary-fixed/20' : 'hover:bg-surface-container-low'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        ehProcesso
                          ? 'bg-primary-fixed/40 text-on-primary-fixed-variant'
                          : 'bg-secondary-fixed/30 text-secondary'
                      }`}
                    >
                      {ehProcesso ? 'Processo' : 'Relatório'}
                    </span>
                    <span className="text-label-lg tabular-nums text-primary truncate">
                      {r.numero_sei ?? '-'}
                    </span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant truncate mt-0.5">
                    {r.razao_social ? formatarRazaoSocial(r.razao_social) : 'Sem razão social/nome'}
                    {r.cnpj_cpf ? ` • ${mascararDocumento(r.cnpj_cpf)}` : ''}
                  </p>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
