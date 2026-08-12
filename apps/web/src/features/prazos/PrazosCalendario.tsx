import { useMemo, useState } from 'react'

import { Icone } from '../../components/Icone'
import { formatarRazaoSocial } from '../../lib/format'
import {
  DIAS_SEMANA,
  agruparPorDia,
  chaveDia,
  inicioDoDia,
  mesmoDia,
  nomeDoMes,
  semanasDoMes,
} from './calendario'
import { BORDA_SEMAFORO, type PrazoLinha } from './types'

interface Props {
  prazos: PrazoLinha[]
  onAbrirProcesso: (caixaEntradaId: number) => void
}

/** Quantos prazos cabem por dia antes de virar "+N mais". */
const MAX_POR_DIA = 3

/**
 * Modo calendário (mês) do Controle de Prazos.
 *
 * Serve de panorama do período. Os prazos atrasados de meses anteriores não
 * aparecem na grade (o vencimento deles é de outro mês), mas continuam no
 * contador de atrasados e no modo lista, como o documento pede — senão a
 * navegação por mês esconderia o que está mais urgente.
 */
export function PrazosCalendario({ prazos, onAbrirProcesso }: Props) {
  const hoje = inicioDoDia(new Date())
  const [referencia, setReferencia] = useState(hoje)
  const [diaAberto, setDiaAberto] = useState<string | null>(null)

  const porDia = useMemo(() => agruparPorDia(prazos), [prazos])
  const semanas = useMemo(() => semanasDoMes(referencia), [referencia])
  const atrasados = useMemo(
    () => prazos.filter((p) => p.semaforo === 'vermelho').length,
    [prazos],
  )

  function mover(meses: number) {
    setReferencia((r) => new Date(r.getFullYear(), r.getMonth() + meses, 1))
    setDiaAberto(null)
  }

  return (
    <div className="p-4 space-y-3">
      {/* Navegação do mês */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => mover(-1)}
            className="p-1.5 rounded-lg hover:bg-surface-container-high text-primary"
            aria-label="Mês anterior"
          >
            <Icone nome="chevron_left" className="text-[20px]" />
          </button>
          <h3 className="text-headline-sm text-on-surface capitalize">{nomeDoMes(referencia)}</h3>
          <button
            onClick={() => mover(1)}
            className="p-1.5 rounded-lg hover:bg-surface-container-high text-primary"
            aria-label="Mês seguinte"
          >
            <Icone nome="chevron_right" className="text-[20px]" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {atrasados > 0 && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-error-container text-on-error-container text-[12px] font-bold">
              <span className="w-2 h-2 rounded-full bg-error" />
              Atrasados: {atrasados}
            </span>
          )}
          <button
            onClick={() => { setReferencia(hoje); setDiaAberto(null) }}
            className="px-3 py-1.5 rounded-lg border border-primary text-primary text-label-md hover:bg-primary-fixed/20"
          >
            Hoje
          </button>
        </div>
      </div>

      {/* Cabeçalho dos dias da semana */}
      <div className="grid grid-cols-7 gap-1">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="text-label-sm text-on-surface-variant text-center py-1 uppercase tracking-wider">
            {d}
          </div>
        ))}
      </div>

      {/* Grade do mês */}
      <div className="grid grid-cols-7 gap-1">
        {semanas.flat().map((dia) => {
          const chave = chaveDia(dia)
          const doMes = dia.getMonth() === referencia.getMonth()
          const eHoje = mesmoDia(dia, hoje)
          const itens = porDia.get(chave) ?? []
          const expandido = diaAberto === chave
          const visiveis = expandido ? itens : itens.slice(0, MAX_POR_DIA)

          return (
            <div
              key={chave}
              className={`min-h-[92px] border rounded-lg p-1.5 ${
                doMes
                  ? 'border-outline-variant bg-surface-container-lowest'
                  : 'border-outline-variant/40 bg-surface-container-low/40'
              } ${eHoje ? 'ring-2 ring-primary/40' : ''}`}
            >
              <div className="flex items-center justify-between mb-1">
                {eHoje ? (
                  <span className="w-6 h-6 rounded-full bg-primary text-white text-[12px] font-bold inline-flex items-center justify-center">
                    {dia.getDate()}
                  </span>
                ) : (
                  <span className={`text-label-md ${doMes ? 'text-on-surface' : 'text-outline-variant'}`}>
                    {dia.getDate()}
                  </span>
                )}
              </div>

              <div className="space-y-1">
                {visiveis.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onAbrirProcesso(p.caixa_entrada_id)}
                    title={`${p.interessado ?? ''} — ${p.tipo_prazo ?? ''} (${p.restante_rotulo ?? ''})`}
                    className={`w-full text-left px-1.5 py-1 rounded border-l-[3px] bg-surface-container-low hover:bg-surface-container text-[11px] leading-tight truncate ${
                      p.semaforo ? BORDA_SEMAFORO[p.semaforo] : 'border-l-outline-variant'
                    }`}
                  >
                    {p.prioritario && <Icone nome="star" className="text-[11px] text-primary align-middle mr-0.5" />}
                    {formatarRazaoSocial(p.interessado)} — {p.tipo_prazo}
                  </button>
                ))}
                {itens.length > MAX_POR_DIA && (
                  <button
                    onClick={() => setDiaAberto(expandido ? null : chave)}
                    className="text-[11px] text-primary hover:underline px-1.5"
                  >
                    {expandido ? 'ver menos' : `+ ${itens.length - MAX_POR_DIA} mais`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-outline">
        Prazos atrasados de meses anteriores aparecem no contador e no modo Lista.
      </p>
    </div>
  )
}
