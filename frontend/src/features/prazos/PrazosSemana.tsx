import { useMemo, useState } from 'react'

import { Icone } from '../../components/Icone'
import { formatarRazaoSocial } from '../../lib/format'
import {
  DIAS_SEMANA,
  agruparPorDia,
  chaveDia,
  inicioDaSemana,
  inicioDoDia,
  intervaloDaSemana,
  mesmoDia,
  somarDias,
} from './calendario'
import { BORDA_SEMAFORO, TEXTO_SEMAFORO, type PrazoLinha } from './types'

interface Props {
  prazos: PrazoLinha[]
  onAbrirProcesso: (caixaEntradaId: number) => void
}

/**
 * Modo semana do Controle de Prazos.
 *
 * Recorte de sete dias com mais espaço por prazo: cada card traz o número do
 * processo, o tipo, o restante e o interessado, para planejar o trabalho da
 * semana. O dia corrente fica destacado.
 */
export function PrazosSemana({ prazos, onAbrirProcesso }: Props) {
  const hoje = inicioDoDia(new Date())
  const [inicio, setInicio] = useState(() => inicioDaSemana(hoje))

  const porDia = useMemo(() => agruparPorDia(prazos), [prazos])
  const dias = useMemo(
    () => Array.from({ length: 7 }, (_, i) => somarDias(inicio, i)),
    [inicio],
  )
  const atrasados = useMemo(
    () => prazos.filter((p) => p.semaforo === 'vermelho').length,
    [prazos],
  )

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setInicio((d) => somarDias(d, -7))}
            className="p-1.5 rounded-lg hover:bg-surface-container-high text-primary"
            aria-label="Semana anterior"
          >
            <Icone nome="chevron_left" className="text-[20px]" />
          </button>
          <h3 className="text-headline-sm text-on-surface">{intervaloDaSemana(inicio)}</h3>
          <button
            onClick={() => setInicio((d) => somarDias(d, 7))}
            className="p-1.5 rounded-lg hover:bg-surface-container-high text-primary"
            aria-label="Semana seguinte"
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
            onClick={() => setInicio(inicioDaSemana(hoje))}
            className="px-3 py-1.5 rounded-lg border border-primary text-primary text-label-md hover:bg-primary-fixed/20"
          >
            Hoje
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
        {dias.map((dia) => {
          const itens = porDia.get(chaveDia(dia)) ?? []
          const eHoje = mesmoDia(dia, hoje)
          return (
            <div
              key={chaveDia(dia)}
              className={`rounded-lg border p-2 min-h-[220px] ${
                eHoje
                  ? 'border-primary bg-primary-fixed/10'
                  : 'border-outline-variant bg-surface-container-lowest'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                  {DIAS_SEMANA[dia.getDay()]}
                </span>
                {eHoje ? (
                  <span className="w-6 h-6 rounded-full bg-primary text-white text-[12px] font-bold inline-flex items-center justify-center">
                    {dia.getDate()}
                  </span>
                ) : (
                  <span className="text-label-lg text-on-surface">{dia.getDate()}</span>
                )}
                {eHoje && <span className="text-[11px] text-primary">Hoje</span>}
              </div>

              {itens.length === 0 && (
                <p className="text-[11px] text-outline-variant italic">Sem prazos</p>
              )}

              <div className="space-y-2">
                {itens.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onAbrirProcesso(p.caixa_entrada_id)}
                    className={`w-full text-left p-2 rounded border-l-[3px] bg-surface-container-low hover:bg-surface-container transition-colors ${
                      p.semaforo ? BORDA_SEMAFORO[p.semaforo] : 'border-l-outline-variant'
                    }`}
                  >
                    <p className="text-[11px] font-bold text-on-surface tabular-nums truncate">
                      {p.prioritario && <Icone nome="star" className="text-[11px] text-primary align-middle mr-0.5" />}
                      {p.numero_sei ?? '-'}
                    </p>
                    <p className="text-[11px] text-on-surface-variant truncate">
                      {p.tipo_prazo}
                      {p.dias ? ` (${p.dias}d)` : ''}
                    </p>
                    <p
                      className={`text-[11px] font-semibold ${
                        p.semaforo ? TEXTO_SEMAFORO[p.semaforo] : 'text-on-surface-variant'
                      }`}
                    >
                      {p.restante_rotulo}
                    </p>
                    <p className="text-[11px] text-outline truncate" title={p.interessado ?? ''}>
                      {formatarRazaoSocial(p.interessado)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-outline">
        Cada card mostra o processo, o tipo de prazo, o restante e o interessado.
      </p>
    </div>
  )
}
