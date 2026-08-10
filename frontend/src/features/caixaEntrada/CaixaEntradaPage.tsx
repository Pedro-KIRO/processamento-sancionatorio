import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icone } from '../../components/Icone'
import { FiltroColuna } from '../../components/FiltroColuna'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { listarAgentes, listarCaixaEntrada } from './api'
import type {
  ColunaOrdenavelCaixa,
  FiltrosCaixa,
  ItemCaixaEntrada,
  SentidoOrdem,
} from './types'
import {
  formatarData,
  formatarRazaoSocial,
  formatarTexto,
  mascararDocumento,
  montarLinkSei,
} from '../../lib/format'
import { foiVisitado, marcarVisitado } from '../../lib/visitados'

const FILTROS_VAZIOS: FiltrosCaixa = {
  busca: '', agente: '', dataInicio: '', dataFim: '',
  // Caixa de entrada abre com o recebimento mais recente no topo.
  ordenarPor: 'data_recebimento', ordem: 'desc',
}

/** Classes do `th`, repetidas em todas as colunas do cabeçalho. */
const CLASSE_TH =
  'px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider bg-surface-container-low whitespace-nowrap'

export function CaixaEntradaPage() {
  useDocumentTitle('Caixa de Entrada')
  const navigate = useNavigate()
  const [filtros, setFiltros] = useState<FiltrosCaixa>(FILTROS_VAZIOS)
  const [itens, setItens] = useState<ItemCaixaEntrada[]>([])
  const [agentes, setAgentes] = useState<string[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    listarAgentes().then(setAgentes).catch(() => setAgentes([]))
  }, [])

  useEffect(() => {
    let ativo = true
    const t = setTimeout(() => {
      setCarregando(true)
      setErro(null)
      listarCaixaEntrada(filtros)
        .then((d) => { if (ativo) setItens(d) })
        .catch((e) => { if (ativo) setErro(String(e)) })
        .finally(() => { if (ativo) setCarregando(false) })
    }, 350)
    return () => { ativo = false; clearTimeout(t) }
  }, [filtros])

  // Polling: atualiza a lista a cada 60s sem exibir loading
  useEffect(() => {
    const intervalo = setInterval(() => {
      listarCaixaEntrada(filtros)
        .then(setItens)
        .catch(() => {})
    }, 60_000)
    return () => clearInterval(intervalo)
  }, [filtros])

  // A ordenação de propósito não entra aqui: trocar a ordem não é "filtrar", e
  // contá-la deixaria o botão Limpar aceso e a contagem marcada como filtrada.
  const temFiltro = useMemo(
    () => Boolean(filtros.busca || filtros.agente || filtros.dataInicio || filtros.dataFim),
    [filtros],
  )

  function atualizar(campo: keyof FiltrosCaixa, valor: string) {
    setFiltros((f) => ({ ...f, [campo]: valor }))
  }

  /**
   * Alterna a ordenação da coluna clicada.
   *
   * Coluna nova começa no sentido mais útil dela: data pelo mais recente
   * (desc) e nome em ordem alfabética (asc). Clicar de novo na mesma coluna
   * inverte o sentido.
   */
  function alternarOrdem(coluna: ColunaOrdenavelCaixa) {
    setFiltros((f) => {
      if (f.ordenarPor === coluna) {
        return { ...f, ordem: f.ordem === 'asc' ? 'desc' : 'asc' }
      }
      return { ...f, ordenarPor: coluna, ordem: coluna === 'data_recebimento' ? 'desc' : 'asc' }
    })
  }

  return (
    <div className="space-y-stack-lg">
      <div>
        <nav className="flex items-center gap-2 text-label-sm text-outline mb-2">
          <a href="/" className="hover:text-primary hover:underline">Início</a>
          <Icone nome="chevron_right" className="text-[14px]" />
          <span className="text-primary font-bold">Caixa de Entrada</span>
        </nav>
        <h1 className="text-headline-lg text-primary">Caixa de Entrada</h1>
        <p className="text-body-lg text-on-surface-variant">
          Relatórios recebidos da fiscalização para triagem e análise.
        </p>
      </div>

      <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant shadow-card flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex items-center bg-surface-container-low rounded-lg px-3 py-2 flex-1 min-w-[240px] focus-within:ring-2 focus-within:ring-primary-container/30">
          <Icone nome="search" className="text-outline text-[20px]" />
          <input
            type="search"
            className="bg-transparent border-none outline-none ml-2 w-full text-body-md placeholder:text-outline"
            placeholder="Buscar por Nº SEI, CNPJ/CPF ou Razão Social"
            value={filtros.busca}
            onChange={(e) => atualizar('busca', e.target.value)}
            aria-label="Buscar por número SEI, documento ou razão social"
          />
        </div>
        {temFiltro && (
          <button
            onClick={() => setFiltros((f) => ({ ...FILTROS_VAZIOS, busca: '', ordenarPor: f.ordenarPor, ordem: f.ordem }))}
            className="flex items-center gap-1 px-4 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container text-label-lg"
          >
            <Icone nome="filter_alt_off" className="text-[18px]" />
            Limpar filtros
          </button>
        )}
      </div>

      {/* Aviso sobre login no SEI */}
      <div className="flex items-start gap-3 bg-secondary-fixed/20 border border-secondary-container/30 rounded-lg px-4 py-3">
        <Icone nome="info" className="text-secondary text-[20px] mt-0.5 shrink-0" />
        <p className="text-body-md text-on-surface-variant">
          Para abrir processos diretamente no SEI, é necessário estar logado na{' '}
          <a
            href="https://plataforma.sp.gov.br/x/mdpdd/minha-area/list"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-semibold hover:underline"
          >
            Plataforma SP (Minha Área)
          </a>{' '}
          antes de clicar no número SEI.
        </p>
      </div>

      {carregando && (
        <div className="flex items-center justify-center py-12 gap-3 text-on-surface-variant">
          <div className="w-10 h-10 rounded-full bg-primary-fixed/30 flex items-center justify-center">
            <Icone nome="progress_activity" className="animate-spin text-[22px] text-primary" />
          </div>
          <span className="text-body-lg">Carregando relatórios...</span>
        </div>
      )}
      {erro && (
        <p role="alert" className="bg-error-container text-on-error-container px-4 py-3 rounded-lg">
          Não foi possível carregar: {erro}
        </p>
      )}
      {!carregando && !erro && itens.length === 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-10 text-center text-on-surface-variant">
          <Icone nome="inbox" className="text-4xl text-outline-variant" />
          <p className="mt-2">Nenhum item encontrado para os filtros atuais.</p>
        </div>
      )}

      {!erro && itens.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-card overflow-hidden">
          {/* Contagem no topo (antes ficava no rodapé): fica sempre visível,
              então o usuário sabe quantos itens existem sem rolar até o fim. */}
          <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between gap-3">
            <p className="text-body-md text-on-surface-variant">
              <span className="font-bold text-on-surface">{itens.length}</span>{' '}
              {itens.length === 1 ? 'relatório' : 'relatórios'}
              {temFiltro ? ' (filtrado)' : ''}
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
                  <th className={CLASSE_TH}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => alternarOrdem('data_recebimento')}
                        className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                        title="Ordenar por Data de recebimento"
                      >
                        Data de recebimento
                        {filtros.ordenarPor === 'data_recebimento' ? (
                          <Icone nome={filtros.ordem === 'asc' ? 'arrow_upward' : 'arrow_downward'} className="text-[14px] text-primary" />
                        ) : (
                          <Icone nome="unfold_more" className="text-[14px] text-outline-variant" />
                        )}
                      </button>
                      <FiltroColuna
                        coluna="Data de recebimento"
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
                  <th className={CLASSE_TH}>Nº SEI</th>
                  <th className={CLASSE_TH}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => alternarOrdem('razao_social')}
                        className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                        title="Ordenar por Razão Social/Nome"
                      >
                        Razão Social/Nome
                        {filtros.ordenarPor === 'razao_social' ? (
                          <Icone nome={filtros.ordem === 'asc' ? 'arrow_upward' : 'arrow_downward'} className="text-[14px] text-primary" />
                        ) : (
                          <Icone nome="unfold_more" className="text-[14px] text-outline-variant" />
                        )}
                      </button>
                    </div>
                  </th>
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
                  {/* Título centralizado, igual ao botão da célula: alinhado à
                      direita, o rótulo ficava sobre a borda direita do botão
                      (que tem 16px de padding interno), e não sobre a palavra
                      "Analisar" — daí a impressão de desalinho. */}
                  <th className={`${CLASSE_TH} text-center`}>Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {itens.map((it) => {
                  const visitado = foiVisitado(`caixa:${it.id}`)
                  return (
                  <tr key={it.id} className={`transition-colors ${visitado ? 'bg-primary-fixed/10 border-l-4 border-l-primary' : 'hover:bg-surface-container-low/50'}`}>
                    <td className="px-6 py-4 text-body-md text-on-surface-variant">{formatarData(it.data_recebimento)}</td>
                    <td className="px-6 py-4 text-label-lg tabular-nums">
                      {it.numero_sei ? (() => {
                        const link = montarLinkSei(it.numero_sei, it.id_procedimento)
                        return link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                            title="Abrir no SEI"
                          >
                            {it.numero_sei}
                            <Icone nome="open_in_new" className="text-[14px] text-outline" />
                          </a>
                        ) : (
                          <span className="text-primary">{it.numero_sei}</span>
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
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => { marcarVisitado(`caixa:${it.id}`); navigate(`/analise/${it.id}`) }}
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
