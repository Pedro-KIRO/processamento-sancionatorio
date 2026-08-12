import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { FiltroColuna } from '../../components/FiltroColuna'
import { Icone } from '../../components/Icone'
import { formatarData, formatarRazaoSocial, formatarTexto, mascararDocumento } from '../../lib/format'
import { FUNDO_LINHA_SEMAFORO, TEXTO_SEMAFORO } from '../../lib/semaforo'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { getMe, type Usuario } from '../me/api'
import {
  aprovarCautelar,
  juntarCertidao,
  juntarCertidaoDesbloqueio,
  listarCautelares,
  marcarAssinaturaConcluida,
  obterResumoCautelares,
  recusarCautelar,
  renovarCautelar,
  revogarCautelar,
} from './api'
import type { Cautelar, CautelarResumo, StatusBloqueio } from './types'

type FiltroSituacao = '' | 'vigente' | 'vencendo' | 'vencida' | 'revogada'

/* Mesmas cores do semáforo da tela de Prazos, por exigência do documento. O
   amarelo de "vencendo" usava `secondary`, que nesta paleta é azul. */
const SITUACAO_CLASSE: Record<string, string> = {
  vigente: 'bg-tertiary-fixed/30 text-tertiary',
  vencendo: 'bg-atencao-container text-atencao',
  vencida: 'bg-error-container text-on-error-container',
  renovada: 'bg-surface-container-high text-on-surface-variant',
  revogada: 'bg-surface-container-high text-on-surface-variant',
}

const SITUACAO_LABEL: Record<string, string> = {
  vigente: 'Vigente',
  vencendo: 'Vencendo',
  vencida: 'Vencida',
  renovada: 'Renovada',
  revogada: 'Revogada',
}

const BLOQUEIO_CLASSE: Record<StatusBloqueio, string> = {
  ativo: 'bg-tertiary-fixed/30 text-tertiary',
  revisar: 'bg-error-container text-on-error-container',
  revogado: 'bg-surface-container-high text-on-surface-variant',
}

const BLOQUEIO_LABEL: Record<StatusBloqueio, string> = {
  ativo: 'Ativo',
  revisar: 'Revisar',
  revogado: 'Revogado',
}

/*
  Sem `whitespace-nowrap`: rótulo comprido como "Contagem regressiva" pode
  quebrar em duas linhas no cabeçalho. Com o nowrap ele forçava a coluna a ter a
  largura do texto inteiro, e era uma das razões da barra de rolagem lateral.
*/
const CLASSE_TH =
  'px-3 py-3 text-label-sm uppercase text-on-surface-variant tracking-wider bg-surface-container-low align-bottom'

const PRAZOS = [30, 45, 60, 90]

const CLASSE_CAMPO_FILTRO =
  'w-full bg-white border border-outline-variant rounded px-2 py-1.5 text-[12px] text-on-surface-variant'

/** Caixas de seleção da barra de filtros, iguais às da Consulta Unificada. */
const CLASSE_SELECT =
  'w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md ' +
  'text-on-surface-variant focus:outline-none focus:ring-2 focus:ring-primary-container/40'

/** Colunas pelas quais a tabela de cautelares ordena. */
type CampoCautelar =
  | 'numero_sei_processo'
  | 'razao_social'
  | 'agente_regulado'
  | 'data_inicio'
  | 'prazo_dias'
  | 'data_fim'
  | 'dias_restantes'
  | 'status_bloqueio'
  | 'defesa_apresentada'
  | 'unidade_responsavel'
  | 'situacao'

interface OrdemCautelar {
  campo: CampoCautelar
  asc: boolean
}

/* Ordem operacional, não alfabética: quem exige decisão primeiro. */
const PESO_BLOQUEIO: Record<string, number> = { revisar: 0, ativo: 1, revogado: 2 }
const PESO_SITUACAO: Record<string, number> = {
  vencida: 0, vencendo: 1, vigente: 2, renovada: 3, revogada: 4,
}

function valorCautelar(c: Cautelar, campo: CampoCautelar): string | number {
  if (campo === 'dias_restantes') return c.dias_restantes ?? Number.MAX_SAFE_INTEGER
  if (campo === 'prazo_dias') return c.prazo_dias ?? 0
  if (campo === 'defesa_apresentada') return c.defesa_apresentada ? 0 : 1
  if (campo === 'status_bloqueio') return PESO_BLOQUEIO[c.status_bloqueio ?? 'ativo'] ?? 9
  if (campo === 'situacao') return PESO_SITUACAO[c.situacao ?? ''] ?? 9
  // Datas vêm em 'YYYY-MM-DD', que já ordena corretamente como texto.
  return (c[campo] ?? '').toString().toLocaleLowerCase('pt-BR')
}

/**
 * Cabeçalho da coluna: rótulo clicável para ordenar e, quando há filtro, o
 * ícone de funil ao lado. Declarado fora do componente da página para o React
 * não remontar o cabeçalho inteiro a cada clique.
 */
function ColunaCautelar({
  campo, rotulo, ordem, onAlternar, titulo, alinharCentro = false, children,
}: {
  campo: CampoCautelar
  rotulo: string
  ordem: OrdemCautelar | null
  onAlternar: (campo: CampoCautelar) => void
  titulo?: string
  alinharCentro?: boolean
  children?: React.ReactNode
}) {
  const ativa = ordem?.campo === campo
  return (
    <th
      className={`${CLASSE_TH}${alinharCentro ? ' text-center' : ''}`}
      title={titulo}
      aria-sort={ativa ? (ordem.asc ? 'ascending' : 'descending') : 'none'}
    >
      <div className={`flex items-center gap-1${alinharCentro ? ' justify-center' : ''}`}>
        <button
          onClick={() => onAlternar(campo)}
          className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-primary ${
            ativa ? 'text-primary' : ''
          }`}
          title={`Ordenar por ${rotulo}`}
        >
          {rotulo}
          <Icone
            nome={ativa ? (ordem.asc ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
            className={`text-[14px] ${ativa ? 'text-primary' : 'text-outline-variant'}`}
          />
        </button>
        {children}
      </div>
    </th>
  )
}

/**
 * Controle de Cautelares Aplicadas (Documentação de Negócio v3.0).
 *
 * Tela de acompanhamento prioritário: os agentes com cautelar estão bloqueados
 * e impedidos de operar. A regra crítica é a defesa apresentada por agente
 * bloqueado — nesse caso a linha é marcada com ⚑, sobe ao topo da fila e a
 * ação "Analisar revogação" abre o processo, porque a demora recai direto
 * sobre o agente.
 *
 * Competência: a aplicação, a renovação e a revogação são exclusivas do
 * Coordenador Geral (art. 62, parágrafo único, da Lei 10.177/1998); a tela
 * esconde as ações de quem não tem o perfil, e o backend recusa de todo modo.
 *
 * Nomes das colunas conforme o texto do documento: Processo (SEI), Interessado,
 * Agente regulado, Data de aplicação, Prazo, Vencimento, Contagem regressiva,
 * Status do bloqueio, Defesa apresentada? e Ações. Filtro por coluna no ícone de
 * funil e cabeçalho ordenável, como nas outras tabelas do projeto; a busca livre
 * fica na primeira posição da barra acima.
 */
export function CautelaresPage() {
  useDocumentTitle('Medidas Cautelares')
  const navigate = useNavigate()

  const [resumo, setResumo] = useState<CautelarResumo>({
    vigentes: 0, vencendo: 0, vencidas: 0, defesa_apresentada: 0, aguardando_aprovacao: 0,
  })
  const [cautelares, setCautelares] = useState<Cautelar[]>([])
  const [filtro, setFiltro] = useState<FiltroSituacao>('')
  const [somenteComDefesa, setSomenteComDefesa] = useState(false)
  const [filtroUnidade, setFiltroUnidade] = useState('')
  const [busca, setBusca] = useState('')
  // Filtros de coluna. Ficam no ícone de funil do cabeçalho, como nas outras
  // tabelas; antes esta tela só tinha a busca livre.
  const [filtroAgente, setFiltroAgente] = useState('')
  const [filtroPrazo, setFiltroPrazo] = useState('')
  const [filtroBloqueio, setFiltroBloqueio] = useState('')
  const [vencDe, setVencDe] = useState('')
  const [vencAte, setVencAte] = useState('')
  const [ordem, setOrdem] = useState<OrdemCautelar | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [me, setMe] = useState<Usuario | null>(null)

  // Modais
  const [renovandoId, setRenovandoId] = useState<number | null>(null)
  const [prazoRenovacao, setPrazoRenovacao] = useState(30)
  const [certidaoId, setCertidaoId] = useState<number | null>(null)
  const [certidaoDesbloqueioId, setCertidaoDesbloqueioId] = useState<number | null>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [motivoId, setMotivoId] = useState<number | null>(null)
  const [motivoAcao, setMotivoAcao] = useState<'recusar' | 'revogar'>('revogar')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  const podeDecidir = Boolean(me?.coordenador_geral)

  function carregar() {
    setCarregando(true)
    setErro(null)
    Promise.all([obterResumoCautelares(), listarCautelares()])
      .then(([r, lista]) => {
        setResumo(r)
        setCautelares(lista)
      })
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)))
      .finally(() => setCarregando(false))
  }

  useEffect(() => {
    carregar()
    getMe().then(setMe).catch(() => setMe(null))
  }, [])

  const unidades = useMemo(
    () => [...new Set(cautelares.map((c) => c.unidade_responsavel).filter(Boolean))].sort(),
    [cautelares],
  )

  const agentesRegulados = useMemo(
    () => [...new Set(cautelares.map((c) => c.agente_regulado).filter(Boolean))].sort(),
    [cautelares],
  )

  const temFiltro = Boolean(
    filtro || busca || somenteComDefesa || filtroUnidade ||
    filtroAgente || filtroPrazo || filtroBloqueio || vencDe || vencAte,
  )

  function limparFiltros() {
    setBusca('')
    setFiltro('')
    setSomenteComDefesa(false)
    setFiltroUnidade('')
    setFiltroAgente('')
    setFiltroPrazo('')
    setFiltroBloqueio('')
    setVencDe('')
    setVencAte('')
  }

  /* Três estados por coluna: crescente, decrescente e volta à ordem do backend
     (defesa apresentada no topo, depois o vencimento mais próximo). */
  function alternarOrdem(campo: CampoCautelar) {
    setOrdem((o) => (o?.campo === campo ? (o.asc ? { campo, asc: false } : null) : { campo, asc: true }))
  }

  const itensFiltrados = useMemo(() => {
    let resultado = cautelares
    if (filtro) resultado = resultado.filter((c) => c.situacao === filtro)
    if (somenteComDefesa) resultado = resultado.filter((c) => c.defesa_apresentada)
    if (filtroUnidade) resultado = resultado.filter((c) => c.unidade_responsavel === filtroUnidade)
    if (filtroAgente) resultado = resultado.filter((c) => c.agente_regulado === filtroAgente)
    if (filtroPrazo) resultado = resultado.filter((c) => String(c.prazo_dias) === filtroPrazo)
    if (filtroBloqueio) {
      resultado = resultado.filter((c) => (c.status_bloqueio ?? 'ativo') === filtroBloqueio)
    }
    // Datas em 'YYYY-MM-DD' comparam corretamente como texto.
    if (vencDe) resultado = resultado.filter((c) => (c.data_fim ?? '') >= vencDe)
    if (vencAte) resultado = resultado.filter((c) => (c.data_fim ?? '') <= vencAte)
    if (busca.trim()) {
      const termo = busca.toLowerCase()
      const numerico = termo.replace(/\D/g, '')
      resultado = resultado.filter(
        (c) =>
          (c.numero_sei_processo ?? '').toLowerCase().includes(termo) ||
          (c.razao_social ?? '').toLowerCase().includes(termo) ||
          (numerico && (c.cnpj_cpf ?? '').replace(/\D/g, '').includes(numerico)) ||
          (c.unidade_responsavel ?? '').toLowerCase().includes(termo),
      )
    }

    if (ordem) {
      resultado = [...resultado].sort((a, b) => {
        const va = valorCautelar(a, ordem.campo)
        const vb = valorCautelar(b, ordem.campo)
        if (va === vb) return 0
        const menor = va < vb ? -1 : 1
        return ordem.asc ? menor : -menor
      })
    }
    return resultado
  }, [
    cautelares, filtro, somenteComDefesa, filtroUnidade, busca,
    filtroAgente, filtroPrazo, filtroBloqueio, vencDe, vencAte, ordem,
  ])

  async function executar(acao: () => Promise<unknown>) {
    setEnviando(true)
    try {
      await acao()
      carregar()
      return true
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setEnviando(false)
    }
  }

  async function confirmarMotivo() {
    if (!motivoId || !motivo.trim()) return
    const ok = await executar(() =>
      motivoAcao === 'recusar'
        ? recusarCautelar(motivoId, motivo.trim())
        : revogarCautelar(motivoId, motivo.trim()),
    )
    if (ok) {
      setMotivoId(null)
      setMotivo('')
    }
  }

  async function confirmarCertidao(desbloqueio: boolean) {
    const id = desbloqueio ? certidaoDesbloqueioId : certidaoId
    if (!id || !arquivo) return
    const ok = await executar(() =>
      desbloqueio ? juntarCertidaoDesbloqueio(id, arquivo) : juntarCertidao(id, arquivo),
    )
    if (ok) {
      setCertidaoId(null)
      setCertidaoDesbloqueioId(null)
      setArquivo(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <nav className="flex items-center gap-2 text-label-sm text-outline mb-2">
          <a href="/" className="hover:text-primary hover:underline">Início</a>
          <Icone nome="chevron_right" className="text-[14px]" />
          <span className="text-primary font-bold">Medidas Cautelares</span>
        </nav>
        <h1 className="text-headline-lg text-primary">Cautelares Aplicadas</h1>
        <p className="text-body-lg text-on-surface-variant">
          Acompanhamento prioritário — agentes bloqueados e impedidos de operar.
        </p>
        <p className="text-body-sm text-outline mt-1">
          Aplicação, renovação e revogação: Coordenadoria Geral (art. 62, parágrafo único,
          da Lei Estadual nº 10.177/1998).
        </p>
      </div>

      {/* Cartões de resumo — também filtram a lista */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Cartao
          rotulo="Vigentes"
          total={resumo.vigentes}
          icone="verified_user"
          cor="tertiary"
          ativo={filtro === 'vigente'}
          onClick={() => { setFiltro(filtro === 'vigente' ? '' : 'vigente'); setSomenteComDefesa(false) }}
        />
        <Cartao
          rotulo="Vencendo (até 3 dias)"
          total={resumo.vencendo}
          icone="schedule"
          cor="atencao"
          ativo={filtro === 'vencendo'}
          onClick={() => { setFiltro(filtro === 'vencendo' ? '' : 'vencendo'); setSomenteComDefesa(false) }}
        />
        <Cartao
          rotulo="Vencidas / sem renovação"
          total={resumo.vencidas}
          icone="warning"
          cor="error"
          ativo={filtro === 'vencida'}
          onClick={() => { setFiltro(filtro === 'vencida' ? '' : 'vencida'); setSomenteComDefesa(false) }}
        />
        <Cartao
          rotulo="Defesa apresentada — revisar cautelar"
          total={resumo.defesa_apresentada}
          icone="flag"
          cor="primary"
          ativo={somenteComDefesa}
          onClick={() => { setSomenteComDefesa(!somenteComDefesa); setFiltro('') }}
        />
      </div>

      {resumo.aguardando_aprovacao > 0 && (
        <div className="flex items-start gap-3 bg-secondary-fixed/20 border border-secondary-container/30 rounded-lg px-4 py-3">
          <Icone nome="how_to_reg" className="text-secondary text-[20px] mt-0.5 shrink-0" />
          <p className="text-body-md text-on-surface-variant">
            <strong>{resumo.aguardando_aprovacao}</strong>{' '}
            {resumo.aguardando_aprovacao === 1 ? 'medida aguarda' : 'medidas aguardam'} a
            concordância do Coordenador Geral.
          </p>
        </div>
      )}

      {/*
        Barra de filtros no padrão da Consulta Unificada, que é a tela mais
        completa do projeto: busca sozinha na primeira linha (para o campo não
        encolher até o texto vazar em tela de notebook) e os filtros numa grade
        abaixo, com o limpar no fim.

        Esta tela ficou tempo demais só com a busca. O filtro de vencimento e o
        de defesa apresentada seguem no funil da coluna, para não repetir o mesmo
        filtro em dois lugares — é a divisão que a Consulta Unificada faz.
      */}
      <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant shadow-card space-y-3">
        <div className="flex items-center bg-surface-container-low rounded-lg px-3 py-2 w-full focus-within:ring-2 focus-within:ring-primary-container/30">
          <Icone nome="search" className="text-outline text-[20px] shrink-0" />
          <input
            type="search"
            className="bg-transparent border-none outline-none ml-2 w-full min-w-0 text-body-md placeholder:text-outline text-ellipsis"
            placeholder="Buscar por nº SEI, CNPJ/CPF, interessado ou unidade"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar cautelares"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-label-sm text-on-surface-variant">Situação</span>
            <select
              className={CLASSE_SELECT}
              value={filtro}
              onChange={(e) => { setFiltro(e.target.value as FiltroSituacao); setSomenteComDefesa(false) }}
              aria-label="Filtrar por situação da cautelar"
            >
              <option value="">Todas as situações</option>
              <option value="vigente">Vigente</option>
              <option value="vencendo">Vencendo</option>
              <option value="vencida">Vencida</option>
              <option value="revogada">Revogada</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-label-sm text-on-surface-variant">Agente regulado</span>
            <select
              className={CLASSE_SELECT}
              value={filtroAgente}
              onChange={(e) => setFiltroAgente(e.target.value)}
              aria-label="Filtrar por agente regulado"
            >
              <option value="">Todos os agentes</option>
              {agentesRegulados.map((a) => <option key={a} value={a!}>{a}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-label-sm text-on-surface-variant">Prazo da medida</span>
            <select
              className={CLASSE_SELECT}
              value={filtroPrazo}
              onChange={(e) => setFiltroPrazo(e.target.value)}
              aria-label="Filtrar por prazo da medida"
            >
              <option value="">Todos os prazos</option>
              {PRAZOS.map((p) => <option key={p} value={String(p)}>{p} dias</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-label-sm text-on-surface-variant">Status do bloqueio</span>
            <select
              className={CLASSE_SELECT}
              value={filtroBloqueio}
              onChange={(e) => setFiltroBloqueio(e.target.value)}
              aria-label="Filtrar por status do bloqueio"
            >
              <option value="">Todos os status</option>
              <option value="ativo">Ativo</option>
              <option value="revisar">Revisar</option>
              <option value="revogado">Revogado</option>
            </select>
          </label>

          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 flex-1 min-w-0">
              <span className="text-label-sm text-on-surface-variant">Unidade</span>
              <select
                className={CLASSE_SELECT}
                value={filtroUnidade}
                onChange={(e) => setFiltroUnidade(e.target.value)}
                aria-label="Filtrar por unidade responsável"
              >
                <option value="">Todas as unidades</option>
                {unidades.map((u) => <option key={u} value={u!}>{u}</option>)}
              </select>
            </label>
            <button
              onClick={limparFiltros}
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

      {carregando && cautelares.length === 0 && (
        <div className="flex items-center justify-center py-12 gap-3 text-on-surface-variant">
          <Icone nome="progress_activity" className="animate-spin text-[22px] text-primary" />
          <span className="text-body-lg">Carregando cautelares...</span>
        </div>
      )}
      {erro && (
        <p role="alert" className="bg-error-container text-on-error-container px-4 py-3 rounded-lg">
          Não foi possível carregar: {erro}
        </p>
      )}
      {!carregando && !erro && itensFiltrados.length === 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-10 text-center text-on-surface-variant">
          <Icone nome="gavel" className="text-4xl text-outline-variant" />
          <p className="mt-2">Nenhuma medida cautelar encontrada.</p>
        </div>
      )}

      {!erro && itensFiltrados.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-card overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between gap-3">
            <p className="text-body-md text-on-surface-variant">
              <span className="font-bold text-on-surface">{itensFiltrados.length}</span>{' '}
              {itensFiltrados.length === 1 ? 'cautelar' : 'cautelares'}
              {temFiltro ? ' (filtrado)' : ''}
            </p>
          </div>
          {/*
            Sem largura mínima na tabela: era o `min-w-[1180px]` que criava a
            barra de rolagem lateral, porque obrigava a tabela a ficar mais larga
            que a área disponível e impedia a coluna de Ações de quebrar os
            botões, que já têm `flex-wrap`. As outras tabelas do projeto não têm
            largura mínima, e é por isso que mostram tudo de uma vez.

            O `overflow-auto` fica como rede de segurança para janela muito
            estreita — melhor poder rolar do que perder coluna.
          */}
          <div className="overflow-auto max-h-[max(320px,calc(100vh-460px))]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <ColunaCautelar campo="numero_sei_processo" rotulo="Processo (SEI)" ordem={ordem} onAlternar={alternarOrdem} />
                  <ColunaCautelar campo="razao_social" rotulo="Interessado" ordem={ordem} onAlternar={alternarOrdem} />

                  <ColunaCautelar campo="agente_regulado" rotulo="Agente regulado" ordem={ordem} onAlternar={alternarOrdem} />
                  <ColunaCautelar campo="data_inicio" rotulo="Aplicação / prazo" ordem={ordem} onAlternar={alternarOrdem} />

                  <ColunaCautelar campo="data_fim" rotulo="Vencimento" ordem={ordem} onAlternar={alternarOrdem}>
                    <FiltroColuna
                      coluna="Vencimento"
                      ativo={Boolean(vencDe || vencAte)}
                      onLimpar={() => { setVencDe(''); setVencAte('') }}
                    >
                      <div className="space-y-2">
                        <label className="block">
                          <span className="text-[11px] text-on-surface-variant">De</span>
                          <input
                            type="date"
                            value={vencDe}
                            onChange={(e) => setVencDe(e.target.value)}
                            className={CLASSE_CAMPO_FILTRO}
                          />
                        </label>
                        <label className="block">
                          <span className="text-[11px] text-on-surface-variant">Até</span>
                          <input
                            type="date"
                            value={vencAte}
                            onChange={(e) => setVencAte(e.target.value)}
                            className={CLASSE_CAMPO_FILTRO}
                          />
                        </label>
                      </div>
                    </FiltroColuna>
                  </ColunaCautelar>

                  <ColunaCautelar campo="dias_restantes" rotulo="Contagem regressiva" ordem={ordem} onAlternar={alternarOrdem} />

                  <ColunaCautelar campo="status_bloqueio" rotulo="Bloqueio" ordem={ordem} onAlternar={alternarOrdem} />

                  <ColunaCautelar
                    campo="defesa_apresentada"
                    rotulo="Defesa?"
                    titulo="Defesa apresentada pelo agente bloqueado"
                    ordem={ordem}
                    onAlternar={alternarOrdem}
                  >
                    <FiltroColuna
                      coluna="Defesa apresentada"
                      ativo={somenteComDefesa}
                      onLimpar={() => setSomenteComDefesa(false)}
                    >
                      <label className="flex items-center gap-2 text-[12px] text-on-surface-variant">
                        <input
                          type="checkbox"
                          checked={somenteComDefesa}
                          onChange={(e) => { setSomenteComDefesa(e.target.checked); setFiltro('') }}
                        />
                        Só com defesa apresentada
                      </label>
                    </FiltroColuna>
                  </ColunaCautelar>

                  <ColunaCautelar campo="situacao" rotulo="Situação" ordem={ordem} onAlternar={alternarOrdem} />

                  <th className={`${CLASSE_TH} text-center`}>Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {itensFiltrados.map((c) => {
                  const bloqueio = c.status_bloqueio ?? 'ativo'
                  const pendenteAprovacao = (c.aprovacao ?? 'pendente') === 'pendente'
                  const revogada = Boolean(c.data_revogacao)
                  return (
                    <tr
                      key={c.id}
                      className={`transition-colors border-l-4 ${
                        c.defesa_apresentada
                          ? 'bg-error-container/15 border-l-error'
                          : c.situacao === 'vencida'
                            ? `${FUNDO_LINHA_SEMAFORO.vermelho} border-l-error`
                            : c.situacao === 'vencendo'
                              ? `${FUNDO_LINHA_SEMAFORO.amarelo} border-l-atencao-dim`
                              : revogada
                                ? 'border-l-outline-variant'
                                : 'hover:bg-surface-container-low/50 border-l-tertiary'
                      }`}
                    >
                      {/* `whitespace-nowrap`: o número do SEI quebrava em duas
                          linhas no meio, depois da barra. É um número único, tem
                          que ficar inteiro numa linha. */}
                      <td className="px-3 py-3 text-label-lg tabular-nums text-primary whitespace-nowrap">
                        {c.prioritario && (
                          <Icone nome="star" className="text-[14px] text-primary align-middle mr-1" />
                        )}
                        {c.numero_sei_processo ?? '-'}
                      </td>
                      <td
                        className="px-3 py-3 text-body-md text-on-surface-variant max-w-[170px] truncate"
                        title={c.razao_social ?? ''}
                      >
                        {formatarRazaoSocial(c.razao_social)}
                        {c.cnpj_cpf && (
                          <span className="block text-[11px] text-outline tabular-nums">
                            {mascararDocumento(c.cnpj_cpf)}
                          </span>
                        )}
                        {/* A unidade era uma coluna própria. Virou linha daqui:
                            o documento não a lista entre as colunas, e ela
                            continua disponível como filtro na barra. */}
                        {c.unidade_responsavel && (
                          <span className="block text-[11px] text-outline">
                            unidade {c.unidade_responsavel}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {c.agente_regulado && (
                          <span className="px-2 py-0.5 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant text-[11px] font-bold">
                            {formatarTexto(c.agente_regulado)}
                          </span>
                        )}
                      </td>
                      {/* Aplicação e prazo na mesma coluna: são o mesmo dado
                          lido junto ("aplicada em tal dia, por tantos dias"). */}
                      <td className="px-3 py-3 text-body-md text-on-surface-variant tabular-nums whitespace-nowrap">
                        {formatarData(c.data_inicio)}
                        <span className="block text-[11px] text-outline">
                          {c.prazo_dias ? `${c.prazo_dias} dias` : '-'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-body-md text-on-surface-variant tabular-nums whitespace-nowrap">
                        {formatarData(c.data_fim)}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`font-bold tabular-nums ${
                            c.semaforo ? TEXTO_SEMAFORO[c.semaforo] : 'text-on-surface-variant'
                          }`}
                        >
                          {c.dias_restantes === null || c.dias_restantes === undefined
                            ? '-'
                            : c.dias_restantes < 0
                              ? `${c.dias_restantes} dias`
                              : c.dias_restantes === 0
                                ? 'Vence hoje'
                                : `${c.dias_restantes} dias`}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${BLOQUEIO_CLASSE[bloqueio]}`}
                        >
                          {BLOQUEIO_LABEL[bloqueio]}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {c.defesa_apresentada ? (
                          <span className="inline-flex items-center gap-1 text-error font-bold text-[11px]">
                            <Icone nome="flag" className="text-[14px]" />
                            SIM
                          </span>
                        ) : (
                          <span className="text-[11px] text-outline">Não</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[11px] font-bold w-fit ${
                              SITUACAO_CLASSE[c.situacao ?? ''] ?? 'bg-outline-variant/40 text-on-surface-variant'
                            }`}
                          >
                            {SITUACAO_LABEL[c.situacao ?? ''] ?? c.situacao}
                          </span>
                          {pendenteAprovacao && !revogada && (
                            <span className="text-[10px] text-secondary font-bold">
                              Aguardando o Coordenador Geral
                            </span>
                          )}
                          {c.pendente_assinatura && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-secondary font-bold">
                              <Icone nome="draw" className="text-[12px]" />
                              Pendente de assinatura
                            </span>
                          )}
                          {c.aprovacao === 'recusada' && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] text-error font-bold"
                              title={c.motivo_recusa ?? ''}
                            >
                              <Icone nome="undo" className="text-[12px]" />
                              Cautelar recusada
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-center gap-1.5">
                          {/* Regra crítica: defesa apresentada abre o processo
                              no ponto da análise da revogação. */}
                          {c.defesa_apresentada && c.caixa_entrada_id && (
                            <button
                              onClick={() => navigate(`/processos/${c.caixa_entrada_id}`)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-white text-label-md hover:brightness-110"
                              title="Abrir o processo para decidir sobre a revogação"
                            >
                              <Icone nome="rule" className="text-[16px]" />
                              Analisar revogação
                            </button>
                          )}

                          {podeDecidir && pendenteAprovacao && !revogada && (
                            <>
                              <button
                                onClick={() => executar(() => aprovarCautelar(c.id))}
                                disabled={enviando}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-tertiary text-tertiary text-label-md hover:bg-tertiary-fixed/20 disabled:opacity-50"
                                title="Concordar e seguir para assinatura"
                              >
                                <Icone nome="check" className="text-[16px]" />
                                Concordar
                              </button>
                              <button
                                onClick={() => { setMotivoId(c.id); setMotivoAcao('recusar'); setMotivo('') }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-error text-error text-label-md hover:bg-error-container/30"
                                title="Recusar e devolver o processo à caixa de entrada"
                              >
                                <Icone nome="undo" className="text-[16px]" />
                                Recusar
                              </button>
                            </>
                          )}

                          {podeDecidir && !revogada && !pendenteAprovacao && (
                            <>
                              <button
                                onClick={() => { setRenovandoId(c.id); setPrazoRenovacao(30) }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary text-primary text-label-md hover:bg-primary-fixed/20"
                              >
                                <Icone nome="autorenew" className="text-[16px]" />
                                Renovar
                              </button>
                              <button
                                onClick={() => { setMotivoId(c.id); setMotivoAcao('revogar'); setMotivo('') }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-error text-error text-label-md hover:bg-error-container/30"
                              >
                                <Icone nome="block" className="text-[16px]" />
                                Revogar
                              </button>
                            </>
                          )}

                          {!revogada && !c.numero_sei_certidao && (
                            <button
                              onClick={() => { setCertidaoId(c.id); setArquivo(null) }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant text-label-md hover:bg-surface-container-high"
                              title="Juntar certidão de bloqueio com evidência de tela"
                            >
                              <Icone nome="attach_file" className="text-[16px]" />
                              Certidão
                            </button>
                          )}

                          {revogada && !c.numero_sei_certidao_desbloqueio && (
                            <button
                              onClick={() => { setCertidaoDesbloqueioId(c.id); setArquivo(null) }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant text-label-md hover:bg-surface-container-high"
                              title="Juntar certidão de desbloqueio com evidência"
                            >
                              <Icone nome="lock_open" className="text-[16px]" />
                              Desbloqueio
                            </button>
                          )}

                          {c.pendente_assinatura && (
                            <button
                              onClick={() => executar(() => marcarAssinaturaConcluida(c.id))}
                              disabled={enviando}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-secondary text-secondary text-label-md hover:bg-secondary-fixed/20 disabled:opacity-50"
                              title="Marcar como assinado no SEI"
                            >
                              <Icone nome="draw" className="text-[16px]" />
                              Assinado
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Regra crítica de acompanhamento */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant p-4 space-y-2">
        <p className="text-label-lg text-on-surface">Regra crítica de acompanhamento</p>
        <p className="text-body-md text-on-surface-variant">
          Quando o agente com cautelar apresenta defesa, o processo é sinalizado com{' '}
          <Icone nome="flag" className="text-[14px] text-error align-middle" /> e sobe ao topo da
          fila: a equipe deve analisar de imediato se é caso de revogar a medida, porque o agente
          está impedido de trabalhar.
        </p>
        <p className="text-body-md text-on-surface-variant">
          <strong>Fluxo:</strong> instauração com cautelar → concordância do Coordenador Geral →
          assinatura → certidão de bloqueio com evidência → acompanhamento do prazo. A recusa
          devolve o processo à caixa de entrada para reedição do termo sem a cautelar.
        </p>
        <p className="text-body-sm text-outline">
          Prazos: 30, 45, 60 ou 90 dias, renováveis antes do vencimento. Semáforo igual ao da tela
          de Prazos: verde a partir de 4 dias, amarelo até 3 dias, vermelho vencida.
        </p>
      </div>

      {/* Modal de renovação */}
      {renovandoId !== null && (
        <Modal titulo="Renovar Medida Cautelar" onFechar={() => setRenovandoId(null)}>
          <p className="text-body-md text-on-surface-variant mb-4">
            A nova cautelar terá início no dia seguinte ao vencimento da atual. Selecione o prazo:
          </p>
          <div className="grid grid-cols-4 gap-2 mb-6">
            {PRAZOS.map((dias) => (
              <button
                key={dias}
                onClick={() => setPrazoRenovacao(dias)}
                className={`py-3 rounded-lg text-label-lg font-bold transition-colors ${
                  prazoRenovacao === dias
                    ? 'bg-primary text-white'
                    : 'bg-surface-container-high text-on-surface-variant hover:bg-primary-fixed/30'
                }`}
              >
                {dias} dias
              </button>
            ))}
          </div>
          <AcoesModal
            onCancelar={() => setRenovandoId(null)}
            onConfirmar={async () => {
              const ok = await executar(() =>
                renovarCautelar(renovandoId, { prazo_dias: prazoRenovacao }),
              )
              if (ok) setRenovandoId(null)
            }}
            rotulo="Confirmar renovação"
            enviando={enviando}
          />
        </Modal>
      )}

      {/* Modal de motivo (recusa ou revogação) */}
      {motivoId !== null && (
        <Modal
          titulo={motivoAcao === 'recusar' ? 'Recusar Medida Cautelar' : 'Revogar Medida Cautelar'}
          onFechar={() => setMotivoId(null)}
        >
          <p className="text-body-md text-on-surface-variant mb-3">
            {motivoAcao === 'recusar'
              ? 'O processo volta à caixa de entrada marcado como cautelar recusada, para o termo ser reeditado sem a medida.'
              : 'A revogação exige fundamentação e gera a certidão de desbloqueio, que segue a mesma lógica de assinatura e evidência.'}
          </p>
          <label className="block mb-4">
            <span className="text-label-md text-on-surface-variant">
              {motivoAcao === 'recusar' ? 'Motivo da recusa' : 'Fundamentação da revogação'}
            </span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={4}
              autoFocus
              className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
            />
          </label>
          <AcoesModal
            onCancelar={() => setMotivoId(null)}
            onConfirmar={confirmarMotivo}
            rotulo={motivoAcao === 'recusar' ? 'Recusar' : 'Revogar'}
            enviando={enviando}
            desabilitado={!motivo.trim()}
          />
        </Modal>
      )}

      {/* Modais de certidão */}
      {(certidaoId !== null || certidaoDesbloqueioId !== null) && (
        <Modal
          titulo={certidaoDesbloqueioId !== null ? 'Juntar Certidão de Desbloqueio' : 'Juntar Certidão de Bloqueio'}
          onFechar={() => { setCertidaoId(null); setCertidaoDesbloqueioId(null) }}
        >
          <p className="text-body-md text-on-surface-variant mb-4">
            Anexe a certidão acompanhada da evidência de tela do sistema legado que comprove o
            {certidaoDesbloqueioId !== null ? ' desbloqueio' : ' bloqueio'} do agente.
          </p>
          <label className="block mb-4">
            <span className="text-label-md text-on-surface mb-1 block">Arquivo (PDF ou imagem)</span>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.tiff"
              onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
              className="w-full text-body-md file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-primary-container file:text-white file:font-bold file:cursor-pointer"
            />
          </label>
          {arquivo && (
            <p className="text-body-sm text-on-surface-variant mb-4">
              Selecionado: <span className="font-bold">{arquivo.name}</span>
            </p>
          )}
          <AcoesModal
            onCancelar={() => { setCertidaoId(null); setCertidaoDesbloqueioId(null) }}
            onConfirmar={() => confirmarCertidao(certidaoDesbloqueioId !== null)}
            rotulo="Juntar certidão"
            enviando={enviando}
            desabilitado={!arquivo}
          />
        </Modal>
      )}
    </div>
  )
}

function Cartao({
  rotulo, total, icone, cor, ativo, onClick,
}: {
  rotulo: string
  total: number
  icone: string
  cor: 'tertiary' | 'atencao' | 'error' | 'primary'
  ativo: boolean
  onClick: () => void
}) {
  const textos = {
    tertiary: 'text-tertiary', atencao: 'text-atencao',
    error: 'text-error', primary: 'text-primary',
  }
  /*
    Todos os fundos são tinta clara, para o ícone escuro em cima ter contraste.
    Antes o cartão de vigentes usava `bg-tertiary-container` (#006a34, verde
    escuro) com ícone `text-tertiary` (#004f25) e o de defesa usava
    `bg-primary-container` (#005ca8) com ícone `text-primary` (#00447f): escuro
    sobre escuro, praticamente invisível. Os outros dois passavam porque o fundo
    deles já era claro.
  */
  const fundos = {
    tertiary: 'bg-tertiary-fixed/50', atencao: 'bg-atencao-container',
    error: 'bg-error-container', primary: 'bg-primary-fixed',
  }
  const ativos = {
    tertiary: 'border-tertiary ring-tertiary/20 bg-tertiary-fixed/20',
    atencao: 'border-atencao ring-atencao/20 bg-atencao-container/40',
    error: 'border-error ring-error/20 bg-error-container/20',
    primary: 'border-primary ring-primary/20 bg-primary-fixed/20',
  }
  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={`rounded-xl p-4 border text-left transition-all ${
        ativo ? `ring-2 ${ativos[cor]}` : 'border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className={`w-8 h-8 rounded-full ${fundos[cor]} flex items-center justify-center shrink-0`}>
          <Icone nome={icone} className={`${textos[cor]} text-[18px]`} />
        </div>
        <span className={`text-headline-sm font-bold ${textos[cor]}`}>{total}</span>
      </div>
      <p className="text-label-md text-on-surface-variant">{rotulo}</p>
    </button>
  )
}

function Modal({
  titulo, onFechar, children,
}: {
  titulo: string
  onFechar: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onFechar}>
      <div
        className="bg-surface-container-lowest rounded-2xl p-6 w-full max-w-md shadow-xl border border-outline-variant"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-headline-sm text-primary mb-4">{titulo}</h2>
        {children}
      </div>
    </div>
  )
}

function AcoesModal({
  onCancelar, onConfirmar, rotulo, enviando, desabilitado = false,
}: {
  onCancelar: () => void
  onConfirmar: () => void
  rotulo: string
  enviando: boolean
  desabilitado?: boolean
}) {
  return (
    <div className="flex justify-end gap-3">
      <button
        onClick={onCancelar}
        className="px-4 py-2 rounded-lg text-label-lg text-on-surface-variant hover:bg-surface-container-high"
      >
        Cancelar
      </button>
      <button
        onClick={onConfirmar}
        disabled={enviando || desabilitado}
        className="px-5 py-2 rounded-lg bg-primary text-white text-label-lg font-bold hover:brightness-110 disabled:opacity-50 inline-flex items-center gap-2"
      >
        {enviando && <Icone nome="progress_activity" className="animate-spin text-[16px]" />}
        {enviando ? 'Enviando...' : rotulo}
      </button>
    </div>
  )
}
