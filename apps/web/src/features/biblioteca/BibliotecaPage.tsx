import { useEffect, useRef, useState } from 'react'
import { Icone } from '../../components/Icone'
import { FiltroColuna } from '../../components/FiltroColuna'
import { EditorDocumento, type EditorDocumentoRef } from '../../components/EditorDocumento'
import { formatarData } from '../../lib/format'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import {
  atualizarItemBiblioteca,
  criarItemBiblioteca,
  enviarArquivoBiblioteca,
  excluirItemBiblioteca,
  listarBiblioteca,
  listarTemas,
  listarVersoes,
  obterItemBiblioteca,
  removerArquivoBiblioteca,
  restaurarVersao,
  urlPdfBiblioteca,
} from './api'
import {
  CLASSIFICACOES,
  ICONES_CLASSIFICACAO,
  LABELS_CLASSIFICACAO,
  LABELS_CURTOS,
  formatarTamanho,
  formularioVazio,
} from './types'
import type { ClassificacaoBiblioteca, FormularioBiblioteca, ItemBiblioteca, VersaoBiblioteca } from './types'

const CLASSE_TH = 'px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider bg-surface-container-low whitespace-nowrap'

export function BibliotecaPage() {
  useDocumentTitle('Biblioteca')

  const [itens, setItens] = useState<ItemBiblioteca[]>([])
  const [temas, setTemas] = useState<string[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Filtros
  const [aba, setAba] = useState<ClassificacaoBiblioteca | 'todas'>('todas')
  const [tema, setTema] = useState('')
  const [busca, setBusca] = useState('')

  // Item aberto e formulário
  const [selecionado, setSelecionado] = useState<ItemBiblioteca | null>(null)
  const [formAberto, setFormAberto] = useState(false)
  const [editando, setEditando] = useState<ItemBiblioteca | null>(null)

  async function recarregar() {
    setCarregando(true)
    setErro(null)
    try {
      const lista = await listarBiblioteca({
        classificacao: aba === 'todas' ? undefined : aba,
        tema: tema || undefined,
        busca: busca.trim() || undefined,
      })
      setItens(lista)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setCarregando(false)
    }
  }

  // Busca com respiro para não disparar uma requisição por tecla.
  useEffect(() => {
    const t = setTimeout(recarregar, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, tema, busca])

  useEffect(() => {
    listarTemas(aba === 'todas' ? undefined : aba)
      .then(setTemas)
      .catch(() => setTemas([]))
  }, [aba])

  // Tema selecionado que deixou de existir no recorte atual viraria filtro
  // invisível: a lista voltaria vazia sem o usuário entender por quê.
  useEffect(() => {
    if (tema && temas.length > 0 && !temas.includes(tema)) setTema('')
  }, [temas, tema])

  async function abrirItem(item: ItemBiblioteca) {
    setSelecionado(item)
    try {
      setSelecionado(await obterItemBiblioteca(item.id))
    } catch {
      // Mantém o resumo já carregado; o texto simplesmente não aparece.
    }
  }

  async function handleExcluir(item: ItemBiblioteca) {
    if (!window.confirm(`Excluir "${item.titulo}" da biblioteca?`)) return
    try {
      await excluirItemBiblioteca(item.id)
      setItens((prev) => prev.filter((i) => i.id !== item.id))
      if (selecionado?.id === item.id) setSelecionado(null)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  const contagemPorClassificacao = CLASSIFICACOES.map((c) => ({
    classificacao: c,
    total: itens.filter((i) => i.classificacao === c).length,
  }))

  return (
    <div className="space-y-stack-lg">
      <div>
        <nav className="flex items-center gap-2 text-label-sm text-outline mb-2">
          <a href="/" className="hover:text-primary hover:underline">Início</a>
          <Icone nome="chevron_right" className="text-[14px]" />
          <span className="text-primary font-bold">Biblioteca</span>
        </nav>
        <h1 className="text-headline-lg text-primary">Biblioteca</h1>
        <p className="text-body-lg text-on-surface-variant">
          Acervo de referência da área: estoque normativo, pareceres da Consultoria Jurídica e
          notas técnicas. Cada item pode ter link, PDF e texto.
        </p>
      </div>

      {/* Filtros */}
      <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant shadow-card space-y-4">
        <div className="flex flex-wrap gap-2">
          <BotaoAba
            ativo={aba === 'todas'}
            onClick={() => setAba('todas')}
            icone="library_books"
            label="Todas"
            total={itens.length}
          />
          {contagemPorClassificacao.map(({ classificacao, total }) => (
            <BotaoAba
              key={classificacao}
              ativo={aba === classificacao}
              onClick={() => setAba(classificacao)}
              icone={ICONES_CLASSIFICACAO[classificacao]}
              label={LABELS_CLASSIFICACAO[classificacao]}
              total={aba === 'todas' ? total : itens.length}
            />
          ))}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center bg-surface-container-low rounded-lg px-3 py-2 flex-1 min-w-[240px] focus-within:ring-2 focus-within:ring-primary-container/30">
            <Icone nome="search" className="text-outline text-[20px]" />
            <input
              type="search"
              className="bg-transparent border-none outline-none ml-2 w-full text-body-md placeholder:text-outline"
              placeholder="Buscar por título, tema ou conteúdo do texto"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              aria-label="Buscar na biblioteca"
            />
          </div>
          <button
            onClick={() => { setEditando(null); setFormAberto(true) }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-label-lg hover:bg-primary-container transition-colors shadow-card shrink-0"
          >
            <Icone nome="add" className="text-[18px]" />
            Adicionar texto
          </button>
        </div>
      </div>

      {carregando && (
        <div className="flex items-center justify-center py-12 gap-3 text-on-surface-variant">
          <Icone nome="progress_activity" className="animate-spin text-[22px] text-primary" />
          <span className="text-body-lg">Carregando...</span>
        </div>
      )}

      {erro && (
        <p role="alert" className="bg-error-container text-on-error-container px-4 py-3 rounded-lg">
          {erro}
        </p>
      )}

      {!carregando && !erro && itens.length === 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-10 text-center text-on-surface-variant">
          <Icone nome="library_books" className="text-4xl text-outline-variant" />
          <p className="mt-2">
            {busca || tema || aba !== 'todas'
              ? 'Nenhum item encontrado com esses filtros.'
              : 'A biblioteca está vazia. Comece adicionando um texto.'}
          </p>
        </div>
      )}

      {!erro && itens.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-card overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant">
            <p className="text-body-md text-on-surface-variant">
              <span className="font-bold text-on-surface">{itens.length}</span>{' '}
              {itens.length === 1 ? 'item' : 'itens'}
            </p>
          </div>
          <div className="overflow-auto max-h-[max(320px,calc(100vh-420px))]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className={CLASSE_TH}>Título</th>
                  <th className={CLASSE_TH}>Classificação</th>
                  <th className={CLASSE_TH}>
                    <div className="flex items-center gap-1">
                      <span>Tema</span>
                      <FiltroColuna coluna="Tema" ativo={Boolean(tema)} onLimpar={() => setTema('')}>
                        <select
                          value={tema}
                          onChange={(e) => setTema(e.target.value)}
                          className="w-full bg-white border border-outline-variant rounded px-2 py-1.5 text-[12px] text-on-surface-variant"
                        >
                          <option value="">Todos</option>
                          {temas.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </FiltroColuna>
                    </div>
                  </th>
                  <th className={CLASSE_TH}>Versão</th>
                  <th className={CLASSE_TH}>Conteúdo</th>
                  <th className={`${CLASSE_TH} text-center`}>Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {itens.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-surface-container-low/50 transition-colors cursor-pointer"
                    onClick={() => abrirItem(item)}
                  >
                    <td className="px-6 py-4 text-body-md text-on-surface font-semibold">
                      {item.titulo}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-secondary-fixed/30 text-[11px] font-bold text-on-surface-variant whitespace-nowrap">
                        <Icone nome={ICONES_CLASSIFICACAO[item.classificacao]} className="text-[13px]" />
                        {LABELS_CURTOS[item.classificacao] ?? item.classificacao_label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-body-md text-on-surface-variant">{item.tema ?? '-'}</td>
                    <td className="px-6 py-4 text-body-md text-on-surface-variant whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-medium text-on-surface">v{item.versao_atual}</span>
                        <span className="text-[11px]">· {item.autor ?? '—'}</span>
                        {item.atualizado_em && (
                          <span className="text-[11px]">· {formatarData(item.atualizado_em)}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-on-surface-variant">
                        {item.link && (
                          <span title="Tem link" aria-label="Tem link">
                            <Icone nome="link" className="text-[18px]" />
                          </span>
                        )}
                        {item.tem_arquivo && (
                          <span title="Tem PDF" aria-label="Tem PDF">
                            <Icone nome="picture_as_pdf" className="text-[18px]" />
                          </span>
                        )}
                        {item.tem_texto && (
                          <span title="Tem texto" aria-label="Tem texto">
                            <Icone nome="article" className="text-[18px]" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => abrirItem(item)}
                          className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors"
                          title="Abrir"
                          aria-label={`Abrir ${item.titulo}`}
                        >
                          <Icone nome="open_in_full" className="text-[18px] text-primary" />
                        </button>
                        <button
                          onClick={() => { setEditando(item); setFormAberto(true) }}
                          className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors"
                          title="Editar"
                          aria-label={`Editar ${item.titulo}`}
                        >
                          <Icone nome="edit" className="text-[18px] text-primary" />
                        </button>
                        <button
                          onClick={() => handleExcluir(item)}
                          className="p-1.5 rounded-full hover:bg-error-container/30 transition-colors"
                          title="Excluir"
                          aria-label={`Excluir ${item.titulo}`}
                        >
                          <Icone nome="delete" className="text-[18px] text-error" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selecionado && (
        <VisualizadorItem
          item={selecionado}
          onFechar={() => setSelecionado(null)}
          onAtualizado={(atualizado) => {
            setSelecionado(atualizado)
            setItens((prev) => prev.map((i) => (i.id === atualizado.id ? { ...i, ...atualizado } : i)))
          }}
        />
      )}

      {formAberto && (
        <FormularioItem
          item={editando}
          temasConhecidos={temas}
          onFechar={() => setFormAberto(false)}
          onSalvo={async () => {
            setFormAberto(false)
            await recarregar()
            listarTemas(aba === 'todas' ? undefined : aba).then(setTemas).catch(() => {})
          }}
        />
      )}
    </div>
  )
}

function BotaoAba({
  ativo, onClick, icone, label, total,
}: { ativo: boolean; onClick: () => void; icone: string; label: string; total: number }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ativo}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-label-lg transition-colors ${
        ativo
          ? 'bg-primary-fixed/30 text-primary font-bold'
          : 'text-on-surface-variant hover:bg-surface-container-high'
      }`}
    >
      <Icone nome={icone} className="text-[18px]" />
      {label}
      {ativo && <span className="text-[11px] tabular-nums">({total})</span>}
    </button>
  )
}

/** Painel de leitura: texto, PDF e link do item. */
function VisualizadorItem({
  item, onFechar, onAtualizado,
}: { item: ItemBiblioteca; onFechar: () => void; onAtualizado: (i: ItemBiblioteca) => void }) {
  const [urlPdf, setUrlPdf] = useState<string | null>(null)
  const [erroPdf, setErroPdf] = useState<string | null>(null)

  useEffect(() => {
    if (!item.tem_arquivo) {
      setUrlPdf(null)
      return
    }
    let url: string | null = null
    let ativo = true
    urlPdfBiblioteca(item.id)
      .then((u) => {
        url = u
        if (ativo) setUrlPdf(u)
        else URL.revokeObjectURL(u)
      })
      .catch((e) => ativo && setErroPdf(e instanceof Error ? e.message : String(e)))
    // Blob URL vive até ser revogada: sem isso, cada abertura de item deixaria
    // uma cópia do PDF na memória da aba.
    return () => {
      ativo = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [item.id, item.tem_arquivo])

  async function handleRemoverPdf() {
    if (!window.confirm('Remover o PDF deste item?')) return
    try {
      onAtualizado(await removerArquivoBiblioteca(item.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-lg shadow-card w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-outline-variant">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-secondary-fixed/30 text-[11px] font-bold text-on-surface-variant">
              <Icone nome={ICONES_CLASSIFICACAO[item.classificacao]} className="text-[13px]" />
              {item.classificacao_label}
            </span>
            <h3 className="text-headline-sm text-on-surface mt-1">{item.titulo}</h3>
            <p className="text-[11px] text-outline">
              {item.tema ? `Tema: ${item.tema}` : 'Sem tema'}
              {item.data_referencia && ` · Documento de ${formatarData(item.data_referencia)}`}
              {item.autor && ` · Cadastrado por ${item.autor}`}
            </p>
          </div>
          <button
            onClick={onFechar}
            className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full shrink-0"
            aria-label="Fechar"
          >
            <Icone nome="close" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-5">
          {item.link && (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-primary hover:underline text-body-md break-all"
            >
              <Icone nome="link" className="text-[18px] shrink-0" />
              {item.link}
            </a>
          )}

          {item.texto && (
            <div>
              <h4 className="text-label-md text-on-surface-variant uppercase tracking-wider mb-2">Texto</h4>
              <p className="text-body-md text-on-surface whitespace-pre-wrap">{item.texto}</p>
            </div>
          )}

          {item.tem_arquivo && (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <h4 className="text-label-md text-on-surface-variant uppercase tracking-wider">
                  PDF · {item.arquivo_nome} {formatarTamanho(item.arquivo_tamanho) && `(${formatarTamanho(item.arquivo_tamanho)})`}
                </h4>
                <div className="flex items-center gap-2">
                  {urlPdf && (
                    <a
                      href={urlPdf}
                      download={item.arquivo_nome ?? 'documento.pdf'}
                      className="inline-flex items-center gap-1 text-label-sm text-primary hover:underline"
                    >
                      <Icone nome="download" className="text-[16px]" />
                      Baixar
                    </a>
                  )}
                  <button
                    onClick={handleRemoverPdf}
                    className="inline-flex items-center gap-1 text-label-sm text-error hover:underline"
                  >
                    <Icone nome="delete" className="text-[16px]" />
                    Remover
                  </button>
                </div>
              </div>
              {erroPdf && (
                <p role="alert" className="bg-error-container text-on-error-container px-3 py-2 rounded-lg text-body-md">
                  {erroPdf}
                </p>
              )}
              {urlPdf ? (
                <iframe
                  src={urlPdf}
                  title={`PDF de ${item.titulo}`}
                  className="w-full min-h-[420px] h-[55vh] border border-outline-variant rounded-lg bg-surface-container-low"
                />
              ) : (
                !erroPdf && (
                  <div className="flex items-center gap-2 text-on-surface-variant py-6">
                    <Icone nome="progress_activity" className="animate-spin text-[20px]" />
                    Carregando PDF...
                  </div>
                )
              )}
            </div>
          )}

          {!item.link && !item.texto && !item.tem_arquivo && (
            <p className="text-on-surface-variant">Este item não tem conteúdo cadastrado.</p>
          )}

          {/* Histórico de versões */}
          <PainelVersoes item={item} onRestaurado={onAtualizado} />
        </div>
      </div>
    </div>
  )
}

/** Cadastro e edição. No cadastro o PDF vai junto; na edição, em chamada própria. */
function FormularioItem({
  item, temasConhecidos, onFechar, onSalvo,
}: {
  item: ItemBiblioteca | null
  temasConhecidos: string[]
  onFechar: () => void
  onSalvo: () => void
}) {
  const [dados, setDados] = useState<FormularioBiblioteca>(
    item
      ? {
          classificacao: item.classificacao,
          titulo: item.titulo,
          tema: item.tema ?? '',
          data_referencia: item.data_referencia ?? '',
          link: item.link ?? '',
          texto: '',
        }
      : formularioVazio(),
  )
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const inputArquivo = useRef<HTMLInputElement>(null)
  const editorRef = useRef<EditorDocumentoRef>(null)

  // Na edição o texto vem do detalhe: a listagem não carrega o conteúdo. Se o
  // usuário já começou a digitar quando a resposta chega, o que ele escreveu
  // vale mais do que o que estava salvo.
  const [textoCarregado, setTextoCarregado] = useState(false)
  useEffect(() => {
    if (!item?.tem_texto) return
    obterItemBiblioteca(item.id)
      .then((completo) => {
        if (!textoCarregado && completo.texto) {
          setDados((d) => ({ ...d, texto: completo.texto ?? '' }))
          editorRef.current?.definirHtml(completo.texto ?? '')
          setTextoCarregado(true)
        }
      })
      .catch(() => {})
  }, [item, textoCarregado])

  function alterar<K extends keyof FormularioBiblioteca>(campo: K, valor: FormularioBiblioteca[K]) {
    setDados((d) => ({ ...d, [campo]: valor }))
  }

  async function salvar() {
    if (!dados.titulo.trim()) {
      setErro('Informe o título.')
      return
    }
    // Pega o HTML do editor antes de validar
    const textoEditor = editorRef.current?.obterHtml()?.trim() ?? ''
    const dadosComTexto = { ...dados, texto: textoEditor }

    const temConteudo =
      dadosComTexto.link.trim() || dadosComTexto.texto.trim() || arquivo || item?.tem_arquivo
    if (!temConteudo) {
      setErro('Informe ao menos um conteúdo: link, texto ou PDF.')
      return
    }

    setSalvando(true)
    setErro(null)
    try {
      if (item) {
        await atualizarItemBiblioteca(item.id, dadosComTexto)
        if (arquivo) await enviarArquivoBiblioteca(item.id, arquivo)
      } else {
        await criarItemBiblioteca(dadosComTexto, arquivo)
      }
      onSalvo()
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-lg shadow-card w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
          <h3 className="text-headline-sm text-on-surface">
            {item ? 'Editar item da biblioteca' : 'Adicionar à biblioteca'}
          </h3>
          <button
            onClick={onFechar}
            className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full"
            aria-label="Fechar"
          >
            <Icone nome="close" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-6 space-y-4">
          {erro && (
            <p role="alert" className="bg-error-container text-on-error-container px-3 py-2 rounded-lg text-body-md">
              {erro}
            </p>
          )}

          <label className="block">
            <span className="text-label-md text-on-surface-variant">Classificação</span>
            <select
              value={dados.classificacao}
              onChange={(e) => alterar('classificacao', e.target.value as ClassificacaoBiblioteca)}
              className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-surface-container-lowest"
            >
              {CLASSIFICACOES.map((c) => (
                <option key={c} value={c}>{LABELS_CLASSIFICACAO[c]}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-label-md text-on-surface-variant">Título</span>
            <input
              type="text"
              value={dados.titulo}
              onChange={(e) => alterar('titulo', e.target.value)}
              className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
              placeholder="Ex: Resolução CONTRAN 920/2022"
              autoFocus
            />
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-label-md text-on-surface-variant">Tema</span>
              <input
                type="text"
                list="temas-biblioteca"
                value={dados.tema}
                onChange={(e) => alterar('tema', e.target.value)}
                className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
                placeholder="Ex: Credenciamento de CFC"
              />
              <datalist id="temas-biblioteca">
                {temasConhecidos.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="text-label-md text-on-surface-variant">Data do documento</span>
              <input
                type="date"
                value={dados.data_referencia}
                onChange={(e) => alterar('data_referencia', e.target.value)}
                className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-label-md text-on-surface-variant">Link (opcional)</span>
            <input
              type="url"
              value={dados.link}
              onChange={(e) => alterar('link', e.target.value)}
              className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
              placeholder="https://..."
            />
          </label>

          <div>
            <span className="text-label-md text-on-surface-variant">Texto (opcional)</span>
            <div className="mt-1">
              <EditorDocumento
                ref={editorRef}
                somenteLeitura={salvando}
                altura="220px"
                rotulo="Texto do item da biblioteca"
              />
            </div>
          </div>

          <div>
            <span className="text-label-md text-on-surface-variant">PDF (opcional, até 10 MB)</span>
            <div className="mt-1 flex items-center gap-3">
              <input
                ref={inputArquivo}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => inputArquivo.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-lg text-label-md text-on-surface-variant hover:bg-surface-container-high transition-colors"
              >
                <Icone nome="attach_file" className="text-[18px]" />
                {arquivo ? 'Trocar arquivo' : 'Escolher PDF'}
              </button>
              <span className="text-body-md text-on-surface-variant truncate">
                {arquivo
                  ? `${arquivo.name} (${formatarTamanho(arquivo.size)})`
                  : item?.arquivo_nome
                    ? `Atual: ${item.arquivo_nome}`
                    : 'Nenhum arquivo escolhido'}
              </span>
            </div>
            {item?.tem_arquivo && arquivo && (
              <p className="text-[11px] text-tertiary mt-1 flex items-center gap-1">
                <Icone nome="info" className="text-[14px]" />
                O PDF atual será substituído.
              </p>
            )}
          </div>

          <p className="text-[11px] text-outline">
            Preencha ao menos um conteúdo: link, texto ou PDF. A data é a do documento, não a do
            cadastro — é por ela que a lista ordena.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant">
          <button
            onClick={onFechar}
            className="px-4 py-2 border border-outline-variant text-on-surface-variant rounded-lg hover:bg-surface-container-high transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-container transition-colors disabled:opacity-50 inline-flex items-center gap-2"
          >
            {salvando && <Icone nome="progress_activity" className="animate-spin text-[16px]" />}
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Painel expansível com o histórico de versões do item. */
function PainelVersoes({
  item,
  onRestaurado,
}: {
  item: ItemBiblioteca
  onRestaurado: (atualizado: ItemBiblioteca) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [versoes, setVersoes] = useState<VersaoBiblioteca[]>([])
  const [carregando, setCarregando] = useState(false)
  const [restaurando, setRestaurando] = useState<number | null>(null)
  const [expandido, setExpandido] = useState<number | null>(null)

  async function carregar() {
    if (versoes.length > 0) {
      setAberto((v) => !v)
      return
    }
    setCarregando(true)
    try {
      setVersoes(await listarVersoes(item.id))
      setAberto(true)
    } catch {
      // silencia
    } finally {
      setCarregando(false)
    }
  }

  async function handleRestaurar(numero: number) {
    if (!window.confirm(`Restaurar para a versão ${numero}? O estado atual será salvo como versão antes de restaurar.`)) return
    setRestaurando(numero)
    try {
      const atualizado = await restaurarVersao(item.id, numero)
      onRestaurado(atualizado)
      setVersoes(await listarVersoes(item.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setRestaurando(null)
    }
  }

  // Só mostra se o item já tem mais de uma versão
  if ((item.versao_atual ?? 1) <= 1) return null

  return (
    <div className="border-t border-outline-variant pt-4">
      <button
        type="button"
        onClick={carregar}
        className="text-label-lg text-primary hover:underline inline-flex items-center gap-1"
        aria-expanded={aberto}
      >
        {carregando && <Icone nome="progress_activity" className="animate-spin text-[16px]" />}
        <Icone nome={aberto ? 'expand_less' : 'history'} className="text-[18px]" />
        Histórico de versões ({(item.versao_atual ?? 1) - 1} {(item.versao_atual ?? 1) - 1 === 1 ? 'edição anterior' : 'edições anteriores'})
      </button>

      {aberto && versoes.length > 0 && (
        <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto">
          {versoes.map((v) => (
            <div
              key={v.id}
              className="border border-outline-variant/50 rounded-lg px-4 py-3 bg-surface-container-low"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-body-md text-on-surface">
                  <span className="font-bold">v{v.numero}</span>
                  <span className="text-on-surface-variant mx-2">·</span>
                  <span className="text-on-surface-variant">{v.autor ?? '—'}</span>
                  <span className="text-on-surface-variant mx-2">·</span>
                  <span className="text-on-surface-variant text-[12px]">
                    {v.criado_em ? new Date(v.criado_em).toLocaleString('pt-BR') : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setExpandido(expandido === v.numero ? null : v.numero)}
                    className="text-label-sm text-primary hover:underline"
                  >
                    {expandido === v.numero ? 'Ocultar' : 'Ver texto'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestaurar(v.numero)}
                    disabled={restaurando !== null}
                    className="px-2 py-1 text-label-sm border border-outline-variant rounded hover:bg-surface-container-high text-on-surface-variant transition-colors disabled:opacity-50"
                  >
                    {restaurando === v.numero ? 'Restaurando...' : 'Restaurar'}
                  </button>
                </div>
              </div>
              {expandido === v.numero && v.texto && (
                <div className="mt-2 border-t border-outline-variant/30 pt-2">
                  <div
                    className="doc-isolado text-body-md max-h-[200px] overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: v.texto }}
                  />
                </div>
              )}
              {expandido === v.numero && !v.texto && (
                <p className="mt-2 text-body-md text-on-surface-variant italic">
                  Esta versão não tinha texto.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {aberto && versoes.length === 0 && !carregando && (
        <p className="mt-2 text-body-md text-on-surface-variant">Nenhuma versão anterior registrada.</p>
      )}
    </div>
  )
}
