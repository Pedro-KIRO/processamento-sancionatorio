import { useEffect, useState } from 'react'

import { Icone } from '../../components/Icone'
import { formatarData } from '../../lib/format'
import {
  obterRecurso,
  registrarDecisaoII,
  registrarInterposicao,
  registrarParecerJuridico,
  type Recurso,
  type ResultadoDecisaoII,
} from './api'
import { LABELS_FASE } from './fases'

interface Props {
  itemId: string
}

const ROTULO_RESULTADO: Record<ResultadoDecisaoII, string> = {
  mantida: 'Decisão I mantida',
  reformada: 'Decisão I reformada',
  retorno_fase: 'Retorno a uma fase',
}

const COR_SEMAFORO: Record<string, string> = {
  verde: 'text-tertiary',
  amarelo: 'text-secondary',
  vermelho: 'text-error',
}

/**
 * Painel de recurso e Decisão II (Documentação de Negócio v3.0).
 *
 * O trâmite é sequencial: registrar a interposição (Sim/Não), receber o parecer
 * da Consultoria Jurídica e proferir a Decisão II. Cada etapa só aparece quando
 * a anterior está cumprida — o parecer é obrigatório antes de decidir, e o
 * backend recusa a decisão sem ele.
 */
export function PainelRecurso({ itemId }: Props) {
  const [recurso, setRecurso] = useState<Recurso | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Formulários
  const [dataInterposicao, setDataInterposicao] = useState('')
  const [parecerNumero, setParecerNumero] = useState('')
  const [parecerResumo, setParecerResumo] = useState('')
  const [resultado, setResultado] = useState<ResultadoDecisaoII>('mantida')
  const [faseRetorno, setFaseRetorno] = useState('')
  const [fundamentacao, setFundamentacao] = useState('')

  function carregar() {
    obterRecurso(itemId).then(setRecurso).catch(() => setRecurso(null))
  }

  useEffect(carregar, [itemId])

  async function executar(acao: () => Promise<Recurso>) {
    setEnviando(true)
    setErro(null)
    try {
      setRecurso(await acao())
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setEnviando(false)
    }
  }

  if (!recurso) return null

  const decidido = Boolean(recurso.decisao_resultado)
  const semResposta = recurso.interposto === null || recurso.interposto === undefined

  return (
    <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-card p-4 space-y-3">
      <h4 className="text-label-lg text-on-surface uppercase tracking-wider flex items-center gap-2">
        <Icone nome="gavel" className="text-[18px] text-primary" />
        Recurso e Decisão II
      </h4>

      {erro && (
        <p role="alert" className="bg-error-container text-on-error-container px-3 py-2 rounded-lg text-body-md">
          {erro}
        </p>
      )}

      {/* Etapa 1 — interposição */}
      {semResposta ? (
        <div className="space-y-2">
          <p className="text-body-md text-on-surface-variant">
            Houve interposição de recurso? O prazo é de 15 dias da publicação da Decisão I
            (art. 44).
          </p>
          <label className="block">
            <span className="text-[11px] text-on-surface-variant">Data do protocolo (opcional)</span>
            <input
              type="date"
              value={dataInterposicao}
              onChange={(e) => setDataInterposicao(e.target.value)}
              className="w-full border border-outline-variant rounded-lg px-2 py-1.5 text-body-md"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => executar(() => registrarInterposicao(itemId, true, dataInterposicao || undefined))}
              disabled={enviando || !recurso.pode_registrar_interposicao}
              className="flex-1 px-3 py-2 bg-primary text-white rounded-lg text-label-md hover:brightness-110 disabled:opacity-50"
            >
              Sim, houve recurso
            </button>
            <button
              onClick={() => executar(() => registrarInterposicao(itemId, false))}
              disabled={enviando || !recurso.pode_registrar_interposicao}
              className="flex-1 px-3 py-2 border border-outline-variant text-on-surface-variant rounded-lg text-label-md hover:bg-surface-container-high disabled:opacity-50"
            >
              Não houve
            </button>
          </div>
        </div>
      ) : recurso.interposto === false ? (
        <div className="bg-tertiary-fixed/15 border border-tertiary/20 rounded-lg px-3 py-2">
          <p className="text-body-md text-on-surface">
            <Icone nome="check_circle" className="text-[16px] text-tertiary align-middle mr-1" />
            Sem recurso: trânsito administrativo. O processo segue para o encerramento.
          </p>
        </div>
      ) : (
        <>
          <p className="text-body-md text-on-surface">
            Recurso interposto em{' '}
            <strong>{formatarData(recurso.data_interposicao)}</strong>
          </p>

          {/* Prazos do trâmite recursal */}
          {recurso.prazos.length > 0 && (
            <ul className="space-y-1">
              {recurso.prazos.map((p) => (
                <li key={p.chave} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-on-surface-variant">
                    {p.rotulo} <span className="text-outline">({p.base_legal})</span>
                  </span>
                  <span className={`font-bold tabular-nums ${COR_SEMAFORO[p.semaforo ?? ''] ?? ''}`}>
                    {p.dias_restantes === null
                      ? '—'
                      : p.dias_restantes < 0
                        ? `${p.dias_restantes} dias`
                        : p.dias_restantes === 0
                          ? 'Hoje'
                          : `${p.dias_restantes} dias`}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Etapa 2 — parecer da Consultoria Jurídica */}
          <div className="border-t border-outline-variant pt-3">
            {recurso.parecer_em ? (
              <p className="text-body-md text-on-surface-variant">
                <Icone nome="verified" className="text-[16px] text-tertiary align-middle mr-1" />
                Parecer da Consultoria Jurídica
                {recurso.parecer_numero_sei ? ` (${recurso.parecer_numero_sei})` : ''} registrado em{' '}
                {formatarData(recurso.parecer_em)}
                {recurso.parecer_resumo && (
                  <span className="block text-[11px] text-outline mt-1">{recurso.parecer_resumo}</span>
                )}
              </p>
            ) : recurso.pode_emitir_parecer ? (
              <div className="space-y-2">
                <p className="text-label-md text-on-surface-variant">Parecer da Consultoria Jurídica</p>
                <input
                  type="text"
                  value={parecerNumero}
                  onChange={(e) => setParecerNumero(e.target.value)}
                  placeholder="Nº SEI do parecer"
                  className="w-full border border-outline-variant rounded-lg px-2 py-1.5 text-body-md"
                />
                <textarea
                  value={parecerResumo}
                  onChange={(e) => setParecerResumo(e.target.value)}
                  rows={2}
                  placeholder="Resumo da conclusão"
                  className="w-full border border-outline-variant rounded-lg px-2 py-1.5 text-body-md"
                />
                <button
                  onClick={() => executar(() => registrarParecerJuridico(itemId, parecerNumero, parecerResumo))}
                  disabled={enviando}
                  className="w-full px-3 py-2 bg-primary text-white rounded-lg text-label-md hover:brightness-110 disabled:opacity-50"
                >
                  Registrar parecer
                </button>
              </div>
            ) : (
              <p className="text-body-md text-on-surface-variant">
                <Icone nome="hourglass_empty" className="text-[16px] text-secondary align-middle mr-1" />
                Aguardando o parecer da Consultoria Jurídica, obrigatório para a Decisão II.
              </p>
            )}
          </div>

          {/* Etapa 3 — Decisão II */}
          {recurso.parecer_em && (
            <div className="border-t border-outline-variant pt-3">
              {decidido ? (
                <div className="space-y-1">
                  <p className="text-body-md text-on-surface">
                    <Icone nome="gavel" className="text-[16px] text-primary align-middle mr-1" />
                    <strong>{ROTULO_RESULTADO[recurso.decisao_resultado!]}</strong>
                    {recurso.decisao_fase_retorno && (
                      <> — retorno à fase {LABELS_FASE[recurso.decisao_fase_retorno] ?? recurso.decisao_fase_retorno}</>
                    )}
                  </p>
                  <p className="text-[11px] text-outline">
                    {formatarData(recurso.decisao_em)}
                    {recurso.decisao_por ? ` · ${recurso.decisao_por}` : ''}
                  </p>
                  {recurso.decisao_fundamentacao && (
                    <p className="text-[11px] text-on-surface-variant">{recurso.decisao_fundamentacao}</p>
                  )}
                </div>
              ) : recurso.pode_decidir ? (
                <div className="space-y-2">
                  <p className="text-label-md text-on-surface-variant">Decisão II</p>
                  <select
                    value={resultado}
                    onChange={(e) => setResultado(e.target.value as ResultadoDecisaoII)}
                    className="w-full border border-outline-variant rounded-lg px-2 py-1.5 text-body-md bg-white"
                  >
                    <option value="mantida">Manter a Decisão I</option>
                    <option value="reformada">Reformar a Decisão I</option>
                    <option value="retorno_fase">Determinar retorno a uma fase</option>
                  </select>
                  {resultado === 'retorno_fase' && (
                    <select
                      value={faseRetorno}
                      onChange={(e) => setFaseRetorno(e.target.value)}
                      className="w-full border border-outline-variant rounded-lg px-2 py-1.5 text-body-md bg-white"
                    >
                      <option value="">Escolha a fase de retorno</option>
                      {recurso.fases_disponiveis.map((f) => (
                        <option key={f} value={f}>{LABELS_FASE[f] ?? f}</option>
                      ))}
                    </select>
                  )}
                  <textarea
                    value={fundamentacao}
                    onChange={(e) => setFundamentacao(e.target.value)}
                    rows={2}
                    placeholder="Fundamentação da decisão"
                    className="w-full border border-outline-variant rounded-lg px-2 py-1.5 text-body-md"
                  />
                  <button
                    onClick={() =>
                      executar(() =>
                        registrarDecisaoII(itemId, resultado, fundamentacao, faseRetorno || undefined),
                      )
                    }
                    disabled={enviando || (resultado === 'retorno_fase' && !faseRetorno)}
                    className="w-full px-3 py-2 bg-primary text-white rounded-lg text-label-md hover:brightness-110 disabled:opacity-50"
                  >
                    Registrar Decisão II
                  </button>
                </div>
              ) : (
                <p className="text-body-md text-on-surface-variant">
                  A Decisão II é proferida pela Coordenação.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
