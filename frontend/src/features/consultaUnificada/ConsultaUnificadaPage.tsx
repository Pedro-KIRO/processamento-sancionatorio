import { useEffect, useMemo, useState } from 'react'

import { BotaoCopiar } from '../../components/BotaoCopiar'
import { Icone } from '../../components/Icone'
import {
  formatarData,
  formatarRazaoSocial,
  formatarTexto,
  mascararDocumento,
  montarLinkSei,
} from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { rotuloFase } from '../processosAndamento/fases'
import {
  listarAgentesConsulta,
  listarConsultaUnificada,
  listarFasesConsulta,
  listarSituacoesConsulta,
  type ColunaOrdenavel,
  type FiltrosConsulta,
  type LinhaConsulta,
} from './api'
import {
  COLUNAS,
  gravarColunasOcultas,
  lerColunasOcultas,
  type ChaveColuna,
  type DefinicaoColuna,
} from './colunas'
import { FiltroColuna } from '../../components/FiltroColuna'
import { SeletorColunas } from './SeletorColunas'

const FILTROS_VAZIOS: FiltrosConsulta = {
  busca: '', fonte: '', agente: '', situacao: '', fase: '', ano: '',
  tipo: '', criacao_de: '', criacao_ate: '', acao_de: '', acao_ate: '',
  ordenar_por: 'criacao', ordem: 'desc',
}
const POR_PAGINA = 100

/** Classes comuns dos selects de filtro, para todos ficarem do mesmo tamanho. */
const CLASSE_SELECT =
  'w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md ' +
  'text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary-container/40'

/** Campo de data usado nos filtros de período, dentro do popover da coluna. */
const CLASSE_DATA =
  'w-full bg-white border border-outline-variant rounded px-2 py-1 text-[12px] ' +
  'text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary-container/50'

/**
 * Consulta Unificada — tela somente de consulta.
 *
 * Junta, num só lugar, os relatórios de fiscalização (vindos da listaDesignacao
 * por completo) e os processos sancionatórios, mostrando em que fase cada
 * processo está. Nenhuma ação é disparada daqui, por isso não há coluna de
 * ações: o lugar dela é a data da última movimentação no SEI.
 *
 * Os dados vêm da tabela sincronizada em background — nada é consultado no SEI
 * durante a navegação, para a tela responder rápido mesmo com ~19 mil linhas.
 *
 * Filtros de tipo e de período ficam no cabeçalho da coluna a que se referem, e
 * a ordenação é por clique no título, como numa planilha. Os filtros gerais
 * (fonte, fase, agente, situação, ano) ficam no topo.
 */
export function ConsultaUnificadaPage() {
  useDocumentTitle('Consulta Unificada')
  const [filtros, setFiltros] = useState<FiltrosConsulta>(FILTROS_VAZIOS)
  const [pagina, setPagina] = useState(0)
  const [linhas, setLinhas] = useState<LinhaConsulta[]>([])
  const [total, setTotal] = useState(0)
  const [agentes, setAgentes] = useState<string[]>([])
  const [situacoes, setSituacoes] = useState<string[]>([])
  const [fases, setFases] = useState<string[]>([])
  const [ocultas, setOcultas] = useState<ChaveColuna[]>(lerColunasOcultas)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Agentes, situações e fases dependem do recorte (tipo/fonte): filtrando
  // somente relatórios, "Processo instaurado" não pode aparecer como opção,
  // porque essa situação só existe em linha de processo.
  useEffect(() => {
    const recorte = { tipo: filtros.tipo, fonte: filtros.fonte }
    let ativo = true

    listarAgentesConsulta(recorte)
      .then((lista) => { if (ativo) setAgentes(lista) })
      .catch(() => { if (ativo) setAgentes([]) })

    listarSituacoesConsulta(recorte)
      .then((lista) => {
        if (!ativo) return
        setSituacoes(lista)
        // A situação escolhida pode não existir no novo recorte; mantê-la
        // deixaria a tela vazia sem explicação.
        setFiltros((f) => (f.situacao && !lista.includes(f.situacao) ? { ...f, situacao: '' } : f))
      })
      .catch(() => { if (ativo) setSituacoes([]) })

    listarFasesConsulta(recorte)
      .then((lista) => {
        if (!ativo) return
        setFases(lista)
        setFiltros((f) => (f.fase && !lista.includes(f.fase) ? { ...f, fase: '' } : f))
      })
      .catch(() => { if (ativo) setFases([]) })

    return () => { ativo = false }
  }, [filtros.tipo, filtros.fonte])

  // Trocar de filtro volta para a primeira página — senão a página atual
  // poderia ficar além do fim do novo resultado.
  useEffect(() => { setPagina(0) }, [
    filtros.busca, filtros.tipo, filtros.fonte, filtros.agente, filtros.situacao,
    filtros.fase, filtros.ano, filtros.criacao_de, filtros.criacao_ate,
    filtros.acao_de, filtros.acao_ate,
  ])

  useEffect(() => {
    let ativo = true
    const t = setTimeout(() => {
      setCarregando(true)
      setErro(null)
      listarConsultaUnificada({ ...filtros, limit: POR_PAGINA, offset: pagina * POR_PAGINA })
        .then((r) => {
          if (!ativo) return
          setLinhas(r.linhas)
          setTotal(r.total)
        })
        .catch((e) => { if (ativo) setErro(String(e)) })
        .finally(() => { if (ativo) setCarregando(false) })
    }, 350)
    return () => { ativo = false; clearTimeout(t) }
  }, [filtros, pagina])

  const temFiltro = useMemo(
    () => Boolean(
      filtros.busca || filtros.tipo || filtros.fonte || filtros.agente || filtros.situacao
      || filtros.fase || filtros.ano || filtros.criacao_de || filtros.criacao_ate
      || filtros.acao_de || filtros.acao_ate,
    ),
    [filtros],
  )

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const colunasVisiveis = COLUNAS.filter((c) => !ocultas.includes(c.chave))

  function atualizar(campo: keyof FiltrosConsulta, valor: string) {
    setFiltros((f) => ({ ...f, [campo]: valor }))
  }

  function limparCampos(...campos: (keyof FiltrosConsulta)[]) {
    setFiltros((f) => {
      const novo = { ...f }
      for (const campo of campos) novo[campo] = '' as never
      return novo
    })
  }

  /** Controles do popover de filtro de cada coluna. */
  function filtroDaColuna(coluna: DefinicaoColuna) {
    if (coluna.filtro === 'tipo') {
      return (
        <FiltroColuna
          coluna="Tipo"
          ativo={Boolean(filtros.tipo)}
          onLimpar={() => limparCampos('tipo')}
        >
          <select
            value={filtros.tipo ?? ''}
            onChange={(e) => atualizar('tipo', e.target.value)}
            className={CLASSE_DATA}
            aria-label="Filtrar por tipo"
          >
            <option value="">Todos</option>
            <option value="relatorio">Relatório</option>
            <option value="processo">Processo</option>
          </select>
        </FiltroColuna>
      )
    }

    if (coluna.filtro === 'periodo-criacao' || coluna.filtro === 'periodo-acao') {
      const criacao = coluna.filtro === 'periodo-criacao'
      const campoDe = criacao ? 'criacao_de' : 'acao_de'
      const campoAte = criacao ? 'criacao_ate' : 'acao_ate'
      return (
        <FiltroColuna
          coluna={coluna.titulo}
          ativo={Boolean(filtros[campoDe] || filtros[campoAte])}
          onLimpar={() => limparCampos(campoDe, campoAte)}
        >
          <div className="space-y-2">
            <label className="block">
              <span className="text-[11px] text-on-surface-variant">De</span>
              <input
                type="date"
                value={filtros[campoDe] ?? ''}
                onChange={(e) => atualizar(campoDe, e.target.value)}
                className={CLASSE_DATA}
                aria-label={`${coluna.titulo}: a partir de`}
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-on-surface-variant">Até</span>
              <input
                type="date"
                value={filtros[campoAte] ?? ''}
                onChange={(e) => atualizar(campoAte, e.target.value)}
                className={CLASSE_DATA}
                aria-label={`${coluna.titulo}: até`}
              />
            </label>
          </div>
        </FiltroColuna>
      )
    }

    return null
  }

  function alternarOrdem(coluna: ColunaOrdenavel) {
    setFiltros((f) => ({
      ...f,
      ordenar_por: coluna,
      // Primeiro clique numa coluna nova começa crescente; clicar de novo na
      // mesma coluna inverte.
      ordem: f.ordenar_por === coluna && f.ordem === 'asc' ? 'desc' : 'asc',
    }))
  }

  function trocarColunas(novas: ChaveColuna[]) {
    setOcultas(novas)
    gravarColunasOcultas(novas)
  }

  function iconeOrdem(coluna?: ColunaOrdenavel) {
    if (!coluna) return null
    const ativa = filtros.ordenar_por === coluna
    if (!ativa) {
      return <Icone nome="unfold_more" className="text-[14px] text-outline-variant" />
    }
    return (
      <Icone
        nome={filtros.ordem === 'asc' ? 'arrow_upward' : 'arrow_downward'}
        className="text-[14px] text-primary"
      />
    )
  }

  return (
    <div className="space-y-stack-lg">
      <div>
        <nav className="flex items-center gap-2 text-label-sm text-outline mb-2">
          <a href="/" className="hover:text-primary hover:underline">Início</a>
          <Icone nome="chevron_right" className="text-[14px]" />
          <span className="text-primary font-bold">Consulta Unificada</span>
        </nav>
        <h1 className="text-headline-lg text-primary">Consulta Unificada</h1>
        <p className="text-body-lg text-on-surface-variant">
          Relatórios de fiscalização e processos sancionatórios em uma única visão, apenas para consulta.
        </p>
      </div>

      {/*
        Busca sozinha na primeira linha e os demais campos numa grade abaixo.
        Antes tudo dividia a mesma linha flexível: em telas de notebook a caixa
        de busca encolhia até o placeholder não caber e vazar para fora dela.
      */}
      <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant shadow-card space-y-3">
        <div className="flex items-center bg-surface-container-low rounded-lg px-3 py-2 w-full focus-within:ring-2 focus-within:ring-primary-container/30">
          <Icone nome="search" className="text-outline text-[20px] shrink-0" />
          <input
            type="search"
            className="bg-transparent border-none outline-none ml-2 w-full min-w-0 text-body-md placeholder:text-outline text-ellipsis"
            placeholder="Buscar por Nº SEI, CNPJ/CPF ou razão social/nome"
            value={filtros.busca ?? ''}
            onChange={(e) => atualizar('busca', e.target.value)}
            aria-label="Buscar na consulta unificada"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-label-sm text-on-surface-variant">Fonte dos dados</span>
            <select
              className={CLASSE_SELECT}
              value={filtros.fonte ?? ''}
              onChange={(e) => atualizar('fonte', e.target.value)}
              aria-label="Filtrar pela fonte dos dados"
            >
              <option value="">Fiscalização e processamento</option>
              <option value="fiscalizacao">Somente fiscalização</option>
              <option value="processamento">Somente processamento</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-label-sm text-on-surface-variant">Agente regulado</span>
            <select
              className={CLASSE_SELECT}
              value={filtros.agente ?? ''}
              onChange={(e) => atualizar('agente', e.target.value)}
              aria-label="Filtrar por agente regulado"
            >
              <option value="">Todos os agentes</option>
              {agentes.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-label-sm text-on-surface-variant">Situação</span>
            <select
              className={CLASSE_SELECT}
              value={filtros.situacao ?? ''}
              onChange={(e) => atualizar('situacao', e.target.value)}
              aria-label="Filtrar por situação"
            >
              <option value="">Todas as situações</option>
              {situacoes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-label-sm text-on-surface-variant">Fase</span>
            <select
              className={CLASSE_SELECT}
              value={filtros.fase ?? ''}
              onChange={(e) => atualizar('fase', e.target.value)}
              aria-label="Filtrar pela fase do processo"
              disabled={fases.length === 0}
            >
              <option value="">{fases.length ? 'Todas as fases' : 'Nenhuma fase disponível'}</option>
              {fases.map((f) => <option key={f} value={f}>{rotuloFase(f)}</option>)}
            </select>
          </label>

          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-label-sm text-on-surface-variant">Ano</span>
              <select
                className={CLASSE_SELECT}
                value={filtros.ano ?? ''}
                onChange={(e) => atualizar('ano', e.target.value)}
                aria-label="Filtrar por ano"
              >
                <option value="">Todos os anos</option>
                <option value="2026">2026</option>
                <option value="2025">2025</option>
              </select>
            </label>
            <button
              onClick={() => setFiltros(FILTROS_VAZIOS)}
              disabled={!temFiltro}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container disabled:opacity-50 disabled:cursor-default text-label-lg shrink-0"
              title="Limpar filtros"
            >
              <Icone nome="filter_alt_off" className="text-[18px]" />
              <span className="hidden xl:inline">Limpar</span>
            </button>
          </div>
        </div>
      </div>

      {erro && (
        <p role="alert" className="bg-error-container text-on-error-container px-4 py-3 rounded-lg">
          Não foi possível carregar: {erro}
        </p>
      )}

      {carregando && linhas.length === 0 && (
        <div className="flex items-center justify-center py-12 gap-3 text-on-surface-variant">
          <div className="w-10 h-10 rounded-full bg-primary-fixed/30 flex items-center justify-center">
            <Icone nome="progress_activity" className="animate-spin text-[22px] text-primary" />
          </div>
          <span className="text-body-lg">Carregando registros...</span>
        </div>
      )}

      {!erro && !carregando && linhas.length === 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-10 text-center text-on-surface-variant">
          <Icone nome="search_off" className="text-4xl text-outline-variant" />
          <p className="mt-2">Nenhum registro encontrado para os filtros atuais.</p>
        </div>
      )}

      {!erro && linhas.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-card overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between gap-3 flex-wrap">
            <p className="text-body-md text-on-surface-variant">
              Total: <span className="text-on-surface">{total.toLocaleString('pt-BR')}</span>
              {temFiltro ? ' (filtrado)' : ''}
            </p>
            <div className="flex items-center gap-3">
              {carregando && (
                <span className="inline-flex items-center gap-1.5 text-label-sm text-on-surface-variant">
                  <Icone nome="progress_activity" className="animate-spin text-[16px] text-primary" />
                  Atualizando
                </span>
              )}
              <SeletorColunas ocultas={ocultas} onChange={trocarColunas} />
              <Paginacao
                pagina={pagina}
                totalPaginas={totalPaginas}
                onIr={(p) => setPagina(p)}
              />
            </div>
          </div>

          {/*
            `min-w` com rolagem horizontal em vez de deixar as colunas
            comprimirem: em tela de notebook o navegador amassava Razão Social e
            Agente regulado até virarem uma palavra por linha, e as linhas da
            tabela ficavam com o triplo da altura.
          */}
          <div className="overflow-auto max-h-[max(320px,calc(100vh-430px))]">
            {/*
              A tabela não força mais caixa alta em tudo: pelo padrão do
              projeto, só razão social/nome vai em caixa alta (aplicada célula a
              célula) e os demais campos ficam com a primeira letra maiúscula.
            */}
            <table className="w-full text-left border-collapse min-w-[1080px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  {colunasVisiveis.map((coluna) => (
                    <ColunaCabecalho
                      key={coluna.chave}
                      coluna={coluna}
                      icone={iconeOrdem(coluna.ordenarPor)}
                      filtro={filtroDaColuna(coluna)}
                      onOrdenar={alternarOrdem}
                    />
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-outline-variant/40">
                {linhas.map((l) => {
                  const link = l.numero_sei ? montarLinkSei(l.numero_sei, l.id_procedimento) : ''
                  const ehProcesso = l.tipo === 'processo'
                  const documento = mascararDocumento(l.cnpj_cpf)

                  const celulas: Record<ChaveColuna, React.ReactNode> = {
                    criacao: l.data_criacao_sei
                      ? formatarData(l.data_criacao_sei)
                      : <span className="text-outline">—</span>,
                    tipo: (
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] ${
                          ehProcesso
                            ? 'bg-primary-fixed/40 text-on-primary-fixed-variant'
                            : 'bg-secondary-fixed/30 text-secondary'
                        }`}
                      >
                        {ehProcesso ? 'Processo' : 'Relatório'}
                      </span>
                    ),
                    numero_sei: (
                      <div className="flex items-center gap-1">
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                            title="Abrir no SEI"
                          >
                            {l.numero_sei}
                            <Icone nome="open_in_new" className="text-[14px] text-outline" />
                          </a>
                        ) : (
                          <span className="text-primary">{l.numero_sei ?? '-'}</span>
                        )}
                        {l.numero_sei && (
                          <BotaoCopiar texto={l.numero_sei} rotulo="Copiar Nº SEI" />
                        )}
                      </div>
                    ),
                    // Texto longo limitado a duas linhas: mostra mais do nome
                    // que o corte em uma linha, sem a linha da tabela crescer
                    // conforme a razão social. O nome inteiro fica no title.
                    razao_social: (
                      <div className="flex items-start gap-1">
                        <span className="line-clamp-2" title={l.razao_social ?? ''}>
                          {formatarRazaoSocial(l.razao_social)}
                        </span>
                        {l.razao_social && (
                          <BotaoCopiar
                            texto={formatarRazaoSocial(l.razao_social)}
                            rotulo="Copiar razão social/nome"
                          />
                        )}
                      </div>
                    ),
                    cnpj_cpf: (
                      <div className="flex items-center gap-1">
                        <span className="tabular-nums">{documento}</span>
                        {l.cnpj_cpf && (
                          <BotaoCopiar texto={documento} rotulo="Copiar CNPJ/CPF" />
                        )}
                      </div>
                    ),
                    agente: (
                      <span className="line-clamp-2" title={l.agente_regulado ?? ''}>
                        {formatarTexto(l.agente_regulado)}
                      </span>
                    ),
                    situacao: (
                      <span className="px-2 py-1 rounded-full bg-surface-container-high text-on-surface-variant text-[11px]">
                        {formatarTexto(l.situacao)}
                      </span>
                    ),
                    fase: l.fase_atual
                      ? rotuloFase(l.fase_atual)
                      : <span className="text-outline">—</span>,
                    ultima_acao: l.data_ultima_acao
                      ? formatarData(l.data_ultima_acao)
                      : <span className="text-outline">—</span>,
                  }

                  return (
                    <tr
                      key={`${l.tipo}-${l.id}`}
                      className="hover:bg-surface-container-low/50 transition-colors align-top"
                    >
                      {colunasVisiveis.map((coluna) => (
                        <td
                          key={coluna.chave}
                          className={`px-3 py-3 text-[12px] text-on-surface-variant ${
                            coluna.chave === 'razao_social'
                              ? 'max-w-[240px]'
                              : coluna.chave === 'agente'
                              ? 'max-w-[170px]'
                              : 'whitespace-nowrap'
                          }`}
                        >
                          {celulas[coluna.chave]}
                        </td>
                      ))}
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

/** Célula de título, que ordena ao ser clicada quando a coluna permite. */
/**
 * Navegação de páginas com salto direto.
 *
 * Com 17 mil registros em páginas de 100, chegar à página 90 clicando em
 * "próxima" é inviável — daí o campo para digitar o número.
 */
function Paginacao({
  pagina,
  totalPaginas,
  onIr,
}: {
  pagina: number
  totalPaginas: number
  onIr: (pagina: number) => void
}) {
  const [rascunho, setRascunho] = useState(String(pagina + 1))

  // Acompanha a mudança feita pelas setas ou por troca de filtro.
  useEffect(() => { setRascunho(String(pagina + 1)) }, [pagina])

  function confirmar() {
    const numero = Number.parseInt(rascunho, 10)
    if (Number.isNaN(numero)) {
      setRascunho(String(pagina + 1))
      return
    }
    // Fora da faixa vira o limite mais próximo, em vez de erro.
    const alvo = Math.min(Math.max(numero, 1), totalPaginas) - 1
    onIr(alvo)
    setRascunho(String(alvo + 1))
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onIr(Math.max(0, pagina - 1))}
        disabled={pagina === 0}
        className="p-1.5 rounded-lg hover:bg-surface-container disabled:opacity-40 disabled:cursor-default"
        aria-label="Página anterior"
        title="Anterior"
      >
        <Icone nome="chevron_left" className="text-[18px]" />
      </button>

      <input
        type="text"
        inputMode="numeric"
        value={rascunho}
        onChange={(e) => setRascunho(e.target.value.replace(/\D/g, ''))}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirmar()
          if (e.key === 'Escape') setRascunho(String(pagina + 1))
        }}
        className="w-12 text-center bg-white border border-outline-variant rounded px-1 py-0.5 text-label-sm tabular-nums text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container/40"
        aria-label="Ir para a página"
        title="Digite o número da página e pressione Enter"
      />
      <span className="text-label-sm text-on-surface-variant tabular-nums">
        / {totalPaginas.toLocaleString('pt-BR')}
      </span>

      <button
        onClick={() => onIr(Math.min(totalPaginas - 1, pagina + 1))}
        disabled={pagina >= totalPaginas - 1}
        className="p-1.5 rounded-lg hover:bg-surface-container disabled:opacity-40 disabled:cursor-default"
        aria-label="Próxima página"
        title="Próxima"
      >
        <Icone nome="chevron_right" className="text-[18px]" />
      </button>
    </div>
  )
}

function ColunaCabecalho({
  coluna,
  icone,
  filtro,
  onOrdenar,
}: {
  coluna: DefinicaoColuna
  icone: React.ReactNode
  filtro: React.ReactNode
  onOrdenar: (coluna: ColunaOrdenavel) => void
}) {
  // `uppercase` fica aqui (e não mais na tabela inteira) para o cabeçalho
  // continuar igual ao das outras telas sem afetar os dados das linhas.
  return (
    <th className="px-3 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider bg-surface-container-low whitespace-nowrap">
      <div className="flex items-center gap-1">
        {coluna.ordenarPor ? (
          <button
            onClick={() => onOrdenar(coluna.ordenarPor!)}
            className="inline-flex items-center gap-1 hover:text-primary transition-colors"
            title={`Ordenar por ${coluna.titulo}`}
          >
            {coluna.titulo}
            {icone}
          </button>
        ) : (
          <span>{coluna.titulo}</span>
        )}
        {filtro}
      </div>
    </th>
  )
}
