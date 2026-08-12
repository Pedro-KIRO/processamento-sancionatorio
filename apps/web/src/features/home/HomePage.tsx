import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiGet } from '../../api/client'
import { Icone } from '../../components/Icone'
import { MINHA_AREA_URL } from '../../components/SeiLinkGuard'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { AlertasInternos } from './AlertasInternos'
import { listarCaixaEntrada } from '../caixaEntrada/api'
import type { ItemCaixaEntrada } from '../caixaEntrada/types'
import { idProcedimentoExibidoProcesso, numeroExibidoProcesso, rotaAnaliseProcesso, STATUS_CLASSE, STATUS_LABEL } from '../processosAndamento/helpers'
import { listarProcessosAndamento } from '../processosAndamento/api'
import type { ItemProcessoAndamento } from '../processosAndamento/types'
import { formatarData, mascararDocumento, montarLinkSei } from '../../lib/format'
import { foiVisitado, marcarVisitado } from '../../lib/visitados'

type AtalhoId = 'caixa-entrada' | 'processos' | 'prazos' | 'cautelares' | 'decisoes' | 'arquivamento'

interface Atalho {
  id: AtalhoId
  label: string
  icon: string
  ativo: boolean
}

/** Atalhos "em breve" não precisam de um AtalhoId de verdade — usam uma
 *  chave qualquer só para o React (nunca entram no fluxo de seleção). */
interface AtalhoEmBreve {
  id: string
  label: string
  icon: string
  ativo: false
}

const ATALHOS_ATIVOS: Atalho[] = [
  { id: 'caixa-entrada', label: 'Caixa de Entrada', icon: 'inbox', ativo: true },
  { id: 'processos', label: 'Processos em Andamento', icon: 'folder_open', ativo: true },
  { id: 'prazos', label: 'Prazos', icon: 'timer', ativo: true },
  { id: 'cautelares', label: 'Cautelares', icon: 'warning', ativo: true },
  { id: 'decisoes', label: 'Decisões e Recursos', icon: 'gavel', ativo: true },
  { id: 'arquivamento', label: 'Arquivamento', icon: 'inventory_2', ativo: true },
]

/** Atalhos que navegam direto (sem painel de resumo associado). */
const ATALHOS_LINK: { label: string; icon: string; to: string }[] = []

const ATALHOS_EM_BREVE: AtalhoEmBreve[] = []

const IDS_VALIDOS = new Set<AtalhoId>(ATALHOS_ATIVOS.map((a) => a.id))
const CHAVE_ULTIMO_ATALHO = 'home:ultimoAtalhoAberto'

/** Lê o último atalho que o usuário deixou aberto (persistido entre visitas). */
function lerUltimoAtalho(): AtalhoId | null {
  try {
    const valor = localStorage.getItem(CHAVE_ULTIMO_ATALHO)
    return valor && IDS_VALIDOS.has(valor as AtalhoId) ? (valor as AtalhoId) : null
  } catch {
    return null
  }
}

export function HomePage() {
  useDocumentTitle('Início')
  const navigate = useNavigate()
  const [itensCaixa, setItensCaixa] = useState<ItemCaixaEntrada[]>([])
  const [itensProcessos, setItensProcessos] = useState<ItemProcessoAndamento[]>([])
  const [caixaCarregando, setCaixaCarregando] = useState(false)
  const [processosCarregando, setProcessosCarregando] = useState(false)
  // Primeiro acesso: mostramos um esqueleto de tela inteira até os dados
  // iniciais chegarem. Nas atualizações seguintes (refresh/polling) o conteúdo
  // já está na tela, então basta o indicador discreto de cada painel.
  const [primeiraCarga, setPrimeiraCarga] = useState(true)
  // Painel de resumo aberto abaixo dos atalhos: qual card está "selecionado"
  // no momento. Por padrão, retoma o último atalho que o usuário deixou
  // aberto (persistido no navegador). Clicar de novo no mesmo card fecha.
  const [painelAberto, setPainelAberto] = useState<AtalhoId | null>(lerUltimoAtalho)
  const [totalPrazos, setTotalPrazos] = useState<number>(0)
  const [totalNotificacoes, setTotalNotificacoes] = useState<number>(0)

  function carregarCaixa() {
    setCaixaCarregando(true)
    listarCaixaEntrada().then(setItensCaixa).catch(() => setItensCaixa([])).finally(() => setCaixaCarregando(false))
  }

  function carregarProcessos() {
    setProcessosCarregando(true)
    listarProcessosAndamento().then(setItensProcessos).catch(() => setItensProcessos([])).finally(() => setProcessosCarregando(false))
  }

  useEffect(() => {
    // Só libera a tela quando as quatro consultas do resumo terminarem —
    // evita o efeito de números "pulando" de zero para o valor real.
    Promise.allSettled([
      listarCaixaEntrada().then(setItensCaixa),
      listarProcessosAndamento().then(setItensProcessos),
      listarProcessosAndamento({ filtro: 'prazos' }).then((r) => setTotalPrazos(r.length)),
      apiGet<{ total_nao_lidas: number }>('/notificacoes?limit=1')
        .then((r) => setTotalNotificacoes(r.total_nao_lidas)),
    ]).finally(() => setPrimeiraCarga(false))
  }, [])

  const kpis = [
    { label: 'Itens na caixa de entrada', valor: String(itensCaixa.length), icon: 'inbox', cor: 'text-primary', bg: 'bg-primary-fixed' },
    { label: 'Processos em andamento', valor: String(itensProcessos.length), icon: 'folder_open', cor: 'text-secondary', bg: 'bg-secondary-fixed' },
    { label: 'Com prazos ativos', valor: String(totalPrazos), icon: 'timer', cor: 'text-error', bg: 'bg-error-container' },
    { label: 'Notificações pendentes', valor: String(totalNotificacoes), icon: 'notifications', cor: 'text-tertiary', bg: 'bg-tertiary-fixed' },
  ]

  function aoClicarAtalho(atalho: Atalho) {
    setPainelAberto((atual) => {
      const proximo = atual === atalho.id ? null : atalho.id
      try {
        if (proximo) {
          localStorage.setItem(CHAVE_ULTIMO_ATALHO, proximo)
        } else {
          localStorage.removeItem(CHAVE_ULTIMO_ATALHO)
        }
      } catch {
        // Armazenamento indisponível (ex.: modo privado) — segue sem persistir.
      }
      return proximo
    })
  }

  if (primeiraCarga) {
    return <HomeCarregando />
  }

  return (
    <div className="space-y-10">
      <section>
        <h1 className="text-headline-lg text-on-surface mb-1">Bem-vindo ao Processamento Sancionatório</h1>
        <p className="text-body-lg text-on-surface-variant">
          Veja o resumo das suas atividades e acesse as ferramentas de gestão.
        </p>
      </section>

      {/* Alertas internos: pendências que exigem ação, antes dos indicadores —
          é o que o documento chama de acompanhamento gerencial. */}
      <AlertasInternos />

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-gutter">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-surface-container-lowest p-stack-lg rounded-lg shadow-card border border-outline-variant flex justify-between items-start"
          >
            <div>
              <p className="text-label-sm text-outline uppercase mb-1">{k.label}</p>
              <h3 className={`text-headline-md ${k.cor} ${(caixaCarregando || processosCarregando) ? 'animate-pulse' : ''}`}>
                {(caixaCarregando || processosCarregando) ? '—' : k.valor}
              </h3>
            </div>
            <div className={`p-2 rounded-lg ${k.bg}`}>
              <Icone nome={k.icon} className={k.cor} />
            </div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-headline-sm text-on-surface mb-stack-lg">Atalhos rápidos</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-stack-lg">
          {ATALHOS_ATIVOS.map((a) => {
            const selecionado = painelAberto === a.id
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => aoClicarAtalho(a)}
                aria-pressed={selecionado}
                className={`flex flex-col items-center justify-center p-6 rounded-lg shadow-card border transition-all ${
                  selecionado
                    ? 'bg-primary text-white border-primary scale-[1.03]'
                    : 'bg-white text-primary border-outline-variant hover:bg-primary-container/10 hover:scale-105'
                }`}
              >
                <Icone nome={a.icon} className="text-4xl mb-3" />
                <span className="text-label-lg text-center">{a.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Orientação sobre o primeiro acesso ao SEI nesta aba */}
      <div className="flex items-start gap-3 bg-secondary-fixed/20 border border-secondary-container/30 rounded-lg px-4 py-3">
        <Icone nome="info" className="text-secondary text-[20px] mt-0.5 shrink-0" />
        <p className="text-body-md text-on-surface-variant">
          No primeiro link para o SEI nesta aba, o aplicativo confirmará se você já acessou a{' '}
          <a
            href={MINHA_AREA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-semibold hover:underline"
          >
            Minha Área SP
          </a>.
        </p>
      </div>

      {painelAberto === 'caixa-entrada' && (
        <ResumoCaixaEntrada itens={itensCaixa} onAnalisar={(id) => { marcarVisitado(`caixa:${id}`); navigate(`/analise/${id}`) }} onRefresh={carregarCaixa} carregando={caixaCarregando} />
      )}
      {painelAberto === 'processos' && (
        <ResumoProcessosAndamento itens={itensProcessos} navigate={navigate} onRefresh={carregarProcessos} carregando={processosCarregando} />
      )}
      {painelAberto === 'prazos' && (
        <ResumoFiltrado filtro="prazos" titulo="Processos com prazos ativos" navigate={navigate} />
      )}
      {painelAberto === 'cautelares' && (
        <ResumoFiltrado filtro="cautelares" titulo="Processos instaurados (cautelares)" navigate={navigate} />
      )}
      {painelAberto === 'decisoes' && (
        <ResumoFiltrado filtro="decisoes" titulo="Decisões e Recursos" navigate={navigate} />
      )}
      {painelAberto === 'arquivamento' && (
        <ResumoFiltrado filtro="arquivamento" titulo="Processos encerrados / arquivados" navigate={navigate} />
      )}
    </div>
  )
}

/**
 * Esqueleto da tela inicial, exibido só no primeiro acesso.
 *
 * Reproduz o formato final (título, 4 KPIs, grade de atalhos) para que a
 * transição não desloque o conteúdo, e deixa explícito que há carregamento em
 * curso — antes a tela parecia estática/vazia enquanto as consultas rodavam.
 */
function HomeCarregando() {
  return (
    <div className="space-y-10" aria-busy="true" aria-live="polite">
      <section>
        <h1 className="text-headline-lg text-on-surface mb-1">Bem-vindo ao Processamento Sancionatório</h1>
        <div className="flex items-center gap-2 text-on-surface-variant">
          <Icone nome="progress_activity" className="animate-spin text-[20px] text-primary" />
          <span className="text-body-lg">Carregando seu resumo...</span>
        </div>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-gutter">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-surface-container-lowest p-stack-lg rounded-lg shadow-card border border-outline-variant flex justify-between items-start animate-pulse"
          >
            <div className="flex-1">
              <div className="h-3 w-28 bg-outline-variant/50 rounded mb-3" />
              <div className="h-7 w-12 bg-outline-variant/40 rounded" />
            </div>
            <div className="w-9 h-9 rounded-lg bg-outline-variant/30" />
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-headline-sm text-on-surface mb-stack-lg">Atalhos rápidos</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-stack-lg">
          {ATALHOS_ATIVOS.map((a) => (
            <div
              key={a.id}
              className="flex flex-col items-center justify-center p-6 rounded-lg shadow-card border border-outline-variant bg-white animate-pulse"
            >
              <div className="w-9 h-9 rounded-lg bg-outline-variant/30 mb-3" />
              <div className="h-3 w-20 bg-outline-variant/40 rounded" />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

/* ─── Resumos exibidos ao clicar em cada card de atalho ─── */

function CabecalhoResumo({ titulo, to, onRefresh, carregando }: { titulo: string; to: string; onRefresh?: () => void; carregando?: boolean }) {
  return (
    <div className="px-stack-lg py-4 border-b border-outline-variant flex justify-between items-center bg-surface-container-low">
      <h3 className="text-label-lg text-primary uppercase tracking-wider">{titulo}</h3>
      <div className="flex items-center gap-3">
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={carregando}
            className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors disabled:opacity-50"
            title="Atualizar"
            aria-label="Atualizar lista"
          >
            <Icone nome={carregando ? 'progress_activity' : 'refresh'} className={`text-[18px] text-primary ${carregando ? 'animate-spin' : ''}`} />
          </button>
        )}
        <Link to={to} className="text-primary text-label-sm hover:underline inline-flex items-center gap-1">
          Ver tela completa
          <Icone nome="arrow_forward" className="text-[14px]" />
        </Link>
      </div>
    </div>
  )
}

function ResumoCaixaEntrada({ itens, onAnalisar, onRefresh, carregando }: { itens: ItemCaixaEntrada[]; onAnalisar: (id: number) => void; onRefresh?: () => void; carregando?: boolean }) {
  return (
    <section className="bg-surface-container-lowest rounded-lg shadow-card border border-outline-variant overflow-hidden">
      <CabecalhoResumo titulo="Caixa de Entrada" to="/caixa-entrada" onRefresh={onRefresh} carregando={carregando} />
      {itens.length === 0 ? (
        <p className="p-stack-lg text-on-surface-variant">Nenhum item na caixa de entrada.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider">Nº SEI</th>
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider">Agente Regulado</th>
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider">Recebido em</th>
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {itens.slice(0, 5).map((it) => {
                  const linkSei = it.numero_sei ? montarLinkSei(it.numero_sei, it.id_procedimento) : ''
                  const visitado = foiVisitado(`caixa:${it.id}`)
                  return (
                    <tr key={it.id} className={`transition-colors ${visitado ? 'bg-primary-fixed/10 border-l-4 border-l-primary' : 'hover:bg-background'}`}>
                      <td className="px-6 py-4 text-body-md font-semibold">
                        {linkSei ? (
                          <a
                            href={linkSei}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                            title="Abrir no SEI"
                          >
                            {it.numero_sei}
                            <Icone nome="open_in_new" className="text-[14px] text-outline" />
                          </a>
                        ) : (
                          <span className="text-on-surface">{it.numero_sei ?? '-'}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-3 py-1 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant text-[12px] font-bold">
                          {it.agente_regulado ?? '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-body-md text-on-surface-variant">{formatarData(it.data_recebimento)}</td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => onAnalisar(it.id)}
                          className="text-primary hover:text-primary-container transition-colors"
                          title="Analisar"
                        >
                          <Icone nome="visibility" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-outline-variant text-body-md text-on-surface-variant">
            Mostrando <span className="font-bold">{Math.min(itens.length, 5)}</span> de{' '}
            <span className="font-bold">{itens.length}</span> processo(s).
          </div>
        </>
      )}
    </section>
  )
}

function ResumoProcessosAndamento({
  itens,
  navigate,
  onRefresh,
  carregando,
}: {
  itens: ItemProcessoAndamento[]
  navigate: ReturnType<typeof useNavigate>
  onRefresh?: () => void
  carregando?: boolean
}) {
  function analisar(item: ItemProcessoAndamento) {
    marcarVisitado(`processo:${item.id}`)
    const rota = rotaAnaliseProcesso(item)
    if (rota) {
      navigate(rota)
    } else {
      window.alert('A tela de Arquivamento ainda não foi implementada.')
    }
  }

  return (
    <section className="bg-surface-container-lowest rounded-lg shadow-card border border-outline-variant overflow-hidden">
      <CabecalhoResumo titulo="Processos em Andamento" to="/processos" onRefresh={onRefresh} carregando={carregando} />
      {itens.length === 0 ? (
        <p className="p-stack-lg text-on-surface-variant">Nenhum processo em andamento.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider">Nº do Processo</th>
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider">CNPJ/CPF</th>
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider">Situação</th>
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {itens.slice(0, 5).map((it) => {
                  const numeroExibido = numeroExibidoProcesso(it)
                  const idProcedimentoExibido = idProcedimentoExibidoProcesso(it)
                  const linkSei = numeroExibido ? montarLinkSei(numeroExibido, idProcedimentoExibido) : ''
                  const status = it.status_triagem ?? ''
                  const visitado = foiVisitado(`processo:${it.id}`)
                  return (
                    <tr key={it.id} className={`transition-colors ${visitado ? 'bg-primary-fixed/10 border-l-4 border-l-primary' : 'hover:bg-background'}`}>
                      <td className="px-6 py-4 text-body-md font-semibold">
                        {linkSei ? (
                          <a
                            href={linkSei}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                            title="Abrir no SEI"
                          >
                            {numeroExibido}
                            <Icone nome="open_in_new" className="text-[14px] text-outline" />
                          </a>
                        ) : (
                          <span className="text-on-surface">{numeroExibido ?? '-'}</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-body-md text-on-surface-variant tabular-nums">{mascararDocumento(it.cnpj_cpf)}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-[12px] font-bold ${STATUS_CLASSE[status] ?? 'bg-outline-variant/40 text-on-surface-variant'}`}>
                          {STATUS_LABEL[status] ?? status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => analisar(it)}
                          className="text-primary hover:text-primary-container transition-colors"
                          title="Analisar"
                        >
                          <Icone nome="visibility" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-outline-variant text-body-md text-on-surface-variant">
            Mostrando <span className="font-bold">{Math.min(itens.length, 5)}</span> de{' '}
            <span className="font-bold">{itens.length}</span> processo(s).
          </div>
        </>
      )}
    </section>
  )
}


function ResumoFiltrado({ filtro, titulo, navigate }: { filtro: string; titulo: string; navigate: ReturnType<typeof useNavigate> }) {
  const [itens, setItens] = useState<ItemProcessoAndamento[]>([])
  const [carregando, setCarregando] = useState(true)

  function carregar() {
    setCarregando(true)
    listarProcessosAndamento({ filtro }).then(setItens).catch(() => setItens([])).finally(() => setCarregando(false))
  }

  useEffect(() => { carregar() }, [filtro])

  function analisar(item: ItemProcessoAndamento) {
    marcarVisitado(`processo:${item.id}`)
    const rota = rotaAnaliseProcesso(item)
    if (rota) navigate(rota)
  }

  return (
    <section className="bg-surface-container-lowest rounded-lg shadow-card border border-outline-variant overflow-hidden">
      <CabecalhoResumo titulo={titulo} to={`/processos?filtro=${filtro}`} onRefresh={carregar} carregando={carregando} />
      {!carregando && itens.length === 0 ? (
        <p className="p-stack-lg text-on-surface-variant">Nenhum processo encontrado para este filtro.</p>
      ) : carregando ? (
        <div className="p-stack-lg flex items-center gap-2 text-on-surface-variant">
          <Icone nome="progress_activity" className="animate-spin text-[18px]" /> Carregando...
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider">Nº do Processo</th>
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider">CNPJ/CPF</th>
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider">Situação</th>
                  <th className="px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {itens.slice(0, 5).map((it) => {
                  const numeroExibido = numeroExibidoProcesso(it)
                  const idProcedimentoExibido = idProcedimentoExibidoProcesso(it)
                  const linkSei = numeroExibido ? montarLinkSei(numeroExibido, idProcedimentoExibido) : ''
                  const status = it.status_triagem ?? ''
                  return (
                    <tr key={it.id} className="hover:bg-background transition-colors">
                      <td className="px-6 py-4 text-body-md font-semibold">
                        {linkSei ? (
                          <a href={linkSei} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            {numeroExibido} <Icone nome="open_in_new" className="text-[14px] text-outline" />
                          </a>
                        ) : <span>{numeroExibido ?? '-'}</span>}
                      </td>
                      <td className="px-6 py-4 text-body-md text-on-surface-variant tabular-nums">{mascararDocumento(it.cnpj_cpf)}</td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-[12px] font-bold ${STATUS_CLASSE[status] ?? 'bg-outline-variant/40 text-on-surface-variant'}`}>
                          {STATUS_LABEL[status] ?? status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => analisar(it)} className="text-primary hover:text-primary-container transition-colors" title="Analisar">
                          <Icone nome="visibility" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-outline-variant text-body-md text-on-surface-variant">
            Mostrando <span className="font-bold">{Math.min(itens.length, 5)}</span> de <span className="font-bold">{itens.length}</span> processo(s).
          </div>
        </>
      )}
    </section>
  )
}
