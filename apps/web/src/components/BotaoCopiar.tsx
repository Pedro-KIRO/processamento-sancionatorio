import { useEffect, useRef, useState } from 'react'

import { Icone } from './Icone'

interface Props {
  /** Texto que vai para a área de transferência. */
  texto: string
  /** Aparece no title e no aria-label (ex.: "Copiar Nº SEI"). */
  rotulo?: string
  className?: string
}

/**
 * Botão de copiar com confirmação visual.
 *
 * Troca o ícone por um "check" durante dois segundos, para o usuário saber que
 * a cópia funcionou sem precisar de um alerta.
 *
 * Usa `navigator.clipboard` quando disponível e cai para um `<textarea>`
 * temporário caso contrário: a API moderna exige contexto seguro (HTTPS ou
 * localhost) e o app também roda em rede interna por HTTP.
 */
export function BotaoCopiar({ texto, rotulo = 'Copiar', className = '' }: Props) {
  const [copiado, setCopiado] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  // Sem isso, o timer disparava depois da linha sair da tela (troca de página
  // ou de filtro) e o React reclamava de atualizar componente desmontado.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copiar(evento: React.MouseEvent) {
    // A linha inteira pode ser clicável; copiar não deve navegar.
    evento.preventDefault()
    evento.stopPropagation()

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto)
      } else {
        const campo = document.createElement('textarea')
        campo.value = texto
        campo.setAttribute('readonly', '')
        campo.style.position = 'fixed'
        campo.style.opacity = '0'
        document.body.appendChild(campo)
        campo.select()
        document.execCommand('copy')
        document.body.removeChild(campo)
      }
      setCopiado(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Navegador bloqueou o acesso à área de transferência: não há o que fazer
      // além de não fingir que copiou.
      setCopiado(false)
    }
  }

  return (
    <button
      type="button"
      onClick={copiar}
      title={copiado ? 'Copiado' : rotulo}
      aria-label={copiado ? 'Copiado' : rotulo}
      className={`p-1 rounded-md text-outline hover:text-primary hover:bg-surface-container transition-colors shrink-0 ${className}`}
    >
      <Icone
        nome={copiado ? 'check' : 'content_copy'}
        className={`text-[15px] ${copiado ? 'text-tertiary' : ''}`}
      />
    </button>
  )
}
