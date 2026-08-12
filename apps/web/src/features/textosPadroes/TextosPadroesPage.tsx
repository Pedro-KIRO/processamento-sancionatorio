import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError } from '../../api/client'
import { EditorDocumento, type EditorDocumentoRef } from '../../components/EditorDocumento'
import { Icone } from '../../components/Icone'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import {
  definirPadrao,
  alterarAgente,
  alterarNomeArvore,
  listarAgentes,
  listarFuncoes,
  listarTextosPadroes,
  obterTextoPadrao,
  removerPadrao,
  renomearRotulo,
  restaurarOriginal,
  salvarTextoPadrao,
} from './api'
import type { FuncaoResumo, TextoPadraoDetalhe, TextoPadraoResumo } from './types'

/**
 * Tela da coordenação para os textos-padrão do app.
 *
 * Cada função do fluxo (saneador, arquivamento de relatório...) tem mais de uma
 * variante — quatro saneadores de autoescola, nove arquivamentos de relatório de
 * perito. Aqui a coordenação ajusta o texto e escolhe qual variante é o padrão,
 * que é a que vem selecionada para o analista no app inteiro.
 *
 * O texto original do SEI é preservado: dá para comparar e voltar atrás. E,
 * enquanto o modelo estiver editado aqui, a reimportação dos textos-padrão não
 * sobrescreve o ajuste.
 */

/** Variáveis que o app troca sozinho ao gerar o documento. */
const VARIAVEIS_AUTOMATICAS = [
  { marcador: '@dia@', descricao: 'dia da geração' },
  { marcador: '@mes_extenso@', descricao: 'mês por extenso' },
  { marcador: '@ano@', descricao: 'ano' },
  { marcador: '@data_extenso@', descricao: 'data completa por extenso' },
  { marcador: '@numero_processo@', descricao: 'número SEI do processo' },
  { marcador: '@razao_social@', descricao: 'razão social do agente, em maiúsculas' },
  { marcador: '@cnpj_cpf@', descricao: 'CNPJ ou CPF' },
  { marcador: '@dias_prazo@', descricao: 'prazo em dias' },
]

export function TextosPadroesPage() {
  useDocumentTitle('Textos-padrão')
  const [itens, setItens] = useState<TextoPadraoResumo[]>([])
  const [agentes, setAgentes] = useState<string[]>([])
  const [funcoes, setFuncoes] = useState<FuncaoResumo[]>([])
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)

  const [filtroAgente, setFiltroAgente] = useState('')
  const [filtroFuncao, setFiltroFuncao] = useState('')
  const [busca, setBusca] = useState('')
  const [somenteEditados, setSomenteEditados] = useState(false)

  const [selecionado, setSelecionado] = useState<TextoPadraoDetalhe | null>(null)
  const [carregandoItem, setCarregandoItem] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [alterado, setAlterado] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [mostrarOriginal, setMostrarOriginal] = useState(false)

  const editorRef = useRef<EditorDocumentoRef>(null)

  const recarregarLista = useCallback(async () => {
    setCarregandoLista(true)
    setErroLista(null)
    try {
      const dados = await listarTextosPadroes({
        agente: filtroAgente || undefined,
        funcao: filtroFuncao || undefined,
        busca: busca || undefined,
        somenteEditados,
      })
      setItens(dados)
    } catch (e) {
      setErroLista(e instanceof ApiError ? e.message : String(e))
      setItens([])
    } finally {
      setCarregandoLista(false)
    }
  }, [filtroAgente, filtroFuncao, busca, somenteEditados])

  useEffect(() => {
    listarAgentes().then(setAgentes).catch(() => setAgentes([]))
  }, [])

  useEffect(() => {
    listarFuncoes(filtroAgente || undefined)
      .then(setFuncoes)
      .catch(() => setFuncoes([]))
  }, [filtroAgente])

  useEffect(() => {
    const timer = window.setTimeout(recarregarLista, 300)
    return () => window.clearTimeout(timer)
  }, [recarregarLista])

  /** Agrupa por função para a lista ficar navegável: são 209 modelos. */
  const grupos = useMemo(() => {
    const mapa = new Map<string, { titulo: string; itens: TextoPadraoResumo[] }>()
    for (const item of itens) {
      const grupo = mapa.get(item.funcao) ?? { titulo: item.funcao_titulo, itens: [] }
      grupo.itens.push(item)
      mapa.set(item.funcao, grupo)
    }
    return [...mapa.entries()].sort((a, b) => a[1].titulo.localeCompare(b[1].titulo))
  }, [itens])

  async function abrir(id: number) {
    if (alterado && !window.confirm('Há alterações não salvas. Descartar?')) return
    setCarregandoItem(true)
    setAviso(null)
    setMostrarOriginal(false)
    try {
      const detalhe = await obterTextoPadrao(id)
      setSelecionado(detalhe)
      setAlterado(false)
      // O editor só existe depois deste render, por isso a espera de um tick.
      window.setTimeout(() => editorRef.current?.definirHtml(detalhe.template_html), 0)
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : String(e) })
    } finally {
      setCarregandoItem(false)
    }
  }

  function aplicarDetalhe(detalhe: TextoPadraoDetalhe, mensagem: string) {
    setSelecionado(detalhe)
    setAlterado(false)
    editorRef.current?.definirHtml(detalhe.template_html)
    setAviso({ tipo: 'ok', texto: mensagem })
    void recarregarLista()
  }

  async function salvar() {
    if (!selecionado) return
    const html = editorRef.current?.obterHtml() ?? ''
    if (!html.trim()) {
      setAviso({ tipo: 'erro', texto: 'O texto do modelo não pode ficar vazio.' })
      return
    }
    setSalvando(true)
    setAviso(null)
    try {
      const detalhe = await salvarTextoPadrao(selecionado.id, html)
      aplicarDetalhe(detalhe, 'Texto salvo. Passa a valer para o app inteiro.')
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : String(e) })
    } finally {
      setSalvando(false)
    }
  }

  async function restaurar() {
    if (!selecionado) return
    if (
      !window.confirm(
        'Voltar ao texto como veio do SEI? A edição feita aqui será descartada.',
      )
    ) {
      return
    }
    setSalvando(true)
    setAviso(null)
    try {
      const detalhe = await restaurarOriginal(selecionado.id)
      aplicarDetalhe(detalhe, 'Texto original do SEI restaurado.')
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : String(e) })
    } finally {
      setSalvando(false)
    }
  }

  async function alternarPadrao() {
    if (!selecionado) return
    setSalvando(true)
    setAviso(null)
    try {
      if (selecionado.padrao) {
        await removerPadrao(selecionado.id)
        setSelecionado({ ...selecionado, padrao: false })
        setAviso({
          tipo: 'ok',
          texto: 'Marca removida. Sem padrão, vale a ordem alfabética.',
        })
      } else {
        await definirPadrao(selecionado.id)
        setSelecionado({ ...selecionado, padrao: true })
        setAviso({
          tipo: 'ok',
          texto: `Padrão de "${selecionado.funcao_titulo}" para ${selecionado.agente_regulado}.`,
        })
      }
      void recarregarLista()
    } catch (e) {
      setAviso({ tipo: 'erro', texto: e instanceof ApiError ? e.message : String(e) })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="space-y-stack-md">
      <header>
        <nav className="flex items-center gap-2 text-label-sm text-outline mb-2">
          <a href="/" className="hover:text-primary hover:underline">Início</a>
          <Icone nome="chevron_right" className="text-[14px]" />
          <span className="text-primary font-bold">Textos-padrão</span>
        </nav>
        <h1 className="text-headline-lg text-primary">Textos-padrão</h1>
        <p className="text-body-lg text-on-surface-variant">
          Modelos de documento que o app usa para gerar os despachos, certidões e
          termos. O texto salvo aqui vale para o app inteiro.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(300px,26rem)_1fr] gap-stack-md items-start">
        <section className="bg-surface-container-lowest rounded-lg shadow-card p-stack-md space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="text-label-md text-on-surface-variant">Agente</span>
              <select
                value={filtroAgente}
                onChange={(e) => {
                  setFiltroAgente(e.target.value)
                  setFiltroFuncao('')
                }}
                className="w-full mt-1 border border-outline-variant rounded-lg px-2 py-1.5 text-body-md bg-white"
              >
                <option value="">Todos</option>
                {agentes.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-label-md text-on-surface-variant">Documento</span>
              <select
                value={filtroFuncao}
                onChange={(e) => setFiltroFuncao(e.target.value)}
                className="w-full mt-1 border border-outline-variant rounded-lg px-2 py-1.5 text-body-md bg-white"
              >
                <option value="">Todos</option>
                {funcoes.map((f) => (
                  <option key={f.funcao} value={f.funcao}>
                    {f.titulo} ({f.quantidade})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="sr-only">Buscar modelo</span>
            <div className="relative">
              <Icone
                nome="search"
                className="absolute left-2 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant"
              />
              <input
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar pelo nome do modelo"
                className="w-full border border-outline-variant rounded-lg pl-8 pr-2 py-1.5 text-body-md"
              />
            </div>
          </label>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-body-md text-on-surface">
              <input
                type="checkbox"
                checked={somenteEditados}
                onChange={(e) => setSomenteEditados(e.target.checked)}
              />
              Só os editados aqui
            </label>
            <span className="text-label-md text-on-surface-variant">
              Total: {itens.length}
            </span>
          </div>

          <div className="max-h-[62vh] overflow-y-auto -mx-2 px-2">
            {carregandoLista && (
              <p className="flex items-center gap-2 text-body-md text-on-surface-variant py-6">
                <Icone nome="progress_activity" className="animate-spin text-[18px]" />
                Carregando modelos...
              </p>
            )}

            {erroLista && (
              <div
                className="bg-error-container text-on-error-container px-3 py-2 rounded-lg text-body-md"
                role="alert"
              >
                {erroLista}
              </div>
            )}

            {!carregandoLista && !erroLista && itens.length === 0 && (
              <p className="text-body-md text-on-surface-variant py-6">
                Nenhum modelo com esses filtros.
              </p>
            )}

            {grupos.map(([funcao, grupo]) => (
              <div key={funcao} className="mb-3">
                <h3 className="text-label-lg text-on-surface-variant uppercase tracking-wide py-1">
                  {grupo.titulo}
                </h3>
                <ul className="space-y-1">
                  {grupo.itens.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => abrir(item.id)}
                        aria-current={selecionado?.id === item.id}
                        className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors ${
                          selecionado?.id === item.id
                            ? 'bg-secondary-container/40 border border-primary'
                            : 'hover:bg-surface-container-high border border-transparent'
                        }`}
                      >
                        <span className="block text-body-md text-on-surface">
                          {item.rotulo}
                        </span>
                        <span className="flex flex-wrap items-center gap-1 mt-0.5">
                          <Etiqueta texto={item.agente_regulado} />
                          {item.padrao && <Etiqueta texto="Padrão" destaque />}
                          {item.editado && <Etiqueta texto="Editado" />}
                          {item.divergente_do_original && (
                            <Etiqueta texto="Mudou no SEI" alerta />
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-surface-container-lowest rounded-lg shadow-card p-stack-md space-y-3 min-h-[40vh]">
          {carregandoItem && (
            <p className="flex items-center gap-2 text-body-md text-on-surface-variant">
              <Icone nome="progress_activity" className="animate-spin text-[18px]" />
              Carregando o texto...
            </p>
          )}

          {!selecionado && !carregandoItem && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Icone nome="description" className="text-5xl text-on-surface-variant" />
              <p className="text-body-lg text-on-surface">
                Escolha um modelo à esquerda para ver e editar o texto.
              </p>
            </div>
          )}

          {selecionado && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-title-lg text-on-surface">
                    {selecionado.funcao_titulo}
                  </h3>
                  <p className="text-body-md text-on-surface-variant">
                    {selecionado.rotulo} · {selecionado.agente_regulado}
                    {selecionado.nome_arvore && ` · no SEI: ${selecionado.nome_arvore}`}
                  </p>
                  {/* Seletor de agente regulado */}
                  <div className="flex items-center gap-2 mt-2">
                    <label className="text-label-md text-on-surface-variant shrink-0">Agente:</label>
                    <select
                      value={selecionado.agente_regulado}
                      onChange={async (e) => {
                        const novoAgente = e.target.value
                        if (novoAgente === selecionado.agente_regulado) return
                        if (!window.confirm(`Mudar o agente deste modelo para "${novoAgente}"?`)) return
                        setSalvando(true)
                        setAviso(null)
                        try {
                          await alterarAgente(selecionado.id, novoAgente)
                          setSelecionado({ ...selecionado, agente_regulado: novoAgente })
                          setAviso({ tipo: 'ok', texto: `Agente alterado para "${novoAgente}".` })
                          void recarregarLista()
                        } catch (err) {
                          setAviso({ tipo: 'erro', texto: err instanceof ApiError ? err.message : String(err) })
                        } finally {
                          setSalvando(false)
                        }
                      }}
                      disabled={salvando}
                      className="border border-outline-variant rounded-lg px-2 py-1 text-body-md bg-white min-w-[160px]"
                    >
                      <option value="Qualquer">Qualquer (global)</option>
                      {agentes.filter((a) => a !== 'Qualquer').map((a) => (
                        <option key={a} value={a}>{a}</option>
                      ))}
                    </select>
                  </div>
                  {selecionado.editado && selecionado.editado_em && (
                    <p className="text-label-md text-on-surface-variant mt-1">
                      Editado em{' '}
                      {new Date(selecionado.editado_em).toLocaleString('pt-BR')}
                      {selecionado.editado_por && ` por ${selecionado.editado_por}`}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={alternarPadrao}
                    disabled={salvando}
                    className={`px-3 py-2 rounded-lg text-label-lg inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                      selecionado.padrao
                        ? 'bg-secondary-container text-on-secondary-container'
                        : 'border border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                    title={
                      selecionado.padrao
                        ? 'Remover a marca de padrão'
                        : 'Usar este modelo como padrão desta ação para este agente'
                    }
                  >
                    <Icone
                      nome={selecionado.padrao ? 'push_pin' : 'push_pin'}
                      className="text-[18px]"
                    />
                    {selecionado.padrao ? 'É o padrão' : 'Definir como padrão'}
                  </button>

                  {selecionado.editado && (
                    <button
                      type="button"
                      onClick={restaurar}
                      disabled={salvando}
                      className="px-3 py-2 rounded-lg text-label-lg border border-outline-variant text-on-surface-variant hover:bg-surface-container-high transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                      title="Voltar ao texto como veio do SEI"
                    >
                      <Icone nome="restore" className="text-[18px]" />
                      Restaurar original
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={salvar}
                    disabled={salvando || !alterado}
                    className="px-4 py-2 rounded-lg text-label-lg bg-primary text-white hover:bg-primary-container transition-colors shadow-card disabled:opacity-50 inline-flex items-center gap-1.5"
                    title={alterado ? undefined : 'Nada foi alterado'}
                  >
                    {salvando && (
                      <Icone nome="progress_activity" className="animate-spin text-[18px]" />
                    )}
                    {salvando ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>

              {aviso && (
                <div
                  role="alert"
                  className={`px-3 py-2 rounded-lg text-body-md ${
                    aviso.tipo === 'ok'
                      ? 'bg-secondary-container/30 text-on-surface'
                      : 'bg-error-container text-on-error-container'
                  }`}
                >
                  {aviso.texto}
                </div>
              )}

              {selecionado.divergente_do_original && (
                <div
                  role="alert"
                  className="bg-tertiary-fixed/20 text-on-surface px-3 py-2 rounded-lg text-body-md"
                >
                  O texto oficial deste modelo mudou no SEI depois da edição feita
                  aqui. O app continua usando o texto desta tela. Compare com o
                  original e, se quiser adotar a versão nova, use "Restaurar
                  original".
                </div>
              )}

              <p className="text-body-md text-on-surface-variant">
                O SEI aplica sozinho o cabeçalho, o título e a assinatura — o texto
                vai só até a linha "São Paulo, @dia@ de @mes_extenso@ de @ano@.".
                Estas variáveis o app troca ao gerar o documento:{' '}
                {VARIAVEIS_AUTOMATICAS.map((v, i) => (
                  <span key={v.marcador}>
                    {i > 0 && ', '}
                    <code className="bg-surface-container-high px-1 rounded" title={v.descricao}>
                      {v.marcador}
                    </code>
                  </span>
                ))}
                . O que estiver entre colchetes fica para o analista preencher.
              </p>

              <EditorDocumento
                ref={editorRef}
                somenteLeitura={salvando}
                altura="58vh"
                rotulo={`Texto do modelo ${selecionado.rotulo}`}
                onAlterar={() => setAlterado(true)}
              />

              {selecionado.html_original && (
                <div>
                  <button
                    type="button"
                    onClick={() => setMostrarOriginal((v) => !v)}
                    className="text-label-lg text-primary hover:underline inline-flex items-center gap-1"
                    aria-expanded={mostrarOriginal}
                  >
                    <Icone
                      nome={mostrarOriginal ? 'expand_less' : 'expand_more'}
                      className="text-[18px]"
                    />
                    {mostrarOriginal ? 'Ocultar' : 'Ver'} o texto original do SEI
                  </button>
                  {mostrarOriginal && (
                    <div
                      className="doc-isolado mt-2 max-h-[40vh] overflow-y-auto border border-outline-variant rounded-lg"
                      dangerouslySetInnerHTML={{ __html: selecionado.html_original }}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function Etiqueta({
  texto,
  destaque = false,
  alerta = false,
}: {
  texto: string
  destaque?: boolean
  alerta?: boolean
}) {
  const cor = destaque
    ? 'bg-primary text-white'
    : alerta
      ? 'bg-tertiary-fixed/40 text-on-surface'
      : 'bg-surface-container-high text-on-surface-variant'
  return <span className={`text-label-md px-1.5 py-0.5 rounded ${cor}`}>{texto}</span>
}
