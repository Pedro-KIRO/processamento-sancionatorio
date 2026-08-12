import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiGet } from '../../api/client'
import { Icone } from '../../components/Icone'
import { MINHA_AREA_URL } from '../../components/SeiLinkGuard'
import { FiltroColuna } from '../../components/FiltroColuna'
import { BotaoPrioridade } from '../../components/BotaoPrioridade'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { getMe, type Usuario } from '../me/api'
import { listarAgentes } from '../caixaEntrada/api'
import { alterarPrioridade, listarProcessosAndamento } from './api'
import {
  STATUS_CLASSE,
  STATUS_LABEL,
  idProcedimentoExibidoProcesso,
  numeroExibidoProcesso,
  rotaAnaliseProcesso,
} from './helpers'
import type { FiltrosProcessos, ItemProcessoAndamento } from './types'
import {
  formatarData,
  formatarRazaoSocial,
  formatarTexto,
  mascararDocumento,
  montarLinkSei,
} from '../../lib/format'
import { foiVisitado, marcarVisitado } from '../../lib/visitados'

/** Navega para a tela de análise do processo, ou avisa quando ainda não
 *  existe uma tela dedicada para o status (caso Arquivado). */
function navegarParaAnalise(item: ItemProcessoAndamento, navigate: ReturnType<typeof useNavigate>) {
  const rota = rotaAnaliseProcesso(item)
  if (rota) {
    navigate(rota)
  } else {
    window.alert('A tela de Arquivamento ainda não foi implementada.')
  }
}

const FILTROS_VAZIOS: FiltrosProcessos = { busca: '', agente: '', dataInicio: '', dataFim: '' }

/** Classes do `th`, repetidas em todas as colunas do cabeçalho. */
const CLASSE_TH =
  'px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider bg-surface-container-low whitespace-nowrap'

/** Tela quase idêntica à Caixa de Entrada, mas para processos que já saíram
 *  de lá por terem recebido um despacho (Arquivar/TAC/Instaurar). A coluna de
 *  data mostra a Data de Instauração (data em que o documento foi assinado no
 *  SEI) em vez da Data de Recebimento. */
const TITULO_POR_FILTRO: Record<string, { titulo: string; subtitulo: string }> = {
  prazos: { titulo: 'Prazos', subtitulo: 'Processos com prazos ativos em andamento.' },
  controle_interno: { titulo: 'Controle Interno', subtitulo: 'Processos há mais de 15 dias sem movimentação.' },
  decisoes: { titulo: 'Decisões e Recursos', subtitulo: 'Processos em fase de decisão ou recurso.' },
  arquivamento: { titulo: 'Arquivamento', subtitulo: 'Processos arquivados ou encerrados.' },
}

export function ProcessosAndamentoPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const filtroUrl = searchParams.get('filtro') || ''
  const buscaUrl = searchParams.get('busca') || ''

  const { titulo: tituloPagina, subtitulo: subtituloPagina } = TITULO_POR_FILTRO[filtroUrl] ?? {
    titulo: 'Processos em Andamento',
    subtitulo: 'Processos sancionatórios instaurados a partir dos relatórios de fiscalização.',
  }
  useDocumentTitle(tituloPagina)
  const [filtros, setFiltros] = useState<FiltrosProcessos>({ ...FILTROS_VAZIOS, filtro: filtroUrl, busca: buscaUrl })
  const [itens, setItens] = useState<ItemProcessoAndamento[]>([])
  const [agentes, setAgentes] = useState<string[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [idsComNotificacao, setIdsComNotificacao] = useState<Set<number>>(new Set())
  const [me, setMe] = useState<Usuario | null>(null)

  // Sincronizar filtro da URL com o state
  useEffect(() => {
    setFiltros((f) => ({ ...f, filtro: filtroUrl, busca: buscaUrl || f.busca }))
  }, [filtroUrl, buscaUrl])

  useEffect(() => {
    listarAgentes().then(setAgentes).catch(() => setAgentes([]))
    getMe().then(setMe).catch(() => setMe(null))
    // Carregar IDs de processos com notificações não-lidas
    apiGet<{ notificacoes: Array<{ caixa_entrada_id: number | null; lida: boolean }> }>('/notificacoes?limit=50')
      .then((r) => {
        const ids = new Set<number>()
        for (const n of r.notificacoes) {
          if (!n.lida && n.caixa_entrada_id) ids.add(n.caixa_entrada_id)
        }
        setIdsComNotificacao(ids)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    let ativo = true
    const t = setTimeout(() => {
      setCarregando(true)
      setErro(null)
      listarProcessosAndamento(filtros)
        .then((d) => { if (ativo) setItens(d) })
        .catch((e) => { if (ativo) setErro(String(e)) })
        .finally(() => { if (ativo) setCarregando(false) })
    }, 350)
    return () => { ativo = false; clearTimeout(t) }
  }, [filtros])

  // Polling: atualiza a lista a cada 60s sem exibir loading
  useEffect(() => {
    const intervalo = setInterval(() => {
      listarProcessosAndamento(filtros)
        .then(setItens)
        .catch(() => {})
    }, 60_000)
    return () => clearInterval(intervalo)
  }, [filtros])

  const temFiltro = useMemo(
    () => Boolean(filtros.busca || filtros.agente || filtros.dataInicio || filtros.dataFim),
    [filtros],
  )

  function atualizar(campo: keyof FiltrosProcessos, valor: string) {
    setFiltros((f) => ({ ...f, [campo]: valor }))
  }

  return (
    <div className="space-y-stack-lg">
      <div>
        <nav className="flex items-center gap-2 text-label-sm text-outline mb-2">
          <a href="/" className="hover:text-primary hover:underline">Início</a>
          <Icone nome="chevron_right" className="text-[14px]" />
          <span className="text-primary font-bold">{tituloPagina}</span>
        </nav>
        <h1 className="text-headline-lg text-primary">{tituloPagina}</h1>
        <p className="text-body-lg text-on-surface-variant">
          {subtituloPagina}
        </p>
        {filtroUrl && (
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => navigate('/processos')}
              className="flex items-center gap-1 text-[12px] text-primary hover:underline"
            >
              <Icone nome="filter_alt_off" className="text-[14px]" />
              Ver todos os processos
            </button>
          </div>
        )}
      </div>

      <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant shadow-card flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex items-center bg-surface-container-low rounded-lg px-3 py-2 flex-1 min-w-[240px] focus-within:ring-2 focus-within:ring-primary-container/30">
          <Icone nome="search" className="text-outline text-[20px]" />
          <input
            type="search"
            className="bg-transparent border-none outline-none ml-2 w-full text-body-md placeholder:text-outline"
            placeholder="Buscar por Nº SEI ou CNPJ/CPF (com ou sem máscara)"
            value={filtros.busca}
            onChange={(e) => atualizar('busca', e.target.value)}
            aria-label="Buscar por número SEI ou documento"
          />
        </div>
        {temFiltro && (
          <button
            onClick={() => setFiltros((f) => ({ ...FILTROS_VAZIOS, filtro: f.filtro }))}
            className="flex items-center gap-1 px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container text-label-lg"
          >
            <Icone nome="filter_alt_off" className="text-[18px]" />
            Limpar filtros
          </button>
        )}
      </div>

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

      {carregando && (
        <div className="flex items-center justify-center py-12 gap-3 text-on-surface-variant">
          <div className="w-10 h-10 rounded-full bg-primary-fixed/30 flex items-center justify-center">
            <Icone nome="progress_activity" className="animate-spin text-[22px] text-primary" />
          </div>
          <span className="text-body-lg">Carregando processos...</span>
        </div>
      )}
      {erro && (
        <p role="alert" className="bg-error-container text-on-error-container px-4 py-3 rounded-lg">
          Não foi possível carregar: {erro}
        </p>
      )}
      {!carregando && !erro && itens.length === 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-10 text-center text-on-surface-variant">
          <Icone nome="folder_open" className="text-4xl text-outline-variant" />
          <p className="mt-2">Nenhum processo em andamento para os filtros atuais.</p>
        </div>
      )}

      {/* Alerta de controle interno: todos os processos listados estão parados */}
      {filtroUrl === 'controle_interno' && !carregando && !erro && itens.length > 0 && (
        <div className="flex items-start gap-3 bg-error-container/30 border border-error/30 rounded-lg px-4 py-3">
          <Icone nome="notification_important" className="text-error text-[20px] mt-0.5 shrink-0" />
          <p className="text-body-md text-on-surface-variant">
            Os processos abaixo estão <strong className="text-error">há mais de 15 dias sem movimentação</strong>.
            Verifique se há pendência ou ação a ser tomada.
          </p>
        </div>
      )}

      {!erro && itens.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-card overflow-hidden">
          {/* Contagem no topo (antes ficava no rodapé): fica sempre visível,
              então o usuário sabe quantos itens existem sem rolar até o fim. */}
          <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between gap-3">
            <p className="text-body-md text-on-surface-variant">
              <span className="font-bold text-on-surface">{itens.length}</span>{' '}
              {itens.length === 1 ? 'processo' : 'processos'}
              {temFiltro || filtroUrl ? ' (filtrado)' : ''}
            </p>
            {carregando && (
              <span className="inline-flex items-center gap-1.5 text-label-sm text-on-surface-variant">
                <Icone nome="progress_activity" className="animate-spin text-[16px] text-primary" />
                Atualizando
              </span>
            )}
          </div>
          {/* Rolagem própria da tabela: garante que o `thead` sticky tenha um
              container de referência com altura limitada (com a rolagem da
              página inteira, o sticky não ativa por causa do overflow do card). */}
          <div className="overflow-auto max-h-[max(320px,calc(100vh-330px))]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  {/* ★ Priorização da Coordenação — primeira coluna, como na
                      tela de prazos da Documentação de Negócio v3.0. */}
                  <th className={`${CLASSE_TH} w-10 text-center`} title="Priorização">★</th>
                  <th className={CLASSE_TH}>
                    <div className="flex items-center gap-1">
                      <span>Data de Instauração</span>
                      <FiltroColuna
                        coluna="Data de Instauração"
                        ativo={Boolean(filtros.dataInicio || filtros.dataFim)}
                        onLimpar={() => setFiltros((f) => ({ ...f, dataInicio: '', dataFim: '' }))}
                      >
                        <div className="space-y-2">
                          <label className="block">
                            <span className="text-[11px] text-on-surface-variant">De</span>
                            <input
                              type="date"
                              value={filtros.dataInicio}
                              onChange={(e) => atualizar('dataInicio', e.target.value)}
                              className="w-full bg-white border border-outline-variant rounded px-2 py-1 text-[12px] text-on-surface-variant"
                            />
                          </label>
                          <label className="block">
                            <span className="text-[11px] text-on-surface-variant">Até</span>
                            <input
                              type="date"
                              value={filtros.dataFim}
                              onChange={(e) => atualizar('dataFim', e.target.value)}
                              className="w-full bg-white border border-outline-variant rounded px-2 py-1 text-[12px] text-on-surface-variant"
                            />
                          </label>
                        </div>
                      </FiltroColuna>
                    </div>
                  </th>
                  <th className={CLASSE_TH}>Nº Proc. Sancionatório</th>
                  <th className={CLASSE_TH}>Razão Social/Nome</th>
                  <th className={CLASSE_TH}>CNPJ/CPF</th>
                  <th className={CLASSE_TH}>
                    <div className="flex items-center gap-1">
                      <span>Agente regulado</span>
                      <FiltroColuna
                        coluna="Agente regulado"
                        ativo={Boolean(filtros.agente)}
                        onLimpar={() => setFiltros((f) => ({ ...f, agente: '' }))}
                      >
                        <select
                          value={filtros.agente}
                          onChange={(e) => atualizar('agente', e.target.value)}
                          className="w-full bg-white border border-outline-variant rounded px-2 py-1.5 text-[12px] text-on-surface-variant"
                        >
                          <option value="">Todos</option>
                          {agentes.map((a) => <option key={a} value={a}>{a}</option>)}
                        </select>
                      </FiltroColuna>
                    </div>
                  </th>
                  <th className={CLASSE_TH}>Situação</th>
                  {/* Centralizado, igual ao botão da célula: alinhado à direita,
                      o rótulo caía sobre a borda direita do botão (que tem 16px
                      de padding interno), não sobre a palavra "Analisar". */}
                  <th className={`${CLASSE_TH} text-center`}>Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {itens.map((it) => {
                  const numeroExibido = numeroExibidoProcesso(it)
                  const idProcedimentoExibido = idProcedimentoExibidoProcesso(it)
                  const status = it.status_triagem ?? ''
                  const visitado = foiVisitado(`processo:${it.id}`)
                  const temNotificacao = idsComNotificacao.has(it.id)
                  return (
                    <tr key={it.id} className={`transition-colors ${it.prioritario ? 'bg-primary-fixed/20 border-l-4 border-l-primary' : filtroUrl === 'controle_interno' ? 'bg-error-container/10 border-l-4 border-l-error' : temNotificacao ? 'bg-tertiary-fixed/15 border-l-4 border-l-tertiary' : visitado ? 'bg-primary-fixed/10 border-l-4 border-l-primary' : 'hover:bg-surface-container-low/50'}`}>
                      <td className="px-3 py-4 text-center">
                        <BotaoPrioridade
                          prioritario={it.prioritario}
                          justificativa={it.prioridade_justificativa}
                          podeEditar={Boolean(me?.pode_priorizar)}
                          onAlterar={async (novo, motivo) => {
                            await alterarPrioridade(it.id, novo, motivo)
                            setItens((lista) => lista.map((x) => x.id === it.id
                              ? { ...x, prioritario: novo, prioridade_justificativa: motivo ?? null }
                              : x))
                          }}
                        />
                      </td>
                      <td className="px-6 py-4 text-body-md text-on-surface-variant">
                        <div className="flex items-center gap-2">
                          {temNotificacao && (
                            <span className="w-2.5 h-2.5 rounded-full bg-tertiary shrink-0 animate-pulse" title="Nova notificação" />
                          )}
                          {it.data_instauracao ? formatarData(it.data_instauracao) : (
                            <span className="text-outline italic">Aguardando assinatura</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-label-lg tabular-nums">
                        {numeroExibido ? (() => {
                          const link = montarLinkSei(numeroExibido, idProcedimentoExibido)
                          return link ? (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline inline-flex items-center gap-1"
                              title="Abrir no SEI"
                            >
                              {numeroExibido}
                              <Icone nome="open_in_new" className="text-[14px] text-outline" />
                            </a>
                          ) : (
                            <span className="text-primary">{numeroExibido}</span>
                          )
                        })() : '-'}
                      </td>
                      <td className="px-6 py-4 text-body-md text-on-surface-variant max-w-[200px] truncate" title={it.razao_social ?? ''}>{formatarRazaoSocial(it.razao_social)}</td>
                      <td className="px-6 py-4 text-body-md text-on-surface-variant tabular-nums">{mascararDocumento(it.cnpj_cpf)}</td>
                      <td className="px-6 py-4">
                        <span className="px-3 py-1 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant text-[12px] font-bold">
                          {formatarTexto(it.agente_regulado)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-[12px] font-bold ${STATUS_CLASSE[status] ?? 'bg-outline-variant/40 text-on-surface-variant'}`}>
                          {STATUS_LABEL[status] ?? status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => { marcarVisitado(`processo:${it.id}`); navegarParaAnalise(it, navigate) }}
                          className="inline-flex items-center gap-1 bg-primary-container text-white px-4 py-2 rounded-lg text-label-lg hover:brightness-110 active:scale-95 transition-all"
                        >
                          <Icone nome="visibility" className="text-[18px]" />
                          Analisar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
