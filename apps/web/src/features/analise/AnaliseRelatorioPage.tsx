import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BASE_API } from '../../api/client'
import { Icone } from '../../components/Icone'
import { divisaoPorSegmento, formatarData, formatarRazaoSocial, formatarTexto, mascararDocumento, rotuloDocumento, rotuloTipoPessoa } from '../../lib/format'
import { listarDocumentosCaixaEntrada, listarHistoricoCaixaEntrada, obterConteudoDocumentoCaixaEntrada, obterDetalhesRelatorio } from './api'
import type { Andamento } from './api'
import { DespachoModal } from './DespachoModal'
import { CardAgente, CardApontamentos, CardRegistrosAgente } from './CardsResumo'
import { PainelAnotacoes } from './PainelAnotacoes'
import type { DetalhesRelatorio, Documento, ResultadoDespacho, TipoDespacho } from './types'
import { base64ParaUint8Array, decodificarBase64Texto, extrairBase64, gerarBlobUrlPdf, pareceHtml, parecePdf, pareceZip } from '../processosAndamento/documento'

type Tab = 'info' | 'historico' | 'documentos'

export function AnaliseRelatorioPage() {
  const { id } = useParams()
  const [dados, setDados] = useState<DetalhesRelatorio | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('info')
  const [despachoAberto, setDespachoAberto] = useState<TipoDespacho | null>(null)
  const [resultadoInstauracao, setResultadoInstauracao] = useState<ResultadoDespacho | null>(null)
  const navigate = useNavigate()

  // Documentos do processo (tab Documentos)
  const [documentos, setDocumentos] = useState<Documento[]>([])
  const [documentosCarregando, setDocumentosCarregando] = useState(false)
  const [documentoSelecionado, setDocumentoSelecionado] = useState<string | null>(null)
  const [docConteudoHtml, setDocConteudoHtml] = useState<string | null>(null)
  const [docPdfUrl, setDocPdfUrl] = useState<string | null>(null)
  const [docPlanilha, setDocPlanilha] = useState<string | null>(null)
  const [docNaoRenderizavel, setDocNaoRenderizavel] = useState<{ nome: string } | null>(null)
  const [docCarregando, setDocCarregando] = useState(false)
  const [docErro, setDocErro] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setCarregando(true)
    setErro(null)
    obterDetalhesRelatorio(id)
      .then(setDados)
      .catch((e) => setErro(String(e)))
      .finally(() => setCarregando(false))
  }, [id])

  // Carregar lista de documentos ao abrir a tab
  useEffect(() => {
    if (tab !== 'documentos' || !id || documentos.length > 0) return
    setDocumentosCarregando(true)
    listarDocumentosCaixaEntrada(id)
      .then((lista) => {
        setDocumentos(lista)
        if (lista.length > 0) setDocumentoSelecionado(lista[lista.length - 1].numero)
      })
      .catch(() => setDocumentos([]))
      .finally(() => setDocumentosCarregando(false))
  }, [tab, id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Carregar conteúdo do documento selecionado
  useEffect(() => {
    if (!id || !documentoSelecionado || tab !== 'documentos') {
      return
    }
    let ativo = true
    setDocCarregando(true)
    setDocErro(null)
    setDocConteudoHtml(null)
    if (docPdfUrl) URL.revokeObjectURL(docPdfUrl)
    setDocPdfUrl(null)
    setDocPlanilha(null)
    setDocNaoRenderizavel(null)

    const docInfo = documentos.find((d) => d.numero === documentoSelecionado)
    const tipoDoc = docInfo?.tipo

    obterConteudoDocumentoCaixaEntrada(id, documentoSelecionado, tipoDoc)
      .then((resp) => {
        if (!ativo) return
        const base64 = extrairBase64(resp.conteudo)
        const nomeDoc = resp.nome || `Documento ${documentoSelecionado}`
        if (!base64) {
          setDocNaoRenderizavel({ nome: nomeDoc })
          return
        }
        if (parecePdf(base64)) {
          setDocPdfUrl(gerarBlobUrlPdf(base64))
          return
        }
        if (pareceZip(base64)) {
          import('xlsx').then((XLSX) => {
            if (!ativo) return
            try {
              const dados = base64ParaUint8Array(base64)
              const workbook = XLSX.read(dados, { type: 'array' })
              const primeiraAba = workbook.SheetNames[0]
              const planilha = workbook.Sheets[primeiraAba]
              const html = XLSX.utils.sheet_to_html(planilha, { editable: false })
              setDocPlanilha(html)
            } catch {
              setDocNaoRenderizavel({ nome: nomeDoc })
            }
          }).catch(() => { if (ativo) setDocNaoRenderizavel({ nome: nomeDoc }) })
          return
        }
        const texto = decodificarBase64Texto(base64)
        if (texto && pareceHtml(texto)) {
          setDocConteudoHtml(texto)
        } else {
          setDocNaoRenderizavel({ nome: nomeDoc })
        }
      })
      .catch((e) => { if (ativo) setDocErro(String(e)) })
      .finally(() => { if (ativo) setDocCarregando(false) })
    return () => { ativo = false }
  }, [id, documentoSelecionado, tab, documentos]) // eslint-disable-line react-hooks/exhaustive-deps

  function aoConcluirDespacho(tipo: TipoDespacho, resultado: ResultadoDespacho) {
    setDespachoAberto(null)

    if (tipo === 'instaurar') {
      // Para instauração, mostra painel guiado com próximos passos
      setResultadoInstauracao(resultado)
      if (dados) setDados({ ...dados, status_triagem: 'instaurado' })
      return
    }

    // Para Arquivar e TAC, mantém o alert simples
    const mensagens: Record<TipoDespacho, string> = {
      arquivar: `Documento de arquivamento criado no processo ${resultado.numero_sei}.`,
      tac: `Documento de TAC criado no processo ${resultado.numero_sei}.`,
      instaurar: '',
    }
    let mensagem = mensagens[tipo]
    if (resultado.avisos.length > 0) {
      mensagem += '\n\nAtenção:\n' + resultado.avisos.map((a) => `• ${a}`).join('\n')
    }
    window.alert(mensagem)
    if (dados) {
      const novoStatus = tipo === 'arquivar' ? 'arquivado' : 'tac'
      setDados({ ...dados, status_triagem: novoStatus })
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-on-surface-variant">
        <Icone nome="progress_activity" className="animate-spin text-2xl" />
        <span className="text-body-lg">Carregando detalhes do relatório...</span>
      </div>
    )
  }

  if (erro || !dados) {
    return (
      <div className="space-y-stack-lg">
        <Link
          to="/caixa-entrada"
          className="inline-flex items-center gap-1 text-primary text-label-sm hover:underline"
        >
          <Icone nome="arrow_back" className="text-[18px]" /> Voltar para a Caixa de Entrada
        </Link>
        <div className="bg-error-container text-on-error-container px-6 py-4 rounded-lg" role="alert">
          {erro ?? 'Item não encontrado.'}
        </div>
      </div>
    )
  }

  const statusLabel = dados.status_triagem === 'pendente' ? 'Pendente' : dados.status_triagem ?? 'Em Análise'

  return (
    <div className="space-y-4">
      {/* Voltar */}
      <div>
        <Link
          to="/caixa-entrada"
          className="inline-flex items-center gap-1 text-primary text-label-sm hover:underline mb-2"
        >
          <Icone nome="arrow_back" className="text-[18px]" /> Voltar para a Caixa de Entrada
        </Link>
      </div>

      {/* Header do Processo */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-primary-fixed/30 p-3 rounded-lg text-primary">
            <Icone nome="folder_open" className="text-[32px]" />
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-headline-md text-on-surface">
                {dados.numero_sei ? `Relatório de Fiscalização ${dados.numero_sei}` : `Relatório #${dados.id}`}
              </h2>
              <span className="px-3 py-1 bg-secondary-container/20 text-secondary text-label-sm font-bold rounded-full border border-secondary-container/30">
                {statusLabel}
              </span>
            </div>
            <p className="text-on-surface-variant text-body-md">
              Recebido em {formatarData(dados.data_recebimento)} • {dados.tipo_documento ?? 'Documento'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-stack-sm flex-wrap">
          <button
            onClick={() => setDespachoAberto('arquivar')}
            className="px-4 py-2 border border-outline-variant text-on-surface-variant text-label-lg rounded-lg hover:bg-surface-container-high transition-colors inline-flex items-center gap-2"
          >
            <Icone nome="inventory_2" className="text-[18px]" />
            Arquivar
          </button>
          <button
            onClick={() => setDespachoAberto('tac')}
            className="px-4 py-2 border border-secondary text-secondary text-label-lg rounded-lg hover:bg-secondary/5 transition-colors inline-flex items-center gap-2"
          >
            <Icone nome="handshake" className="text-[18px]" />
            TAC
          </button>
          <button
            onClick={() => setDespachoAberto('instaurar')}
            className="px-6 py-2 bg-primary text-white text-label-lg rounded-lg hover:bg-primary-container transition-shadow shadow-card inline-flex items-center gap-2"
          >
            <Icone nome="gavel" className="text-[18px]" />
            Instaurar
          </button>
        </div>
      </section>

      {despachoAberto && id && (
        <DespachoModal
          itemId={id}
          tipo={despachoAberto}
          onClose={() => setDespachoAberto(null)}
          onSucesso={(resultado) => aoConcluirDespacho(despachoAberto, resultado)}
        />
      )}

      {/* Painel pós-instauração: guia o usuário nos próximos passos */}
      {resultadoInstauracao && (
        <PainelPosInstauracao
          resultado={resultadoInstauracao}
          itemId={Number(id)}
          idProcedimento={dados.id_procedimento}
          onIrParaProcesso={() => {
            // Navegar para a tela de processos em andamento deste item
            navigate(`/processos/${id}`)
          }}
        />
      )}

      {/* Cards de Resumo — `items-start` impede que abrir o detalhamento de um
          card estique os outros dois para a mesma altura. */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter items-start">
        <CardAgente dados={dados} />
        <CardApontamentos itemId={id} dados={dados} />
        <CardRegistrosAgente itemId={id} />
      </section>

      {/* Conteúdo em largura total — as anotações saíram da coluna lateral e
          agora vivem no painel recolhível (botão flutuante), dando mais espaço
          para a leitura do documento. */}
      <div className="space-y-gutter">
        <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-card overflow-hidden">
          <div className="flex border-b border-outline-variant px-stack-md">
            <TabButton label="Informações Gerais" ativa={tab === 'info'} onClick={() => setTab('info')} />
            <TabButton label="Documentos" ativa={tab === 'documentos'} onClick={() => setTab('documentos')} />
            <TabButton label="Histórico" ativa={tab === 'historico'} onClick={() => setTab('historico')} />
          </div>
          <div className="p-stack-lg">
            {tab === 'info' && <TabInformacoes dados={dados} />}
            {tab === 'documentos' && (
              <TabDocumentos
                documentos={documentos}
                documentosCarregando={documentosCarregando}
                documentoSelecionado={documentoSelecionado}
                onSelecionar={setDocumentoSelecionado}
                docCarregando={docCarregando}
                docErro={docErro}
                docConteudoHtml={docConteudoHtml}
                docPdfUrl={docPdfUrl}
                docPlanilha={docPlanilha}
                docNaoRenderizavel={docNaoRenderizavel}
                itemId={id}
              />
            )}
            {tab === 'historico' && <TabHistorico itemId={id!} />}
          </div>
        </div>
      </div>

      <PainelAnotacoes itemId={id} />
    </div>
  )
}

/* ─── Sub-componentes ─── */

function TabButton({ label, ativa, onClick }: { label: string; ativa: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-stack-lg py-4 text-label-lg border-b-2 transition-all ${
        ativa ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-primary'
      }`}
    >
      {label}
    </button>
  )
}

function TabInformacoes({ dados }: { dados: DetalhesRelatorio }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-stack-lg">
      <div className="space-y-4">
        <h4 className="text-label-lg text-primary border-b border-outline-variant pb-2">
          Dados do Relatório
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] text-on-surface-variant">Nº SEI</p>
            <p className="text-body-md font-semibold text-on-surface">{dados.numero_sei ?? '-'}</p>
          </div>
          <div>
            <p className="text-[11px] text-on-surface-variant">Tipo de Documento</p>
            <p className="text-body-md font-semibold text-on-surface">{formatarTexto(dados.tipo_documento)}</p>
          </div>
          <div>
            <p className="text-[11px] text-on-surface-variant">Status</p>
            <p className="text-body-md font-semibold text-on-surface capitalize">{dados.status_triagem ?? '-'}</p>
          </div>
          <div>
            <p className="text-[11px] text-on-surface-variant">Data Recebimento</p>
            <p className="text-body-md font-semibold text-on-surface">{formatarData(dados.data_recebimento)}</p>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <h4 className="text-label-lg text-primary border-b border-outline-variant pb-2">
          Dados do Agente Regulado
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-[11px] text-on-surface-variant">Razão Social/Nome</p>
            <p className="text-body-md font-semibold text-on-surface">{formatarRazaoSocial(dados.razao_social)}</p>
          </div>
          <div>
            {/* Rótulo específico (CPF ou CNPJ) em vez do genérico, com o tipo
                de pessoa logo abaixo. */}
            <p className="text-[11px] text-on-surface-variant">{rotuloDocumento(dados.cnpj_cpf)}</p>
            <p className="text-body-md font-semibold text-on-surface tabular-nums">{mascararDocumento(dados.cnpj_cpf)}</p>
            <p className="text-[11px] text-on-surface-variant">{rotuloTipoPessoa(dados.cnpj_cpf)}</p>
          </div>
          <div>
            <p className="text-[11px] text-on-surface-variant">Divisão</p>
            <p className="text-body-md font-semibold text-on-surface">{divisaoPorSegmento(dados.segmento)}</p>
          </div>
          <div>
            <p className="text-[11px] text-on-surface-variant">Agente</p>
            <p className="text-body-md font-semibold text-on-surface">{formatarTexto(dados.agente_regulado)}</p>
          </div>
          <div>
            <p className="text-[11px] text-on-surface-variant">Município</p>
            <p className="text-body-md font-semibold text-on-surface">{dados.municipio ?? '-'}</p>
          </div>
          <div>
            <p className="text-[11px] text-on-surface-variant">Superintendência</p>
            <p className="text-body-md font-semibold text-on-surface">{dados.superintendencia ?? '-'}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function TabHistorico({ itemId }: { itemId: string }) {
  const [andamentos, setAndamentos] = useState<Andamento[]>([])
  const [carregando, setCarregando] = useState(false)
  const [modo, setModo] = useState<'resumido' | 'completo'>('resumido')

  useEffect(() => {
    if (!itemId) return
    setCarregando(true)
    listarHistoricoCaixaEntrada(itemId, modo)
      .then(setAndamentos)
      .catch(() => setAndamentos([]))
      .finally(() => setCarregando(false))
  }, [itemId, modo])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setModo('resumido')}
            className={`px-3 py-1.5 rounded-lg text-label-sm transition-colors ${modo === 'resumido' ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            Resumido
          </button>
          <button
            onClick={() => setModo('completo')}
            className={`px-3 py-1.5 rounded-lg text-label-sm transition-colors ${modo === 'completo' ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high'}`}
          >
            Completo
          </button>
        </div>
        <span className="text-[11px] text-on-surface-variant">{andamentos.length} andamento(s)</span>
      </div>

      {carregando && (
        <div className="flex items-center justify-center py-8 gap-2 text-on-surface-variant">
          <Icone nome="progress_activity" className="animate-spin text-[18px]" />
          <span className="text-body-md">Carregando histórico...</span>
        </div>
      )}

      {!carregando && andamentos.length === 0 && (
        <p className="text-body-md text-on-surface-variant text-center py-8">Nenhum andamento encontrado.</p>
      )}

      {!carregando && andamentos.length > 0 && (
        <div className="relative border-l-2 border-outline-variant ml-4 space-y-6 py-4 max-h-[500px] overflow-y-auto">
          {andamentos.map((a, i) => (
            <div key={a.id_andamento} className="relative pl-8">
              <div
                className={`absolute -left-[11px] top-0 w-5 h-5 rounded-full border-4 border-white ${
                  i === 0 ? 'bg-primary' : 'bg-outline-variant'
                }`}
              />
              <div className="flex flex-col">
                <span className="text-[11px] text-on-surface-variant">{a.data} {a.hora}</span>
                <span className="text-label-lg text-on-surface">{a.descricao}</span>
                <p className="text-body-md text-on-surface-variant">
                  {a.unidade_sigla}
                  {a.usuario_nome && <span className="ml-2 text-[11px]">• {a.usuario_nome}</span>}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Formata datetime "dd/mm/aaaa HH:mm:ss" para exibição curta. */
function formatarDataDoc(dataHora: string | null): string {
  if (!dataHora) return 'sem data'
  return dataHora.replace(/:\d{2}$/, '') // remove segundos
}

function TabDocumentos({
  documentos,
  documentosCarregando,
  documentoSelecionado,
  onSelecionar,
  docCarregando,
  docErro,
  docConteudoHtml,
  docPdfUrl,
  docPlanilha,
  docNaoRenderizavel,
  itemId,
}: {
  documentos: Documento[]
  documentosCarregando: boolean
  documentoSelecionado: string | null
  onSelecionar: (numero: string) => void
  docCarregando: boolean
  docErro: string | null
  docConteudoHtml: string | null
  docPdfUrl: string | null
  docPlanilha: string | null
  docNaoRenderizavel: { nome: string } | null
  itemId?: string
}) {

  const [modoLeituraContinua, setModoLeituraContinua] = useState(false)
  const docViewerRef = useRef<HTMLDivElement>(null)

  // Modo leitura contínua: fim avança, topo volta. Cooldown de 2s após troca.
  useEffect(() => {
    if (!modoLeituraContinua || !docViewerRef.current) return
    let confirmacaoFim: ReturnType<typeof setTimeout> | null = null
    let confirmacaoTopo: ReturnType<typeof setTimeout> | null = null
    let cooldown = true
    const el = docViewerRef.current

    const cooldownTimer = setTimeout(() => { cooldown = false }, 2000)

    function onScroll() {
      if (cooldown) return
      const { scrollTop, scrollHeight, clientHeight } = el
      const ehScrollavel = scrollHeight > clientHeight + 50
      if (!ehScrollavel) return

      const noFim = scrollTop + clientHeight >= scrollHeight - 30
      const noTopo = scrollTop <= 5

      if (noFim) {
        if (!confirmacaoFim) {
          confirmacaoFim = setTimeout(() => {
            const idx = documentos.findIndex((d) => d.numero === documentoSelecionado)
            if (idx >= 0 && idx < documentos.length - 1) {
              onSelecionar(documentos[idx + 1].numero)
            }
            confirmacaoFim = null
          }, 2000)
        }
      } else {
        if (confirmacaoFim) { clearTimeout(confirmacaoFim); confirmacaoFim = null }
      }

      if (noTopo && !noFim) {
        if (!confirmacaoTopo) {
          confirmacaoTopo = setTimeout(() => {
            const idx = documentos.findIndex((d) => d.numero === documentoSelecionado)
            if (idx > 0) {
              onSelecionar(documentos[idx - 1].numero)
            }
            confirmacaoTopo = null
          }, 2000)
        }
      } else {
        if (confirmacaoTopo) { clearTimeout(confirmacaoTopo); confirmacaoTopo = null }
      }
    }

    el.addEventListener('scroll', onScroll)
    return () => {
      el.removeEventListener('scroll', onScroll)
      clearTimeout(cooldownTimer)
      if (confirmacaoFim) clearTimeout(confirmacaoFim)
      if (confirmacaoTopo) clearTimeout(confirmacaoTopo)
    }
  }, [modoLeituraContinua, documentoSelecionado, documentos, onSelecionar])

  return (
    <div className="border border-outline-variant rounded-lg overflow-hidden">
      {/* Cabeçalho com o seletor de documento e as ações. A lista deixou de ser
          uma coluna ao lado para o documento ocupar a largura inteira — é o que
          precisa ser lido, e em coluna estreita a leitura fica ruim. */}
      <div className="bg-surface-container-low p-3 border-b border-outline-variant flex flex-wrap items-center gap-2">
        <Icone nome="description" className="text-primary shrink-0" />
        <label htmlFor="seletor-documento-relatorio" className="sr-only">
          Documento do processo
        </label>
        <select
          id="seletor-documento-relatorio"
          value={documentoSelecionado ?? ''}
          onChange={(e) => e.target.value && onSelecionar(e.target.value)}
          disabled={documentos.length === 0}
          className="flex-1 min-w-[180px] bg-white border border-outline-variant rounded-lg px-3 py-1.5 text-body-md text-on-surface disabled:opacity-60"
        >
          {documentos.length === 0 && <option value="">Nenhum documento</option>}
          {documentos.map((doc, i) => (
            <option key={doc.numero} value={doc.numero}>
              {doc.nome} — {doc.numero} • {formatarDataDoc(doc.data_geracao)}
              {i === documentos.length - 1 ? ' (mais recente)' : ''}
            </option>
          ))}
        </select>
        <span className="text-[10px] bg-primary text-white px-2 py-0.5 rounded-full shrink-0">
          {documentos.length}
        </span>
        {documentosCarregando && (
          <Icone nome="progress_activity" className="animate-spin text-[18px] text-primary shrink-0" />
        )}
        <button
          onClick={() => setModoLeituraContinua((v) => !v)}
          className={`p-1.5 rounded-full transition-colors shrink-0 ${modoLeituraContinua ? 'bg-primary text-white' : 'hover:bg-surface-container-high text-on-surface-variant'}`}
          title={modoLeituraContinua ? 'Leitura contínua: LIGADO' : 'Ativar leitura contínua'}
          aria-label="Alternar modo leitura contínua"
          aria-pressed={modoLeituraContinua}
        >
          <Icone nome="auto_stories" className="text-[18px]" />
        </button>
        {documentos.length > 0 && itemId && (
          <a
            href={`${BASE_API}/caixa-entrada/${itemId}/documentos/download-todos`}
            download
            className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors shrink-0"
            title="Baixar todos (ZIP)"
            aria-label="Baixar todos os documentos"
          >
            <Icone nome="folder_zip" className="text-[18px] text-primary" />
          </a>
        )}
        {documentoSelecionado && (
          <a
            href={`${BASE_API}/documentos/${documentoSelecionado}/download?tipo=${documentos.find((d) => d.numero === documentoSelecionado)?.tipo ?? ''}`}
            download
            className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors shrink-0"
            title="Baixar documento"
            aria-label="Baixar documento"
          >
            <Icone nome="download" className="text-[18px] text-primary" />
          </a>
        )}
      </div>
      <div ref={docViewerRef} className="overflow-y-auto" style={{ maxHeight: '70vh' }}>
        {docCarregando && (
          <div className="flex items-center justify-center py-16 gap-2 text-on-surface-variant">
            <Icone nome="progress_activity" className="animate-spin" />
            <span className="text-body-md">Carregando documento...</span>
          </div>
        )}
        {!docCarregando && docErro && (
          <div className="text-center py-16 text-error border-2 border-dashed border-error/40 rounded-lg">
            <Icone nome="error" className="text-4xl mb-2" />
            <p className="text-body-md">{docErro}</p>
          </div>
        )}
        {!docCarregando && !docErro && docConteudoHtml && !modoLeituraContinua && (
          <iframe
            srcDoc={docConteudoHtml}
            title="Documento"
            className="w-full border-0 rounded-lg"
            // Em notebook (768px de altura) 60vh dá ~460px, menor que o mínimo
            // de 500px que havia aqui: o quadro estourava o contêiner e criavam-se
            // duas barras de rolagem concorrentes.
            style={{ minHeight: '380px', height: '60vh' }}
            sandbox="allow-same-origin"
          />
        )}
        {!docCarregando && !docErro && docConteudoHtml && modoLeituraContinua && (
          <div className="doc-isolado">
            <div dangerouslySetInnerHTML={{ __html: docConteudoHtml }} />
          </div>
        )}
        {!docCarregando && !docErro && docPdfUrl && (
          <iframe
            src={docPdfUrl}
            title="Documento (PDF)"
            className="w-full border-0 rounded-lg"
            style={{ minHeight: '380px', height: '60vh' }}
          />
        )}
        {!docCarregando && !docErro && docPlanilha && (
          <div
            className="w-full overflow-auto planilha-container"
            dangerouslySetInnerHTML={{ __html: docPlanilha }}
          />
        )}
        {!docCarregando && !docErro && docNaoRenderizavel && (
          <div className="text-center py-16 text-on-surface-variant border-2 border-dashed border-outline-variant rounded-lg">
            <Icone nome="description" className="text-4xl text-outline-variant mb-2" />
            <p className="text-body-lg font-semibold">Visualização não disponível</p>
            <p className="text-body-md text-outline mt-1">{docNaoRenderizavel.nome} — abra no SEI.</p>
          </div>
        )}
        {!docCarregando && !docErro && !docConteudoHtml && !docPdfUrl && !docPlanilha && !docNaoRenderizavel && !documentoSelecionado && (
          <div className="text-center py-16 text-on-surface-variant border-2 border-dashed border-outline-variant rounded-lg">
            <Icone nome="touch_app" className="text-4xl text-outline-variant mb-2" />
            <p className="text-body-lg">Selecione um documento ao lado para visualizar</p>
          </div>
        )}
        {modoLeituraContinua && !docCarregando && documentoSelecionado && (
          (() => {
            const idx = documentos.findIndex((d) => d.numero === documentoSelecionado)
            const ehUltimo = idx >= documentos.length - 1
            const ehPrimeiro = idx <= 0
            return (
              <>
                {ehUltimo ? (
                  <div className="text-center py-4 text-on-surface-variant text-body-md border-t border-outline-variant mt-4">
                    <Icone nome="check_circle" className="text-tertiary text-[18px] align-middle mr-1" />
                    Último documento da lista
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      onSelecionar(documentos[idx + 1].numero)
                      if (docViewerRef.current) docViewerRef.current.scrollTop = 0
                    }}
                    className="w-full py-4 text-center text-primary text-label-lg border-t border-outline-variant mt-4 hover:bg-primary-fixed/10 transition-colors"
                  >
                    <Icone nome="arrow_downward" className="text-[18px] align-middle mr-1" />
                    Próximo: {documentos[idx + 1]?.nome}
                  </button>
                )}
                {!ehPrimeiro && (
                  <button
                    onClick={() => {
                      onSelecionar(documentos[idx - 1].numero)
                      if (docViewerRef.current) docViewerRef.current.scrollTop = docViewerRef.current.scrollHeight
                    }}
                    className="w-full py-3 text-center text-on-surface-variant text-body-md border-t border-outline-variant hover:bg-surface-container-low transition-colors"
                  >
                    <Icone nome="arrow_upward" className="text-[18px] align-middle mr-1" />
                    Anterior: {documentos[idx - 1]?.nome}
                  </button>
                )}
              </>
            )
          })()
        )}
      </div>
    </div>
  )
}


/** Painel exibido após instaurar com sucesso — guia o usuário nos próximos passos. */
function PainelPosInstauracao({
  resultado,
  itemId,
  idProcedimento,
  onIrParaProcesso,
}: {
  resultado: ResultadoDespacho
  itemId: number
  idProcedimento: string | null
  onIrParaProcesso: () => void
}) {
  const linkSei = resultado.id_procedimento
    ? `https://sei.sp.gov.br/sei/controlador.php?acao=procedimento_trabalhar&id_procedimento=${resultado.id_procedimento}`
    : ''

  return (
    <section className="bg-tertiary-fixed/10 border-2 border-tertiary/30 rounded-xl p-stack-lg space-y-stack-lg">
      <div className="flex items-center gap-3">
        <div className="bg-tertiary text-white p-3 rounded-full">
          <Icone nome="check_circle" className="text-[28px]" />
        </div>
        <div>
          <h3 className="text-headline-sm text-on-surface">Processo sancionatório instaurado com sucesso!</h3>
          <p className="text-body-md text-on-surface-variant">
            Novo processo <strong>{resultado.numero_sei}</strong> criado no SEI. O conjunto probatório (documentos da fiscalização) foi incluído automaticamente.
          </p>
        </div>
      </div>

      {resultado.avisos.length > 0 && (
        <div className="bg-tertiary-fixed/20 border border-tertiary/20 rounded-lg px-4 py-3">
          <p className="text-label-sm text-tertiary font-bold mb-1">Atenção:</p>
          {resultado.avisos.map((a, i) => (
            <p key={i} className="text-body-md text-on-surface-variant">• {a}</p>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <h4 className="text-label-lg text-on-surface uppercase">Próximos passos:</h4>

        {/* Passo 1: Dar acesso externo no SEI */}
        <div className="flex items-center gap-3 p-4 rounded-lg border border-outline-variant bg-white">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold bg-primary text-white">1</span>
          <div className="flex-1">
            <p className="text-body-md font-semibold text-on-surface">Disponibilizar acesso externo ao interessado</p>
            <p className="text-[11px] text-on-surface-variant">Abra o processo no SEI e disponibilize o acesso externo para o interessado poder visualizar e juntar defesa.</p>
          </div>
          {linkSei && (
            <a
              href={linkSei}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 border border-primary text-primary text-label-sm rounded-lg hover:bg-primary/5 transition-colors inline-flex items-center gap-1"
            >
              Abrir no SEI
              <Icone nome="open_in_new" className="text-[14px]" />
            </a>
          )}
        </div>

        {/* Passo 2: Ir para processos em andamento */}
        <div className="flex items-center gap-3 p-4 rounded-lg border border-outline-variant bg-white">
          <span className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold bg-primary text-white">2</span>
          <div className="flex-1">
            <p className="text-body-md font-semibold text-on-surface">Acompanhar o processo</p>
            <p className="text-[11px] text-on-surface-variant">Vá para a tela de Processos em Andamento para acompanhar prazos, fases e documentos.</p>
          </div>
          <button
            onClick={onIrParaProcesso}
            className="px-4 py-2 bg-primary text-white text-label-sm rounded-lg hover:bg-primary-container transition-colors inline-flex items-center gap-1"
          >
            Ir para o processo
            <Icone nome="arrow_forward" className="text-[14px]" />
          </button>
        </div>
      </div>
    </section>
  )
}
