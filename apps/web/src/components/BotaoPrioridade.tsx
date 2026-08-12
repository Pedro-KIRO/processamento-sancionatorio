import { useState } from 'react'

import { Icone } from './Icone'

interface Props {
  /** Estado atual da priorização. */
  prioritario: boolean
  /** Motivo registrado por quem priorizou (aparece no `title` da estrela). */
  justificativa?: string | null
  /** Falso deixa a estrela apenas informativa, sem clique. */
  podeEditar: boolean
  /** Recebe o novo estado e, ao priorizar, a justificativa digitada. */
  onAlterar: (prioritario: boolean, justificativa?: string) => Promise<void> | void
  /** `icone` mostra só a estrela (para dentro de tabela); `completo` inclui rótulo. */
  variante?: 'icone' | 'completo'
}

/**
 * Estrela de priorização (★) da Coordenação.
 *
 * Priorizar exige justificativa: a estrela vale para toda a equipe e sobe o
 * processo na fila dos outros, então o motivo precisa ficar registrado. Ao
 * marcar, abre um campo para o texto; ao desmarcar, é direto.
 */
export function BotaoPrioridade({
  prioritario,
  justificativa,
  podeEditar,
  onAlterar,
  variante = 'icone',
}: Props) {
  const [pedindoMotivo, setPedindoMotivo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)

  const titulo = prioritario
    ? `Priorizado pela Coordenação${justificativa ? `: ${justificativa}` : ''}`
    : podeEditar
      ? 'Priorizar para toda a equipe'
      : 'Não priorizado'

  async function alternar() {
    if (!podeEditar) return
    if (prioritario) {
      setSalvando(true)
      try {
        await onAlterar(false)
      } finally {
        setSalvando(false)
      }
      return
    }
    setMotivo('')
    setPedindoMotivo(true)
  }

  async function confirmar() {
    if (!motivo.trim()) return
    setSalvando(true)
    try {
      await onAlterar(true, motivo.trim())
      setPedindoMotivo(false)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <span className="relative inline-flex items-center">
      <button
        onClick={alternar}
        disabled={!podeEditar || salvando}
        aria-pressed={prioritario}
        title={titulo}
        aria-label={titulo}
        className={`inline-flex items-center gap-1 rounded transition-colors ${
          variante === 'completo' ? 'px-2 py-1' : 'p-0.5'
        } ${prioritario ? 'text-primary' : 'text-outline-variant'} ${
          podeEditar ? 'hover:text-primary hover:bg-surface-container' : 'cursor-default'
        }`}
      >
        <Icone nome={prioritario ? 'star' : 'star_border'} className="text-[18px]" />
        {variante === 'completo' && (
          <span className="text-label-md">{prioritario ? 'Priorizado' : 'Priorizar'}</span>
        )}
      </button>

      {pedindoMotivo && (
        <div className="absolute left-0 top-full mt-1 z-30 w-72 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-card p-3 normal-case text-left">
          <p className="text-label-sm text-on-surface-variant mb-1">
            Justificativa da priorização
          </p>
          <textarea
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Por que este processo passa à frente dos outros?"
            className="w-full border border-outline-variant rounded px-2 py-1 text-body-md"
          />
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={confirmar}
              disabled={!motivo.trim() || salvando}
              className="px-3 py-1.5 bg-primary text-white rounded-lg text-label-md hover:brightness-110 disabled:opacity-50"
            >
              {salvando ? 'Salvando...' : 'Priorizar'}
            </button>
            <button
              onClick={() => setPedindoMotivo(false)}
              className="px-3 py-1.5 border border-outline-variant text-on-surface-variant rounded-lg text-label-md hover:bg-surface-container-high"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
