import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Icone } from '../../components/Icone'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { listarAgentes } from '../caixaEntrada/api'
import { listarPrazos, listarResponsaveisPrazo, listarTiposPrazo } from './api'
import { PrazosCalendario } from './PrazosCalendario'
import { PrazosLista } from './PrazosLista'
import { PrazosSemana } from './PrazosSemana'
import type {
  FiltrosPrazos,
  ModoVisualizacao,
  ResponsavelPrazo,
  RespostaPrazos,
  Semaforo,
  TipoPrazo,
} from './types'

const FILTROS_VAZIOS: FiltrosPrazos = {
  busca: '', agente: '', tipo: '', situacao: '', responsavel_id: null, priorizados: false,
  venc_de: '', venc_ate: '',
}

const CLASSE_SELECT =
  'w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md ' +
  'text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary-container/40'

/**
 * Controle de Prazos (Documentação de Negócio v3.0).
 *
 * Concentra os prazos em curso da unidade com a urgência sinalizada por cor.
 * Três modos de visualização sobre o mesmo endpoint: lista (padrão, para o
 * acompanhamento diário), calendário do mês (panorama) e semana (curto prazo).
 *
 * Os cartões de resumo também são filtro rápido — clicar em "Vencidos" filtra a
 * lista —, e por isso a contagem deles vem do backend sem o filtro de situação
 * aplicado: senão o próprio clique zeraria os outros contadores. Eles são também
 * o único caminho para o filtro de situação e de priorizados nos modos calendário
 * e semana, onde não há cabeçalho de coluna com funil.
 */
export function PrazosPage() {
  useDocumentTitle('Controle de Prazos')
  const navigate = useNavigate()

  const [modo, setModo] = useState<ModoVisualizacao>('lista')
  const [filtros, setFiltros] = useState<FiltrosPrazos>(FILTROS_VAZIOS)
  const [dados, setDados] = useState<RespostaPrazos | null>(null)
  const [agentes, setAgentes] = useState<string[]>([])
  const [tipos, setTipos] = useState<TipoPrazo[]>([])
  const [responsaveis, setResponsaveis] = useState<ResponsavelPrazo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    listarAgentes().then(setAgentes).catch(() => setAgentes([]))
    listarTiposPrazo().then(setTipos).catch(() => setTipos([]))
    listarResponsaveisPrazo().then(setResponsaveis).catch(() => setResponsaveis([]))
  }, [])

  const buscar = useCallback(() => {
    setCarregando(true)
    setErro(null)
    listarPrazos(filtros)
      .then(setDados)
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => setCarregando(false))
  }, [filtros])

  // Respiro de 300ms para a busca não disparar uma requisição por tecla.
  useEffect(() => {
    const t = setTimeout(buscar, 300)
    return () => clearTimeout(t)
  }, [buscar])

  const temFiltro = useMemo(
    () =>
      Boolean(
        filtros.busca || filtros.agente || filtros.tipo || filtros.situacao ||
        filtros.responsavel_id || filtros.priorizados,
      ),
    [filtros],
  )

  function atualizar<K extends keyof FiltrosPrazos>(campo: K, valor: FiltrosPrazos[K]) {
    setFiltros((f) => ({ ...f, [campo]: valor }))
  }

  /** Cartão clicado alterna o filtro de situação (ou o de priorizados). */
  function alternarCartao(situacao: Semaforo | 'priorizados') {
    if (situacao === 'priorizados') {
      setFiltros((f) => ({ ...f, priorizados: !f.priorizados, situacao: '' }))
      return
    }
    setFiltros((f) => ({
      ...f,
      situacao: f.situacao === situacao ? '' : situacao,
      priorizados: false,
    }))
  }

  const resumo = dados?.resumo
  const prazos = dados?.prazos ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <nav className="flex items-center gap-2 text-label-sm text-outline mb-2">
            <a href="/" className="hover:text-primary hover:underline">Início</a>
            <Icone nome="chevron_right" className="text-[14px]" />
            <span className="text-primary font-bold">Controle de Prazos</span>
          </nav>
          <h1 className="text-headline-lg text-primary">Controle de Prazos</h1>
          <p className="text-body-lg text-on-surface-variant">
            Prazos em curso da unidade, com a urgência sinalizada por cor.
          </p>
        </div>

        {/* Alternador de modo. Lista é o padrão: o trabalho diário é por prazo
            nominal, e o calendário serve de panorama. */}
        <div
          className="inline-flex rounded-lg border border-outline-variant overflow-hidden shrink-0"
          role="tablist"
          aria-label="Modo de visualização"
        >
          {(['lista', 'calendario', 'semana'] as ModoVisualizacao[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={modo === m}
              onClick={() => setModo(m)}
              className={`px-4 py-2 text-label-lg transition-colors ${
                modo === m
                  ? 'bg-primary text-white'
                  : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {m === 'lista' ? 'Lista' : m === 'calendario' ? 'Calendário' : 'Semana'}
            </button>
          ))}
        </div>
      </div>

      {/* Cartões de resumo — também funcionam como filtro rápido */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <CartaoResumo
          rotulo="Vencidos"
          total={resumo?.vencidos ?? 0}
          cor="error"
          ativo={filtros.situacao === 'vermelho'}
          onClick={() => alternarCartao('vermelho')}
        />
        <CartaoResumo
          rotulo="Vence em até 3 dias"
          total={resumo?.vence_em_3_dias ?? 0}
          cor="atencao"
          ativo={filtros.situacao === 'amarelo'}
          onClick={() => alternarCartao('amarelo')}
        />
        <CartaoResumo
          rotulo="Dentro do prazo"
          total={resumo?.no_prazo ?? 0}
          cor="tertiary"
          ativo={filtros.situacao === 'verde'}
          onClick={() => alternarCartao('verde')}
        />
        <CartaoResumo
          rotulo="Priorizados pela Coordenação"
          total={resumo?.priorizados ?? 0}
          cor="primary"
          estrela
          ativo={Boolean(filtros.priorizados)}
          onClick={() => alternarCartao('priorizados')}
        />
      </section>

      {/*
        Barra de filtros no padrão da Consulta Unificada, que é a tela mais
        completa do projeto: a busca sozinha na primeira linha (para o campo não
        encolher até o texto vazar em tela de notebook) e os filtros numa grade
        abaixo, com o botão de limpar no fim.

        O filtro de vencimento fica no funil da coluna, e não aqui, para não
        repetir o mesmo filtro em dois lugares — é a divisão que a Consulta
        Unificada faz.
      */}
      <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant shadow-card space-y-3">
        <div className="flex items-center bg-surface-container-low rounded-lg px-3 py-2 w-full focus-within:ring-2 focus-within:ring-primary-container/30">
          <Icone nome="search" className="text-outline text-[20px] shrink-0" />
          <input
            type="search"
            className="bg-transparent border-none outline-none ml-2 w-full min-w-0 text-body-md placeholder:text-outline text-ellipsis"
            placeholder="Buscar por nº SEI, CPF/CNPJ ou interessado"
            value={filtros.busca ?? ''}
            onChange={(e) => atualizar('busca', e.target.value)}
            aria-label="Buscar prazo"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-end">
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
            <span className="text-label-sm text-on-surface-variant">Tipo de prazo</span>
            <select
              className={CLASSE_SELECT}
              value={filtros.tipo ?? ''}
              onChange={(e) => atualizar('tipo', e.target.value)}
              aria-label="Filtrar por tipo de prazo"
            >
              <option value="">Todos os tipos</option>
              {tipos.map((t) => (
                <option key={t.chave} value={t.chave}>{t.rotulo} ({t.dias}d)</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-label-sm text-on-surface-variant">Situação</span>
            <select
              className={CLASSE_SELECT}
              value={filtros.situacao ?? ''}
              onChange={(e) => atualizar('situacao', e.target.value as Semaforo | '')}
              aria-label="Filtrar por situação"
            >
              <option value="">Todas as situações</option>
              <option value="verde">No prazo</option>
              <option value="amarelo">Vence em breve</option>
              <option value="vermelho">Vencido</option>
            </select>
          </label>

          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-label-sm text-on-surface-variant">Responsável</span>
              <select
                className={CLASSE_SELECT}
                value={filtros.responsavel_id ?? ''}
                onChange={(e) =>
                  atualizar('responsavel_id', e.target.value ? Number(e.target.value) : null)
                }
                aria-label="Filtrar por responsável"
              >
                <option value="">Todos os responsáveis</option>
                {responsaveis.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
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

      {carregando && !dados && (
        <div className="flex items-center justify-center py-12 gap-3 text-on-surface-variant">
          <Icone nome="progress_activity" className="animate-spin text-[22px] text-primary" />
          <span className="text-body-lg">Carregando prazos...</span>
        </div>
      )}

      {/*
        O bloco dos modos é montado sempre que a resposta chegou, mesmo sem
        prazo no filtro. Antes ele dependia de `prazos.length > 0`, e o aviso de
        "nenhum prazo" ocupava a tela inteira: quem clicava em Calendário ou
        Semana não via nada acontecer. O calendário vazio ainda é resposta útil
        — mostra que o mês não tem vencimento —, e é o único jeito de navegar
        para outro mês.
      */}
      {!erro && dados && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-card overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between gap-3">
            <p className="text-body-md text-on-surface-variant">
              <span className="font-bold text-on-surface">{dados.total}</span>{' '}
              {dados.total === 1 ? 'prazo' : 'prazos'}
              {temFiltro ? ' (filtrado)' : ''}
            </p>
            {carregando && (
              <span className="inline-flex items-center gap-1.5 text-label-sm text-on-surface-variant">
                <Icone nome="progress_activity" className="animate-spin text-[16px] text-primary" />
                Atualizando
              </span>
            )}
          </div>

          {modo === 'lista' &&
            (prazos.length > 0 ? (
              <PrazosLista
                prazos={prazos}
                podePriorizar={dados.pode_priorizar}
                onAtualizar={buscar}
                onAbrirProcesso={(id) => navigate(`/processos/${id}`)}
                filtros={filtros}
                onFiltrar={(mudanca) => setFiltros((f) => ({ ...f, ...mudanca }))}
              />
            ) : (
              <div className="p-10 text-center text-on-surface-variant">
                <Icone nome="event_available" className="text-4xl text-outline-variant" />
                <p className="mt-2">Nenhum prazo em curso para os filtros atuais.</p>
              </div>
            ))}
          {modo === 'calendario' && (
            <PrazosCalendario
              prazos={prazos}
              onAbrirProcesso={(id) => navigate(`/processos/${id}`)}
            />
          )}
          {modo === 'semana' && (
            <PrazosSemana
              prazos={prazos}
              onAbrirProcesso={(id) => navigate(`/processos/${id}`)}
            />
          )}
        </div>
      )}

      {/* Legenda do semáforo e das regras de contagem */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <p className="text-label-lg text-on-surface mb-2">Semáforo de prazos</p>
          <ul className="space-y-1 text-body-md text-on-surface-variant">
            <li className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-tertiary" />
              Verde — dentro do prazo (4 dias ou mais para vencer)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-atencao-dim" />
              Amarelo — dia do vencimento ou até 3 dias para vencer
            </li>
            <li className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-error" />
              Vermelho — prazo vencido
            </li>
          </ul>
        </div>
        <div className="text-body-md text-on-surface-variant space-y-1">
          <p className="flex items-start gap-1 text-primary">
            <Icone nome="star" className="text-[16px] mt-0.5 shrink-0" />
            Processo priorizado pela Coordenação para toda a equipe.
          </p>
          <p>
            Contagem legal (Lei 10.177/1998): exclui o dia inicial, inclui o dia final e
            prorroga o vencimento para o primeiro dia útil; os prazos são contínuos.
          </p>
          <p className="text-[11px] text-outline">
            Os alertas de vencimento são internos e servem ao acompanhamento gerencial.
          </p>
        </div>
      </div>
    </div>
  )
}

function CartaoResumo({
  rotulo, total, cor, ativo, onClick, estrela = false,
}: {
  rotulo: string
  total: number
  cor: 'error' | 'atencao' | 'tertiary' | 'primary'
  ativo: boolean
  onClick: () => void
  estrela?: boolean
}) {
  const pontos = {
    error: 'bg-error',
    atencao: 'bg-atencao-dim',
    tertiary: 'bg-tertiary',
    primary: 'bg-primary',
  }
  const textos = {
    error: 'text-error',
    atencao: 'text-atencao',
    tertiary: 'text-tertiary',
    primary: 'text-primary',
  }
  const bordas = {
    error: 'border-error ring-error/20 bg-error-container/20',
    atencao: 'border-atencao ring-atencao/20 bg-atencao-container/40',
    tertiary: 'border-tertiary ring-tertiary/20 bg-tertiary-fixed/20',
    primary: 'border-primary ring-primary/20 bg-primary-fixed/20',
  }

  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={`rounded-xl p-4 border text-left transition-all ${
        ativo
          ? `ring-2 ${bordas[cor]}`
          : 'border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low'
      }`}
    >
      <div className="flex items-center gap-2">
        {estrela ? (
          <Icone nome="star" className={`text-[18px] ${textos[cor]}`} />
        ) : (
          <span className={`w-2.5 h-2.5 rounded-full ${pontos[cor]}`} />
        )}
        <span className={`text-headline-sm font-bold ${textos[cor]}`}>{total}</span>
      </div>
      <p className="text-label-md text-on-surface-variant mt-1">{rotulo}</p>
    </button>
  )
}
