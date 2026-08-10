import { useEffect, useState } from 'react'

import { Icone } from '../../components/Icone'
import {
  formatarRazaoSocial,
  formatarTexto,
  mascararDocumento,
  montarLinkSei,
  rotuloTipoPessoa,
} from '../../lib/format'
import { obterApontamentos, obterHistoricoAgente } from './api'
import type { HistoricoAgente, ResumoApontamentos } from './types'

/**
 * Cards de resumo das telas de análise (relatório e processo).
 *
 * São três, na ordem: identificação do agente, apontamentos do checklist e
 * inventário de relatórios/processos do agente. Ficam aqui para as duas telas
 * usarem exatamente os mesmos componentes.
 *
 * Os dois últimos dependem do SharePoint, então buscam os próprios dados em
 * paralelo ao carregamento da tela — assim a página não espera por eles.
 */

/** Campos do item usados pelos cards, comuns às duas telas. */
export interface DadosAgenteCard {
  agente_regulado: string | null
  razao_social: string | null
  cnpj_cpf: string | null
  total_apontamentos?: number | null
  total_itens_avaliados?: number | null
}

/**
 * Casca comum dos cards.
 *
 * Define altura mínima igual para os três (mantendo a linha alinhada) sem impor
 * altura máxima — o card com detalhamento aberto cresce sozinho, sem esticar os
 * vizinhos, porque a grade usa `items-start`.
 */
export function CardResumo({
  titulo,
  carregando,
  children,
}: {
  titulo: string
  carregando?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="bg-surface-container-lowest p-stack-md rounded-lg border border-outline-variant shadow-card min-h-[132px] flex flex-col">
      <div className="flex items-center justify-between mb-2 gap-2">
        <p className="text-label-sm text-on-surface-variant uppercase">{titulo}</p>
        {carregando && (
          <Icone nome="progress_activity" className="animate-spin text-[14px] text-outline shrink-0" />
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * Tamanho da fonte da razão social conforme o comprimento do nome.
 *
 * Razão social de empresa varia muito (de "ABC Vistoria" a nomes com mais de 60
 * caracteres). Sem isso, o nome longo quebrava em três linhas e o card ficava
 * mais alto que os outros dois. Reduzir a fonte mantém o nome inteiro visível —
 * cortar com "..." já foi descartado, porque obrigava a passar o mouse para ler.
 */
function classeRazaoSocial(nome: string | null): string {
  const tamanho = (nome ?? '').length
  if (tamanho > 60) return 'text-[11px] leading-snug'
  if (tamanho > 40) return 'text-[13px] leading-snug'
  return 'text-body-md'
}

/**
 * Card 1 — identificação do agente regulado.
 *
 * Três linhas: classe do agente, tipo de pessoa com o número do documento, e a
 * razão social. A sigla "CNPJ"/"CPF" não aparece: o formato do número (com
 * barra ou não) e o "Pessoa Jurídica"/"Pessoa Física" ao lado já dizem o que é.
 */
export function CardAgente({ dados }: { dados: DadosAgenteCard }) {
  return (
    <CardResumo titulo="Agente Regulado">
      <p className="text-headline-sm text-on-surface">{formatarTexto(dados.agente_regulado)}</p>
      <p className="text-body-md text-on-surface-variant">
        {rotuloTipoPessoa(dados.cnpj_cpf)}
        <span className="text-outline"> · </span>
        <span className="tabular-nums">{mascararDocumento(dados.cnpj_cpf)}</span>
      </p>
      <p
        className={`text-on-surface font-semibold break-words ${classeRazaoSocial(dados.razao_social)}`}
        title={dados.razao_social ?? ''}
      >
        {formatarRazaoSocial(dados.razao_social)}
      </p>
    </CardResumo>
  )
}

/**
 * Card 2 — apontamentos (não conformidades) do checklist de fiscalização.
 *
 * Um apontamento é uma pergunta cuja resposta divergiu da esperada; a
 * lista_perguntas define, por pergunta, qual resposta caracteriza conformidade.
 * Zero apontamentos = relatório em conformidade.
 *
 * Enquanto a apuração ao vivo não responde, mostra o total já gravado no item.
 */
export function CardApontamentos({ itemId, dados }: { itemId?: string; dados: DadosAgenteCard }) {
  const [resumo, setResumo] = useState<ResumoApontamentos | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    if (!itemId) return
    let ativo = true
    setCarregando(true)
    obterApontamentos(itemId)
      .then((r) => { if (ativo) setResumo(r) })
      .catch(() => {})
      .finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [itemId])

  const total = resumo?.total_apontamentos ?? dados.total_apontamentos ?? null
  const avaliados = resumo?.itens_avaliados ?? dados.total_itens_avaliados ?? null
  const semDados = total === null

  const cor = semDados ? 'text-on-surface-variant' : total === 0 ? 'text-secondary' : 'text-error'

  return (
    <CardResumo titulo="Apontamentos" carregando={carregando}>
      {semDados ? (
        <p className="text-body-md text-on-surface-variant">
          {carregando ? 'Apurando...' : 'Checklist não disponível'}
        </p>
      ) : (
        <>
          <p className={`text-headline-sm ${cor}`}>
            {total === 0 ? 'Em conformidade' : `${total} não conformidade${total > 1 ? 's' : ''}`}
          </p>
          <p className="text-body-md text-on-surface-variant">
            {avaliados !== null ? `${avaliados} itens verificados` : 'Itens verificados não informados'}
            {resumo && resumo.nao_aplicaveis > 0 && ` • ${resumo.nao_aplicaveis} não se aplica`}
          </p>
        </>
      )}

      {/* Detalhamento com altura limitada: o card cresce só até certo ponto e
          então rola, para não empurrar o resto da tela ao ser aberto. */}
      {resumo && resumo.apontamentos.length > 0 && (
        <details className="mt-2">
          <summary className="text-label-sm text-primary cursor-pointer hover:underline">
            Ver apontamentos
          </summary>
          <ul className="mt-2 space-y-2 max-h-56 overflow-y-auto pr-1">
            {resumo.apontamentos.map((a, i) => (
              <li key={i} className="text-[11px] text-on-surface-variant border-l-2 border-error/50 pl-2">
                <span className="block text-on-surface">{a.pergunta}</span>
                <span>
                  Esperado: <strong>{a.resposta_esperada}</strong> • Respondido:{' '}
                  <strong className="text-error">{a.resposta_dada}</strong>
                </span>
                {a.enquadramento && <span className="block italic">{a.enquadramento}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </CardResumo>
  )
}

/**
 * Uma coluna do detalhamento do card 3: só os números SEI.
 *
 * A quantidade não se repete aqui — ela já aparece na face do card, na linha
 * "X relatórios | X processos".
 */
function ColunaRegistros({
  titulo,
  registros,
}: {
  titulo: string
  registros: HistoricoAgente['registros']
}) {
  return (
    <div className="min-w-0">
      <p className="text-label-sm text-on-surface-variant uppercase">{titulo}</p>
      {registros.length === 0 ? (
        <p className="text-[11px] text-outline italic mt-1">Nenhum</p>
      ) : (
        <ul className="mt-1 space-y-1 max-h-40 overflow-y-auto pr-1">
          {registros.map((r, i) => {
            const link = r.numero_sei ? montarLinkSei(r.numero_sei, r.id_procedimento) : ''
            return (
              <li key={`${r.numero_sei}-${i}`} className="text-[11px] flex items-center gap-1">
                {link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline tabular-nums inline-flex items-center gap-1"
                    title="Abrir no SEI"
                  >
                    {r.numero_sei}
                    <Icone nome="open_in_new" className="text-[12px] text-outline" />
                  </a>
                ) : (
                  <span className="tabular-nums">{r.numero_sei ?? '-'}</span>
                )}
                {r.atual && <span className="text-outline italic shrink-0">(atual)</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/**
 * Card 3 — quantitativo de processos e relatórios do agente.
 *
 * O inventário vem agrupado por CPF/CNPJ: cada fiscalização rende um relatório
 * e, quando houve instauração, também um processo. Fechado, o card mostra
 * apenas quantos registros existem; aberto, separa relatórios à esquerda e
 * processos à direita, com os números linkados para o SEI.
 */
export function CardRegistrosAgente({ itemId }: { itemId?: string }) {
  const [historico, setHistorico] = useState<HistoricoAgente | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    if (!itemId) return
    let ativo = true
    setCarregando(true)
    obterHistoricoAgente(itemId)
      .then((r) => { if (ativo) setHistorico(r) })
      .catch(() => {})
      .finally(() => { if (ativo) setCarregando(false) })
    return () => { ativo = false }
  }, [itemId])

  const relatorios = historico?.total_relatorios ?? 0
  const processos = historico?.total_processos ?? 0
  const listaRelatorios = historico?.registros.filter((r) => r.tipo !== 'processo') ?? []
  const listaProcessos = historico?.registros.filter((r) => r.tipo === 'processo') ?? []

  return (
    <CardResumo titulo="Processos e Relatórios" carregando={carregando}>
      {!historico ? (
        <p className="text-body-md text-on-surface-variant">
          {carregando ? 'Consultando...' : 'Não foi possível consultar'}
        </p>
      ) : historico.total === 0 ? (
        <p className="text-body-md text-on-surface-variant">Nenhum registro para este agente</p>
      ) : (
        <>
          <p className="text-headline-sm text-on-surface">
            {historico.total} mapeado{historico.total === 1 ? '' : 's'}
          </p>
          {/* A quebra por tipo fica na face do card, e não dentro do
              detalhamento: é ela que dá a este card a mesma quantidade de
              linhas dos outros dois. */}
          <p className="text-body-md text-on-surface-variant">
            <span className="text-secondary font-semibold">{relatorios}</span>
            {' '}relatório{relatorios === 1 ? '' : 's'}
            <span className="text-outline"> | </span>
            <span className="text-primary font-semibold">{processos}</span>
            {' '}processo{processos === 1 ? '' : 's'}
          </p>

          {/* Mesmo padrão do card de apontamentos: um resumo curto e o
              detalhamento sob demanda, para os três cards ficarem da mesma
              altura enquanto ninguém abre nada. */}
          <details className="mt-2">
            <summary className="text-label-sm text-primary cursor-pointer hover:underline">
              Ver processos e relatórios
            </summary>
            <div className="mt-2 grid grid-cols-2 gap-3 divide-x divide-outline-variant/40">
              <ColunaRegistros titulo="Relatórios" registros={listaRelatorios} />
              <div className="pl-3 min-w-0">
                <ColunaRegistros titulo="Processos" registros={listaProcessos} />
              </div>
            </div>
          </details>
        </>
      )}
    </CardResumo>
  )
}
