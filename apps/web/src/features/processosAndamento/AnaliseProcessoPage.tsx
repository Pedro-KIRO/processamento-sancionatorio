import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BASE_API, apiPost } from '../../api/client'
import { CardAgente, CardApontamentos, CardRegistrosAgente } from '../analise/CardsResumo'
import { BotaoPrioridade } from '../../components/BotaoPrioridade'
import { CaixaAtribuicao } from './CaixaAtribuicao'
import { PainelRecurso } from './PainelRecurso'
import { getMe, type Usuario } from '../me/api'
import { PainelAnotacoes } from '../analise/PainelAnotacoes'
import { LABELS_FASE } from './fases'
import { Icone } from '../../components/Icone'
import { MalaDiretaForm } from '../../components/MalaDiretaForm'
import { formatarData } from '../../lib/format'
import {
  aplicarMarcadores,
  camposPreenchiveis,
  valoresIniciais,
  type Marcador,
  type ValorCampo,
} from '../../lib/malaDireta'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import {
  alterarPrioridade,
  listarDocumentosProcesso,
  listarHistoricoProcesso,
  obterConteudoDocumentoProcesso,
  obterDetalhesProcesso,
  obterFaseAtual,
  obterTemplateFase,
  anexarDocumentoFase,
  avancarFase,
  listarFases,
  listarPrazos,
  definirPrazo,
  iniciarPrazoDefesa,
  gerarEdital,
  uploadMedidaCautelar,
} from './api'
import type { Andamento, FaseAtualResponse, FaseProcesso, PrazoProcesso } from './api'
import { base64ParaUint8Array, decodificarBase64Texto, extrairBase64, gerarBlobUrlPdf, pareceHtml, parecePdf, pareceZip } from './documento'
import type { ItemProcessoAndamento } from './types'
import type { Documento } from '../analise/types'

/** Formata datetime ISO para exibição amigável (dd/mm/aaaa HH:mm). */
function formatarDataHora(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function extensao(nome: string): string {
  const partes = nome.split('.')
  return partes.length > 1 ? partes[partes.length - 1].toLowerCase() : ''
}

/**
 * Tela de análise de um processo em andamento (caso Instaurado), quase igual
 * à tela de análise do relatório de fiscalização (AnaliseRelatorioPage), mas
 * em vez de mostrar o relatório de fiscalização, mostra o documento do
 * processo NOVO criado no SEI — com um histórico de documentos clicável ao
 * lado, para o usuário poder ver qualquer documento do processo, não só o
 * mais recente.
 */
export function AnaliseProcessoPage() {
  const { id } = useParams()
  const [dados, setDados] = useState<ItemProcessoAndamento | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [me, setMe] = useState<Usuario | null>(null)

  useDocumentTitle(dados ? `Processo ${dados.numero_processo_sei || dados.numero_sei || id}` : 'Processo')

  const [documentos, setDocumentos] = useState<Documento[]>([])
  const [documentosCarregando, setDocumentosCarregando] = useState(false)
  const [documentoSelecionado, setDocumentoSelecionado] = useState<string | null>(null)
  const [conteudoHtml, setConteudoHtml] = useState<string | null>(null)
  const [conteudoPdfUrl, setConteudoPdfUrl] = useState<string | null>(null)
  const [conteudoPlanilha, setConteudoPlanilha] = useState<string | null>(null)
  const [conteudoNaoRenderizavel, setConteudoNaoRenderizavel] = useState<{ nome: string; extensao: string } | null>(null)
  const [conteudoCarregando, setConteudoCarregando] = useState(false)
  const [conteudoErro, setConteudoErro] = useState<string | null>(null)
  const [recarregarDoc, setRecarregarDoc] = useState(0)
  const [modoLeituraContinua, setModoLeituraContinua] = useState(false)
  const docViewerRef = useRef<HTMLDivElement>(null)
  /** Documentos e histórico se alternam em abas, como na análise do relatório.
   *  Fase e próximo passo ficam fora: são o contexto da ação, não consulta. */
  const [aba, setAba] = useState<'documentos' | 'historico'>('documentos')

  useEffect(() => {
    if (!id) return
    carregarDados()
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  function carregarDados() {
    if (!id) return
    setCarregando(true)
    setErro(null)
    getMe().then(setMe).catch(() => setMe(null))

    const pDetalhes = obterDetalhesProcesso(id)
      .then(setDados)
      .catch((e) => setErro(String(e)))

    setDocumentosCarregando(true)
    const pDocumentos = listarDocumentosProcesso(id)
      .then((lista) => {
        setDocumentos(lista)
        if (lista.length > 0 && !documentoSelecionado) setDocumentoSelecionado(lista[lista.length - 1].numero)
      })
      .catch(() => setDocumentos([]))
      .finally(() => setDocumentosCarregando(false))

    // Só remove o loading geral quando detalhes + documentos terminarem
    Promise.allSettled([pDetalhes, pDocumentos]).finally(() => setCarregando(false))
  }

  function atualizarDocumentos() {
    if (!id) return
    setDocumentosCarregando(true)
    listarDocumentosProcesso(id)
      .then((lista) => {
        setDocumentos(lista)
        if (lista.length > 0 && !documentoSelecionado) setDocumentoSelecionado(lista[lista.length - 1].numero)
      })
      .catch(() => {})
      .finally(() => setDocumentosCarregando(false))
  }

  useEffect(() => {
    if (!id || !documentoSelecionado) {
      setConteudoHtml(null)
      if (conteudoPdfUrl) URL.revokeObjectURL(conteudoPdfUrl)
      setConteudoPdfUrl(null)
      setConteudoPlanilha(null)
      setConteudoNaoRenderizavel(null)
      return
    }
    let ativo = true
    setConteudoCarregando(true)
    setConteudoErro(null)
    setConteudoHtml(null)
    if (conteudoPdfUrl) URL.revokeObjectURL(conteudoPdfUrl)
    setConteudoPdfUrl(null)
    setConteudoPlanilha(null)
    setConteudoNaoRenderizavel(null)
    const docInfo = documentos.find((d) => d.numero === documentoSelecionado)
    const tipoDoc = docInfo?.tipo // "interno" ou "externo"
    if (!docInfo && documentos.length === 0) {
      // Documentos ainda não carregaram — aguardar
      setConteudoCarregando(false)
      return
    }
    obterConteudoDocumentoProcesso(id, documentoSelecionado, tipoDoc)
      .then((resp) => {
        if (!ativo) return
        const base64 = extrairBase64(resp.conteudo)
        const nomeDoc = resp.nome || `Documento ${documentoSelecionado}`
        if (!base64) {
          setConteudoNaoRenderizavel({ nome: nomeDoc, extensao: extensao(nomeDoc) })
          return
        }
        // Verifica se é PDF (documentos externos do SEI costumam ser PDF)
        if (parecePdf(base64)) {
          setConteudoPdfUrl(gerarBlobUrlPdf(base64))
          return
        }
        // Verifica se é Excel/ZIP (xlsx, docx etc.)
        if (pareceZip(base64)) {
          import('xlsx').then((XLSX) => {
            if (!ativo) return
            try {
              const dados = base64ParaUint8Array(base64)
              const workbook = XLSX.read(dados, { type: 'array' })
              const primeiraAba = workbook.SheetNames[0]
              const planilha = workbook.Sheets[primeiraAba]
              const html = XLSX.utils.sheet_to_html(planilha, { editable: false })
              setConteudoPlanilha(html)
            } catch {
              setConteudoNaoRenderizavel({ nome: nomeDoc, extensao: extensao(nomeDoc) })
            }
          }).catch(() => {
            if (ativo) setConteudoNaoRenderizavel({ nome: nomeDoc, extensao: extensao(nomeDoc) })
          })
          return
        }
        const texto = decodificarBase64Texto(base64)
        if (texto && pareceHtml(texto)) {
          setConteudoHtml(texto)
        } else {
          setConteudoNaoRenderizavel({ nome: nomeDoc, extensao: extensao(nomeDoc) })
        }
      })
      .catch((e) => { if (ativo) setConteudoErro(String(e)) })
      .finally(() => { if (ativo) setConteudoCarregando(false) })
    return () => { ativo = false }
  }, [id, documentoSelecionado, documentos, recarregarDoc]) // eslint-disable-line react-hooks/exhaustive-deps

  // Modo leitura contínua: ao chegar no fim do scroll, avança pro próximo documento
  // Ao chegar no topo rolando pra cima, volta pro documento anterior
  // O usuário precisa ficar parado no fim/topo por 2s para confirmar a intenção
  useEffect(() => {
    if (!modoLeituraContinua || !docViewerRef.current) return

    let confirmacaoFim: ReturnType<typeof setTimeout> | null = null
    let confirmacaoTopo: ReturnType<typeof setTimeout> | null = null
    let cooldown = true // Ignora scroll logo após troca de documento
    const el = docViewerRef.current

    // Cooldown de 2s após montar — evita disparar imediatamente com conteúdo vazio
    const cooldownTimer = setTimeout(() => { cooldown = false }, 2000)

    function onScroll() {
      if (cooldown) return

      const { scrollTop, scrollHeight, clientHeight } = el
      // Só detecta fim se o conteúdo é realmente scrollável (tem overflow)
      const ehScrollavel = scrollHeight > clientHeight + 50
      if (!ehScrollavel) return

      const noFim = scrollTop + clientHeight >= scrollHeight - 30
      const noTopo = scrollTop <= 5

      // --- Detectar fim (avançar) ---
      if (noFim) {
        if (!confirmacaoFim) {
          confirmacaoFim = setTimeout(() => {
            const idx = documentos.findIndex((d) => d.numero === documentoSelecionado)
            if (idx >= 0 && idx < documentos.length - 1) {
              setDocumentoSelecionado(documentos[idx + 1].numero)
            }
            confirmacaoFim = null
          }, 2000)
        }
      } else {
        if (confirmacaoFim) { clearTimeout(confirmacaoFim); confirmacaoFim = null }
      }

      // --- Detectar topo (voltar) ---
      if (noTopo && !noFim) {
        if (!confirmacaoTopo) {
          confirmacaoTopo = setTimeout(() => {
            const idx = documentos.findIndex((d) => d.numero === documentoSelecionado)
            if (idx > 0) {
              setDocumentoSelecionado(documentos[idx - 1].numero)
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
  }, [modoLeituraContinua, documentoSelecionado, documentos])

  if (carregando || (!dados && !erro)) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-6 text-on-surface-variant">
        <div className="w-16 h-16 rounded-full bg-primary-fixed/30 flex items-center justify-center">
          <Icone nome="gavel" className="text-4xl text-primary animate-bounce" />
        </div>
        <div className="text-center">
          <p className="text-body-lg font-semibold text-on-surface">Carregando processo...</p>
          <p className="text-body-md text-outline mt-1">Consultando documentos no SEI</p>
        </div>
      </div>
    )
  }

  if (erro || !dados) {
    return (
      <div className="space-y-stack-lg">
        <Link
          to="/processos"
          className="inline-flex items-center gap-1 text-primary text-label-sm hover:underline"
        >
          <Icone nome="arrow_back" className="text-[18px]" /> Voltar para Processos em Andamento
        </Link>
        <div className="bg-error-container text-on-error-container px-6 py-4 rounded-lg" role="alert">
          {erro ?? 'Processo não encontrado.'}
        </div>
      </div>
    )
  }

  const numeroProcesso = dados.numero_processo_sei ?? dados.numero_sei

  return (
    <div className="space-y-4">
      <div>
        <Link
          to="/processos"
          className="inline-flex items-center gap-1 text-primary text-label-sm hover:underline mb-2"
        >
          <Icone nome="arrow_back" className="text-[18px]" /> Voltar para Processos em Andamento
        </Link>
      </div>

      {/* Header do Processo */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="bg-primary-fixed/30 p-3 rounded-lg text-primary">
            <Icone nome="gavel" className="text-[32px]" />
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-headline-md text-on-surface">
                {numeroProcesso ? `Proc. Sancionatório ${numeroProcesso}` : `Item #${dados.id}`}
              </h2>
              <span className="px-3 py-1 bg-primary-fixed/40 text-on-primary-fixed-variant text-label-sm font-bold rounded-full">
                Instaurado
              </span>
            </div>
            <p className="text-on-surface-variant text-body-md">
              {dados.data_instauracao
                ? `Instaurado em ${formatarData(dados.data_instauracao)}`
                : 'Aguardando assinatura do documento de instauração'}
              {' • '}
              {dados.agente_regulado ?? '-'}
            </p>
          </div>
        </div>

        {/* Ações disponíveis em qualquer fase, por isso ficam no cabeçalho e
            não dentro do card do próximo passo. */}
        <div className="shrink-0 flex items-center gap-2">
          <BotaoPrioridade
            prioritario={Boolean(dados.prioritario)}
            justificativa={dados.prioridade_justificativa}
            podeEditar={Boolean(me?.pode_priorizar)}
            variante="completo"
            onAlterar={async (novo, motivo) => {
              await alterarPrioridade(id!, novo, motivo)
              setDados((d) => (d ? { ...d, prioritario: novo, prioridade_justificativa: motivo ?? null } : d))
            }}
          />
          <BotaoMedidaCautelar itemId={id!} />
        </div>
      </section>

      {/* Cards de Resumo — `items-start` impede que abrir o detalhamento de um
          card estique os outros dois para a mesma altura. */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter items-start">
        <CardAgente dados={dados} />
        <CardApontamentos itemId={id} dados={dados} />
        <CardRegistrosAgente itemId={id} />
      </section>

      {/*
        Uma grade só para todo o corpo da tela: a coluna da esquerda flui de
        cima a baixo (fase → documento → histórico do processo) e a da direita
        é a lateral (responsável, ações da fase, histórico de documentos).

        Antes eram blocos empilhados, cada um com o seu próprio grid. Como a
        linha de um grid tem a altura do item mais alto, o card "Próximo passo"
        empurrava o documento para baixo e deixava um vão em branco embaixo da
        timeline. Com uma grade só, cada coluna acompanha o próprio conteúdo.
      */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-gutter items-start">
        {/* Coluna Esquerda — Fase, documento e histórico do processo */}
        <div className="min-w-0 space-y-gutter">
          <TimelineFases itemId={id!} />

          {/* Documentos e histórico em abas, como na análise do relatório: são
              consultados um por vez, então empilhá-los só somava altura. O
              seletor de documento fica no cabeçalho da aba, no lugar de uma
              lista em card separado, para o documento ocupar a largura inteira
              — é o que precisa ser lido. */}
          <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-card overflow-hidden">
            <div className="flex border-b border-outline-variant px-stack-md">
              <BotaoAbaProcesso rotulo="Documentos" ativa={aba === 'documentos'} onClick={() => setAba('documentos')} />
              <BotaoAbaProcesso rotulo="Histórico" ativa={aba === 'historico'} onClick={() => setAba('historico')} />
            </div>

            {aba === 'documentos' && (
              <>
            <div className="bg-surface-container-low p-stack-md border-b border-outline-variant flex flex-wrap items-center gap-2">
              <Icone nome="description" className="text-primary shrink-0" />
              <label htmlFor="seletor-documento-processo" className="sr-only">
                Documento do processo
              </label>
              <select
                id="seletor-documento-processo"
                value={documentoSelecionado ?? ''}
                onChange={(e) => setDocumentoSelecionado(e.target.value || null)}
                disabled={documentos.length === 0}
                className="flex-1 min-w-[180px] bg-white border border-outline-variant rounded-lg px-3 py-1.5 text-body-md text-on-surface disabled:opacity-60"
              >
                {documentos.length === 0 && <option value="">Nenhum documento</option>}
                {documentos.map((doc, i) => (
                  <option key={doc.numero} value={doc.numero}>
                    {doc.nome} — {doc.numero}
                    {doc.data_geracao ? ` • ${formatarDataHora(doc.data_geracao)}` : ''}
                    {i === documentos.length - 1 ? ' (mais recente)' : ''}
                  </option>
                ))}
              </select>
              <span className="text-[10px] bg-primary text-white px-2 py-0.5 rounded-full shrink-0">
                {documentos.length}
              </span>
              <button
                onClick={atualizarDocumentos}
                disabled={documentosCarregando}
                className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors disabled:opacity-50 shrink-0"
                title="Atualizar lista de documentos"
                aria-label="Atualizar documentos"
              >
                <Icone nome={documentosCarregando ? 'progress_activity' : 'refresh'} className={`text-[18px] text-primary ${documentosCarregando ? 'animate-spin' : ''}`} />
              </button>
              {documentos.length > 0 && (
                <a
                  href={`${BASE_API}/processos-andamento/${id}/documentos/download-todos`}
                  download
                  className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors shrink-0"
                  title="Baixar todos os documentos (ZIP)"
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
            <div ref={docViewerRef} className="p-stack-lg overflow-y-auto" style={{ maxHeight: '80vh' }}>
              {conteudoCarregando && (
                <div className="flex items-center justify-center py-10 gap-2 text-on-surface-variant">
                  <Icone nome="progress_activity" className="animate-spin" />
                  <span className="text-body-md">Carregando documento...</span>
                </div>
              )}
              {!conteudoCarregando && conteudoErro && (
                <div className="text-center py-8 text-on-surface-variant border-2 border-dashed border-error/40 rounded-lg" role="alert">
                  <Icone nome="error" className="text-4xl text-error mb-2" />
                  <p className="text-body-md font-semibold text-error">Não foi possível carregar o documento</p>
                  <p className="text-body-sm text-outline mt-1">{conteudoErro}</p>
                </div>
              )}
              {!conteudoCarregando && !conteudoErro && conteudoHtml && !modoLeituraContinua && (
                <iframe
                  srcDoc={conteudoHtml}
                  title="Documento do processo"
                  className="w-full border-0 rounded-lg"
                  // O contêiner tem maxHeight de 80vh; em notebook isso dá ~610px,
                  // menos que o mínimo de 600px que havia aqui somado ao padding —
                  // o resultado eram duas barras de rolagem disputando o mesmo espaço.
                  style={{ minHeight: '420px', height: '80vh', maxHeight: '1200px' }}
                  sandbox="allow-same-origin"
                />
              )}
              {!conteudoCarregando && !conteudoErro && conteudoHtml && modoLeituraContinua && (
                <div className="doc-isolado">
                  <div dangerouslySetInnerHTML={{ __html: conteudoHtml }} />
                </div>
              )}
              {!conteudoCarregando && !conteudoErro && conteudoPdfUrl && (
                <iframe
                  src={conteudoPdfUrl}
                  title="Documento do processo (PDF)"
                  className="w-full border-0 rounded-lg"
                  style={{ minHeight: '420px', height: '80vh', maxHeight: '1200px' }}
                />
              )}
              {!conteudoCarregando && !conteudoErro && conteudoPlanilha && (
                <div
                  className="w-full overflow-auto rounded-lg border border-outline-variant planilha-container"
                  dangerouslySetInnerHTML={{ __html: conteudoPlanilha }}
                />
              )}
              {!conteudoCarregando && !conteudoErro && conteudoNaoRenderizavel && (
                <div className="text-center py-8 text-on-surface-variant border-2 border-dashed border-outline-variant rounded-lg">
                  <Icone nome="description" className="text-4xl text-outline-variant mb-2" />
                  <p className="text-body-md font-semibold">Visualização não disponível</p>
                  <p className="text-body-sm text-outline mt-1">
                    {conteudoNaoRenderizavel.nome} — abra este documento diretamente no site do SEI.
                  </p>
                </div>
              )}
              {!conteudoCarregando && !conteudoErro && !conteudoHtml && !conteudoPdfUrl && !conteudoPlanilha && !conteudoNaoRenderizavel && (
                <div className="text-center py-8 text-on-surface-variant border-2 border-dashed border-outline-variant rounded-lg">
                  <Icone nome="folder_off" className="text-4xl text-outline-variant mb-2" />
                  <p className="text-body-md font-semibold">Nenhum documento encontrado</p>
                  <p className="text-body-sm text-outline mt-1">
                    Ainda não há documentos gerados neste processo.
                  </p>
                </div>
              )}
              {modoLeituraContinua && !conteudoCarregando && documentoSelecionado && (
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
                            setDocumentoSelecionado(documentos[idx + 1].numero)
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
                            setDocumentoSelecionado(documentos[idx - 1].numero)
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
              </>
            )}

            {aba === 'historico' && <HistoricoAndamentos itemId={id!} emAba />}
          </div>
        </div>

        {/* Coluna Direita — Responsável, ações da fase e recurso */}
        <div className="space-y-gutter">
          <CaixaAtribuicao itemId={id!} />
          <AcoesPorFase itemId={id!} />
          <PainelRecurso itemId={id!} />
        </div>
      </div>

      {/* Anotações internas: painel recolhível (botão flutuante), para não
          consumir largura da área de leitura do documento. */}
      <PainelAnotacoes itemId={id} />
    </div>
  )
}


/** `emAba`: dentro de uma aba o card externo e o título viram repetição — a
 *  própria aba já diz o que é —, então só os controles de modo ficam. */
/** Aba do miolo da tela. Mesmo visual do `TabButton` da análise do relatório. */
function BotaoAbaProcesso({ rotulo, ativa, onClick }: { rotulo: string; ativa: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={ativa}
      className={`px-stack-lg py-4 text-label-lg border-b-2 transition-all ${
        ativa ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-primary'
      }`}
    >
      {rotulo}
    </button>
  )
}


function HistoricoAndamentos({ itemId, emAba = false }: { itemId: string; emAba?: boolean }) {
  const [andamentos, setAndamentos] = useState<Andamento[]>([])
  const [carregando, setCarregando] = useState(false)
  const [modo, setModo] = useState<'resumido' | 'completo'>('resumido')

  useEffect(() => {
    if (!itemId) return
    setCarregando(true)
    listarHistoricoProcesso(itemId, modo)
      .then(setAndamentos)
      .catch(() => setAndamentos([]))
      .finally(() => setCarregando(false))
  }, [itemId, modo])

  return (
    <div className={emAba ? '' : 'bg-surface-container-lowest rounded-lg border border-outline-variant shadow-card overflow-hidden'}>
      <div className={`p-stack-md flex justify-between items-center ${emAba ? '' : 'bg-surface-container-low border-b border-outline-variant'}`}>
        {!emAba && <h4 className="text-label-lg text-on-surface uppercase">Histórico do Processo</h4>}
        <div className="flex items-center gap-2 ml-auto">
          <button
            onClick={() => setModo('resumido')}
            className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-colors ${modo === 'resumido' ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high border border-outline-variant'}`}
          >
            Resumido
          </button>
          <button
            onClick={() => setModo('completo')}
            className={`px-3 py-1 rounded-lg text-[11px] font-bold transition-colors ${modo === 'completo' ? 'bg-primary text-white' : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high border border-outline-variant'}`}
          >
            Completo
          </button>
          <span className="text-[10px] bg-primary text-white px-2 py-0.5 rounded-full">{andamentos.length}</span>
        </div>
      </div>
      <div className="p-stack-md max-h-[400px] overflow-y-auto">
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
          <div className="relative border-l-2 border-outline-variant ml-4 space-y-6 py-2">
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
    </div>
  )
}


function TimelineFases({ itemId }: { itemId: string }) {
  const [faseAtual, setFaseAtual] = useState<FaseAtualResponse | null>(null)
  const [fases, setFases] = useState<FaseProcesso[]>([])
  const [prazos, setPrazos] = useState<PrazoProcesso[]>([])
  const [carregando, setCarregando] = useState(true)
  const [avancando, setAvancando] = useState(false)

  useEffect(() => {
    if (!itemId) return
    setCarregando(true)
    Promise.all([
      obterFaseAtual(itemId),
      listarFases(itemId),
      listarPrazos(itemId),
    ])
      .then(([fa, fs, ps]) => {
        setFaseAtual(fa)
        setFases(fs)
        setPrazos(ps)
      })
      .catch(() => {})
      .finally(() => setCarregando(false))
  }, [itemId])

  async function handleAvancar() {
    setAvancando(true)
    try {
      await avancarFase(itemId)
      // Recarregar
      const [fa, fs] = await Promise.all([obterFaseAtual(itemId), listarFases(itemId)])
      setFaseAtual(fa)
      setFases(fs)
    } catch {
      // Silencioso
    } finally {
      setAvancando(false)
    }
  }

  if (carregando) {
    return (
      <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-card p-stack-lg">
        <div className="flex items-center gap-2 text-on-surface-variant">
          <Icone nome="progress_activity" className="animate-spin text-[18px]" />
          <span className="text-body-md">Carregando fases...</span>
        </div>
      </div>
    )
  }

  const todasFases = (faseAtual?.todas ?? []).filter((f) => f !== 'encerrado')
  const faseAtualNome = faseAtual?.fase_atual
  const idxAtual = faseAtualNome ? todasFases.indexOf(faseAtualNome) : -1

  // Prazo ativo (em_andamento) da fase atual
  const prazoAtivo = prazos.find((p) => p.status === 'em_andamento')
  const prazosDefesa = prazos.filter((p) => p.fase === 'aguardando_defesa')
  // Vencido sem o interessado ter visualizado o acesso externo: o caminho é o
  // edital de citação, que reabre 15 dias. Se já houver prazo correndo (o do
  // próprio edital), não há o que oferecer.
  const cabeEditalCitacao =
    faseAtualNome === 'aguardando_defesa' &&
    !prazoAtivo &&
    prazosDefesa.some((p) => p.status === 'decurso' && !p.reiniciado)

  async function recarregarPrazos() {
    setPrazos(await listarPrazos(itemId))
  }

  return (
    <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-card overflow-hidden">
      <div className="bg-surface-container-low p-stack-md border-b border-outline-variant">
        <h4 className="text-label-lg text-on-surface uppercase">Fase do Processo</h4>
      </div>

      {/* Timeline horizontal */}
      <div className="p-stack-md overflow-x-auto">
        <div className="flex items-center gap-0 min-w-max">
          {todasFases.map((fase, i) => {
            const concluida = i < idxAtual
            const atual = i === idxAtual
            const futura = i > idxAtual
            const faseData = fases.find((f) => f.fase === fase)

            return (
              <div key={fase} className="flex items-start">
                <div className="flex flex-col items-center" style={{minWidth: '70px'}}>
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold border-2 transition-all ${
                      concluida
                        ? 'bg-tertiary border-tertiary text-white'
                        : atual
                        ? 'bg-primary border-primary text-white scale-110'
                        : 'bg-surface-container-high border-outline-variant text-outline'
                    }`}
                    title={LABELS_FASE[fase] ?? fase}
                  >
                    {concluida ? <Icone nome="check" className="text-[16px]" /> : i + 1}
                  </div>
                  <span className={`text-[9px] mt-1 max-w-[70px] text-center leading-tight ${
                    atual ? 'text-primary font-bold' : concluida ? 'text-tertiary' : 'text-outline'
                  }`}>
                    {LABELS_FASE[fase] ?? fase}
                  </span>
                  {faseData && (
                    <span className="text-[8px] text-on-surface-variant">
                      {faseData.data_entrada.split('T')[0].split('-').reverse().join('/')}
                    </span>
                  )}
                </div>
                {i < todasFases.length - 1 && (
                  <div className={`w-6 h-0.5 mt-4 -mx-1 ${concluida ? 'bg-tertiary' : 'bg-outline-variant'}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Prazo ativo */}
      {prazoAtivo && (
        <div className="px-stack-md pb-stack-md mt-4">
          <div className="flex items-center gap-3 bg-secondary-fixed/20 border border-secondary-container/30 rounded-lg px-4 py-2">
            <Icone nome="timer" className="text-secondary text-[20px]" />
            <div className="flex-1">
              <p className="text-body-md text-on-surface">
                Prazo de <strong>{prazoAtivo.dias} dias</strong> — vence em{' '}
                <strong>{prazoAtivo.data_vencimento.split('-').reverse().join('/')}</strong>
                {prazoAtivo.reiniciado && <span className="text-[10px] text-tertiary ml-2">(reiniciado)</span>}
              </p>
              {prazoAtivo.fase === 'aguardando_defesa' && (
                <p className="text-[11px] text-on-surface-variant">
                  {prazoAtivo.reiniciado && prazoAtivo.data_reinicio
                    ? `Acesso externo visualizado em ${formatarData(prazoAtivo.data_reinicio)} — contagem reiniciada dessa data.`
                    : `Conta da disponibilização do acesso externo (${formatarData(prazoAtivo.data_inicio)}). Se o interessado visualizar, o prazo reinicia por mais ${prazoAtivo.dias} dias.`}
                </p>
              )}
            </div>
            {(() => {
              const hoje = new Date()
              const venc = new Date(prazoAtivo.data_vencimento + 'T00:00:00')
              const dias = Math.ceil((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24))
              return (
                <span className={`text-label-sm font-bold px-2 py-1 rounded-full ${
                  dias <= 3 ? 'bg-error-container text-error' : dias <= 7 ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-surface-container-high text-on-surface-variant'
                }`}>
                  {dias > 0 ? `${dias}d restantes` : 'Vencido'}
                </span>
              )
            })()}
          </div>
        </div>
      )}

      {/* Aguardando defesa sem prazo: o app abre sozinho quando o SEI registra
          a disponibilização do acesso externo. Se ainda não registrou, resta o
          caminho manual. */}
      {!prazoAtivo && faseAtualNome === 'aguardando_defesa' && prazosDefesa.length === 0 && (
        <div className="mt-4">
          <BotaoIniciarPrazo itemId={itemId} onPrazoCriado={recarregarPrazos} />
        </div>
      )}

      {/* Vencido sem visualização do acesso externo → edital de citação */}
      {cabeEditalCitacao && (
        <BotaoGerarEdital
          itemId={itemId}
          tipo="citacao"
          label="Prazo vencido sem visualização do acesso externo — gerar edital de citação"
          onGerado={recarregarPrazos}
        />
      )}
      {faseAtualNome === 'aguardando_alegacoes' && !prazoAtivo && prazos.some((p) => p.fase === 'aguardando_alegacoes' && p.status === 'decurso') && (
        <BotaoGerarEdital itemId={itemId} tipo="intimacao_alegacoes" label="Prazo de alegações vencido — gerar edital de intimação" onGerado={recarregarPrazos} />
      )}
    </div>
  )
}

function BotaoIniciarPrazo({ itemId, onPrazoCriado }: { itemId: string; onPrazoCriado: () => void }) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState(false)

  async function handleIniciar() {
    setEnviando(true)
    setErro(null)
    try {
      await iniciarPrazoDefesa(itemId)
      setSucesso(true)
      onPrazoCriado()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao iniciar prazo')
    } finally {
      setEnviando(false)
    }
  }

  if (sucesso) return null // Prazo criado, o componente pai já mostra o prazo ativo

  return (
    <div className="px-stack-md pb-stack-md">
      <div className="flex items-center gap-3 bg-tertiary-fixed/10 border border-tertiary/20 rounded-lg px-4 py-3">
        <Icone nome="lock_open" className="text-tertiary text-[20px]" />
        <div className="flex-1">
          <p className="text-body-md text-on-surface font-semibold">Aguardando a disponibilização do acesso externo</p>
          <p className="text-[11px] text-on-surface-variant">
            O prazo de 15 dias abre sozinho assim que o SEI registrar a disponibilização, já contado
            dessa data. Use o botão apenas se você disponibilizou e o andamento não aparece no SEI —
            aí a contagem passa a valer de hoje.
          </p>
        </div>
        <button
          onClick={handleIniciar}
          disabled={enviando}
          className="px-4 py-2 border border-tertiary text-tertiary text-label-sm font-bold rounded-lg hover:bg-tertiary/10 transition-colors disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap"
        >
          {enviando && <Icone nome="progress_activity" className="animate-spin text-[14px]" />}
          Iniciar prazo manualmente
        </button>
      </div>
      {erro && (
        <p className="text-[11px] text-error mt-1">{erro}</p>
      )}
    </div>
  )
}

function BotaoGerarEdital({ itemId, tipo, label, onGerado }: { itemId: string; tipo: 'citacao' | 'intimacao_alegacoes'; label: string; onGerado?: () => void }) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ documento_formatado: string; link_sei: string | null; mensagem: string } | null>(null)

  async function handleGerar() {
    setEnviando(true)
    setErro(null)
    try {
      const res = await gerarEdital(itemId, tipo)
      setResultado(res)
      onGerado?.()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar edital')
    } finally {
      setEnviando(false)
    }
  }

  if (resultado) {
    return (
      <div className="px-stack-md pb-stack-md">
        <div className="flex items-center gap-3 bg-tertiary-fixed/10 border border-tertiary/20 rounded-lg px-4 py-3">
          <Icone nome="check_circle" className="text-tertiary text-[20px]" />
          <div className="flex-1">
            <p className="text-body-md text-on-surface font-semibold">Edital gerado: {resultado.documento_formatado}</p>
            <p className="text-[11px] text-on-surface-variant">{resultado.mensagem}</p>
          </div>
          {resultado.link_sei && (
            <a
              href={resultado.link_sei}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 border border-primary text-primary text-label-sm rounded-lg hover:bg-primary/5 transition-colors inline-flex items-center gap-1 whitespace-nowrap"
            >
              Abrir no SEI
              <Icone nome="open_in_new" className="text-[14px]" />
            </a>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="px-stack-md pb-stack-md">
      <div className="flex items-center gap-3 bg-error-container/20 border border-error/20 rounded-lg px-4 py-3">
        <Icone nome="campaign" className="text-error text-[20px]" />
        <div className="flex-1">
          <p className="text-body-md text-on-surface font-semibold">{label}</p>
          <p className="text-[11px] text-on-surface-variant">
            {tipo === 'citacao'
              ? 'O interessado não abriu o acesso externo dentro do prazo. Gere o edital, publique no Diário Oficial e o prazo de 15 dias reabre a partir da geração.'
              : 'O interessado não apresentou alegações finais. Gere o edital de intimação para publicação.'}
          </p>
        </div>
        <button
          onClick={handleGerar}
          disabled={enviando}
          className="px-4 py-2 bg-error text-white text-label-sm font-bold rounded-lg hover:bg-error/80 transition-colors disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap"
        >
          {enviando && <Icone nome="progress_activity" className="animate-spin text-[14px]" />}
          Gerar edital
        </button>
      </div>
      {erro && <p className="text-[11px] text-error mt-1">{erro}</p>}
    </div>
  )
}


function BotaoMedidaCautelar({ itemId }: { itemId: string }) {
  const [aberto, setAberto] = useState(false)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [descricao, setDescricao] = useState('Comprovante de medida cautelar (bloqueio)')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ documento_formatado: string; link_sei: string | null; mensagem: string } | null>(null)

  async function handleEnviar() {
    if (!arquivo) return
    setEnviando(true)
    setErro(null)
    try {
      const res = await uploadMedidaCautelar(itemId, arquivo, descricao)
      setResultado(res)
      setAberto(false)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar')
    } finally {
      setEnviando(false)
    }
  }

  if (resultado) {
    return (
      <div className="flex items-center gap-3 bg-tertiary-fixed/10 border border-tertiary/20 rounded-lg px-4 py-3">
        <Icone nome="check_circle" className="text-tertiary text-[20px]" />
        <div className="flex-1">
          <p className="text-body-md text-on-surface font-semibold">Medida cautelar incluída: {resultado.documento_formatado}</p>
          <p className="text-[11px] text-on-surface-variant">{resultado.mensagem}</p>
        </div>
        {resultado.link_sei && (
          <a href={resultado.link_sei} target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 border border-primary text-primary text-[11px] rounded-lg hover:bg-primary/5 inline-flex items-center gap-1">
            Abrir no SEI <Icone nome="open_in_new" className="text-[12px]" />
          </a>
        )}
      </div>
    )
  }

  return (
    <div>
      {!aberto ? (
        <button
          onClick={() => setAberto(true)}
          className="inline-flex items-center gap-2 px-4 py-2 border border-outline-variant text-on-surface-variant text-label-sm rounded-lg hover:bg-surface-container-high transition-colors"
        >
          <Icone nome="attach_file" className="text-[16px]" />
          Anexar medida cautelar
        </button>
      ) : (
        <div className="bg-surface-container-low border border-outline-variant rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h5 className="text-label-lg text-on-surface font-semibold">Anexar medida cautelar</h5>
            <button onClick={() => setAberto(false)} className="text-on-surface-variant hover:text-on-surface">
              <Icone nome="close" className="text-[18px]" />
            </button>
          </div>
          <p className="text-[11px] text-on-surface-variant">
            Anexe o print de tela ou documento comprovando a medida cautelar (bloqueio). Aceita imagens e PDF (até 10 MB).
          </p>
          <input
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => setArquivo(e.target.files?.[0] ?? null)}
            className="block w-full text-body-md text-on-surface-variant file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border file:border-outline-variant file:text-label-sm file:bg-surface-container-high file:text-on-surface hover:file:bg-surface-container"
          />
          <input
            type="text"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição do documento"
            className="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md"
          />
          {erro && <p className="text-[11px] text-error">{erro}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setAberto(false)} className="px-4 py-2 text-label-sm text-on-surface-variant hover:bg-surface-container-high rounded-lg">
              Cancelar
            </button>
            <button
              onClick={handleEnviar}
              disabled={!arquivo || enviando}
              className="px-4 py-2 bg-primary text-white text-label-sm font-bold rounded-lg hover:bg-primary-container transition-colors disabled:opacity-50 inline-flex items-center gap-1"
            >
              {enviando && <Icone nome="progress_activity" className="animate-spin text-[14px]" />}
              Enviar ao SEI
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


function AcoesPorFase({ itemId }: { itemId: string }) {
  const [fase, setFase] = useState<FaseAtualResponse | null>(null)
  const [editorAberto, setEditorAberto] = useState(false)
  const [templateData, setTemplateData] = useState<
    { titulo: string; html: string; fase: string; marcadores?: Marcador[] } | null
  >(null)
  const [carregandoTemplate, setCarregandoTemplate] = useState(false)
  const [erroTemplate, setErroTemplate] = useState<string | null>(null)
  const [resultado, setResultado] = useState<{ mensagem: string; fase_avancada_para: string | null } | null>(null)
  const [modeloEscolhido, setModeloEscolhido] = useState('')
  const [enviandoAnexo, setEnviandoAnexo] = useState(false)
  const inputAnexoRef = useRef<HTMLInputElement>(null)

  // Estado de procurador (inline no card do saneador)
  const [temProcurador, setTemProcurador] = useState<boolean | null>(null)
  const [nomeProcurador, setNomeProcurador] = useState('')
  const [oabProcurador, setOabProcurador] = useState('')
  const [emailProcurador, setEmailProcurador] = useState('')
  const [avisoProcurador, setAvisoProcurador] = useState<string | null>(null)
  const [salvandoProcurador, setSalvandoProcurador] = useState(false)

  function recarregarFase() {
    obterFaseAtual(itemId).then(setFase).catch(() => {})
  }

  useEffect(() => { recarregarFase() }, [itemId])

  // Ao trocar de passo, volta para o modelo sugerido daquele passo.
  useEffect(() => {
    setModeloEscolhido(fase?.passo_atual?.modelos?.[0]?.chave ?? '')
  }, [fase?.passo_atual?.chave_documento])

  async function handleAbrirEditor() {
    // Se é o saneador e tem procurador, salvar antes de abrir o editor
    const passo = fase?.passo_atual
    if (passo?.chave_documento === 'saneador' && temProcurador && nomeProcurador.trim() && oabProcurador.trim()) {
      setSalvandoProcurador(true)
      try {
        const { criarAdvogado, vincularAdvogadoProcesso } = await import('../advogados/api')
        const adv = await criarAdvogado(nomeProcurador.trim(), oabProcurador.trim(), emailProcurador.trim() || undefined)
        await vincularAdvogadoProcesso(adv.id, Number(itemId))
      } catch {
        // Erro ao salvar procurador não impede o fluxo
      } finally {
        setSalvandoProcurador(false)
      }
    }

    setCarregandoTemplate(true)
    setResultado(null)
    setErroTemplate(null)
    try {
      const data = await obterTemplateFase(itemId, modeloEscolhido || undefined)
      setTemplateData(data)
      setEditorAberto(true)
    } catch (e) {
      setErroTemplate(e instanceof Error ? e.message : String(e))
    } finally {
      setCarregandoTemplate(false)
    }
  }

  async function verificarOabProcurador() {
    if (!oabProcurador.trim()) return
    try {
      const { buscarPorOab } = await import('../advogados/api')
      const res = await buscarPorOab(oabProcurador.trim())
      if (res.encontrado && res.advogado) {
        setAvisoProcurador(`OAB encontrada: ${res.advogado.nome}`)
        setNomeProcurador(res.advogado.nome)
        if (res.advogado.email) setEmailProcurador(res.advogado.email)
      } else {
        setAvisoProcurador(null)
      }
    } catch {
      // Silencioso
    }
  }

  async function handleAnexar(evento: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0]
    if (!arquivo) return

    setEnviandoAnexo(true)
    setErroTemplate(null)
    setResultado(null)
    try {
      const res = await anexarDocumentoFase(itemId, arquivo)
      setResultado(res)
      recarregarFase()
    } catch (e) {
      setErroTemplate(e instanceof Error ? e.message : String(e))
    } finally {
      setEnviandoAnexo(false)
      // Limpa o input para o mesmo arquivo poder ser escolhido de novo.
      if (inputAnexoRef.current) inputAnexoRef.current.value = ''
    }
  }

  if (!fase?.fase_atual) return null

  const passo = fase.passo_atual
  const temMaisDeUmPasso = (passo?.total ?? 0) > 1
  const modelos = passo?.modelos ?? []
  const ehAnexo = passo?.tipo === 'anexo'

  return (
    <div className="space-y-3">
      {/* Resultado da última ação */}
      {resultado && (
        <div className="bg-tertiary-fixed/10 border border-tertiary/20 rounded-lg px-4 py-3 flex items-start gap-3">
          <Icone nome="check_circle" className="text-tertiary text-[20px] mt-0.5" />
          <div className="flex-1">
            <p className="text-body-md text-on-surface font-semibold">{resultado.mensagem}</p>
            {resultado.fase_avancada_para && (
              <p className="text-[11px] text-on-surface-variant">Fase avançada automaticamente.</p>
            )}
          </div>
        </div>
      )}

      {/* Próximo documento da fase. Título, descrição e assinantes vêm do
          backend (services/catalogo_fases.py), para a tela não repetir a regra
          de qual documento cada fase produz. */}
      {passo && (
        <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-card p-stack-md space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-label-lg text-on-surface uppercase flex items-center gap-2">
              <Icone nome="edit_note" className="text-[18px] text-primary" />
              Próximo passo
            </h4>
            {temMaisDeUmPasso && (
              <span className="text-label-sm text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full shrink-0">
                {passo.numero} de {passo.total}
              </span>
            )}
          </div>

          <p className="text-body-md text-on-surface font-semibold">{passo.titulo}</p>
          {passo.descricao && (
            <p className="text-[11px] text-on-surface-variant">{passo.descricao}</p>
          )}

          <dl className="text-[11px] text-on-surface-variant space-y-1">
            {passo.cargos_assinatura.length > 0 && (
              <div className="flex gap-1">
                <dt className="font-semibold">Assinatura:</dt>
                <dd>{passo.cargos_assinatura.join(' e ')}</dd>
              </div>
            )}
            {passo.dias_prazo !== null && (
              <div className="flex gap-1">
                <dt className="font-semibold">Prazo:</dt>
                <dd>{passo.dias_prazo} dias, aberto no SEI junto com o documento</dd>
              </div>
            )}
          </dl>

          {/* Escolha do modelo. As três decisões e os três relatórios opinativos
              são o mesmo ato da mesma fase, mudando só o texto — então quem
              decide qual usar é o analista, não o sistema. */}
          {modelos.length > 1 && (
            <label className="block">
              <span className="text-label-sm text-on-surface-variant">Modelo</span>
              <select
                value={modeloEscolhido}
                onChange={(e) => setModeloEscolhido(e.target.value)}
                className="mt-1 w-full bg-white border border-outline-variant rounded-lg px-3 py-2 text-body-md text-on-surface"
                aria-label="Escolher o modelo do documento"
              >
                {modelos.map((m) => (
                  <option key={m.chave} value={m.chave}>{m.nome}</option>
                ))}
              </select>
            </label>
          )}

          {ehAnexo ? (
            <>
              <input
                ref={inputAnexoRef}
                type="file"
                accept="application/pdf"
                onChange={handleAnexar}
                className="hidden"
                aria-label={`Anexar ${passo.titulo}`}
              />
              <button
                onClick={() => inputAnexoRef.current?.click()}
                disabled={enviandoAnexo}
                className="w-full px-4 py-3 bg-primary text-white text-label-lg font-bold rounded-lg hover:bg-primary-container transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {enviandoAnexo
                  ? <Icone nome="progress_activity" className="animate-spin text-[18px]" />
                  : <Icone nome="upload_file" className="text-[18px]" />}
                {enviandoAnexo ? 'Enviando...' : `Anexar ${passo.titulo} (PDF)`}
              </button>
            </>
          ) : (
            <>
              {/* Pergunta obrigatória de procurador (saneador) */}
              {passo.chave_documento === 'saneador' && (
                <div className="bg-secondary-fixed/10 border border-secondary-container/30 rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Icone nome="person_search" className="text-[18px] text-secondary" />
                    <span className="text-label-lg text-on-surface font-semibold">O processo possui procurador?</span>
                    <span className="text-[10px] text-error font-bold ml-1">*obrigatório</span>
                  </div>

                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-body-md text-on-surface cursor-pointer">
                      <input
                        type="radio"
                        name="procurador"
                        checked={temProcurador === true}
                        onChange={() => setTemProcurador(true)}
                      />
                      Sim
                    </label>
                    <label className="flex items-center gap-2 text-body-md text-on-surface cursor-pointer">
                      <input
                        type="radio"
                        name="procurador"
                        checked={temProcurador === false}
                        onChange={() => setTemProcurador(false)}
                      />
                      Não
                    </label>
                  </div>

                  {temProcurador === true && (
                    <div className="space-y-3 pl-4 border-l-2 border-primary/30">
                      <label className="block">
                        <span className="text-label-md text-on-surface-variant">OAB</span>
                        <input
                          type="text"
                          value={oabProcurador}
                          onChange={(e) => { setOabProcurador(e.target.value); setAvisoProcurador(null) }}
                          onBlur={verificarOabProcurador}
                          className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
                          placeholder="Ex: 123456/SP"
                        />
                        {avisoProcurador && (
                          <p className="text-[11px] text-tertiary mt-1 flex items-center gap-1">
                            <Icone nome="check_circle" className="text-[14px]" />
                            {avisoProcurador}
                          </p>
                        )}
                      </label>
                      <label className="block">
                        <span className="text-label-md text-on-surface-variant">Nome completo</span>
                        <input
                          type="text"
                          value={nomeProcurador}
                          onChange={(e) => setNomeProcurador(e.target.value)}
                          className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
                          placeholder="Nome do advogado"
                        />
                      </label>
                      <label className="block">
                        <span className="text-label-md text-on-surface-variant">Email</span>
                        <input
                          type="email"
                          value={emailProcurador}
                          onChange={(e) => setEmailProcurador(e.target.value)}
                          className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
                          placeholder="email@exemplo.com"
                        />
                      </label>
                    </div>
                  )}


                </div>
              )}

              <button
                onClick={handleAbrirEditor}
                disabled={carregandoTemplate || salvandoProcurador || (passo.chave_documento === 'saneador' && (temProcurador === null || (temProcurador && (!nomeProcurador.trim() || !oabProcurador.trim()))))}
                className="w-full px-4 py-3 bg-primary text-white text-label-lg font-bold rounded-lg hover:bg-primary-container transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {(carregandoTemplate || salvandoProcurador)
                  ? <Icone nome="progress_activity" className="animate-spin text-[18px]" />
                  : <Icone nome="description" className="text-[18px]" />}
                {salvandoProcurador ? 'Salvando procurador...' : `Gerar ${passo.titulo}`}
              </button>
            </>
          )}

          {erroTemplate && (
            <p role="alert" className="text-[11px] text-error bg-error-container/40 rounded-md px-3 py-2">
              {erroTemplate}
            </p>
          )}
        </div>
      )}

      {/* Fases em que o app espera o interessado */}
      {fase.aguardando && (
        <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-card p-stack-md">
          <div className="flex items-center gap-2 text-secondary">
            <Icone nome="hourglass_top" className="text-[20px]" />
            <p className="text-body-md font-semibold">Aguardando manifestação do interessado</p>
          </div>
          <p className="text-[11px] text-on-surface-variant mt-2">{fase.aguardando}</p>
        </div>
      )}

      {/* Editor modal */}
      {editorAberto && templateData && (
        <EditorFaseModal
          itemId={itemId}
          titulo={templateData.titulo}
          htmlInicial={templateData.html}
          marcadores={templateData.marcadores ?? []}
          modelo={modeloEscolhido || undefined}
          onClose={() => { setEditorAberto(false); setTemplateData(null) }}
          onSucesso={(res) => {
            setEditorAberto(false)
            setTemplateData(null)
            setResultado(res)
            recarregarFase()
          }}
        />
      )}
    </div>
  )
}

function BotaoAcaoFase({ itemId, endpoint, label, icone }: { itemId: string; endpoint: string; label: string; icone: string }) {
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<{ link_sei: string | null; mensagem: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function handleClick() {
    setEnviando(true)
    setErro(null)
    try {
      const res = await apiPost<{ sucesso: boolean; link_sei: string | null; mensagem: string }>(
        `/processos-andamento/${itemId}/${endpoint}`, {},
      )
      setResultado(res)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro')
    } finally {
      setEnviando(false)
    }
  }

  if (resultado) {
    return (
      <div className="inline-flex items-center gap-1 px-3 py-1.5 bg-tertiary-fixed/20 text-tertiary text-[11px] font-bold rounded-lg">
        <Icone nome="check" className="text-[14px]" />
        {label}
        {resultado.link_sei && (
          <a href={resultado.link_sei} target="_blank" rel="noopener noreferrer" className="ml-1 underline">
            SEI
          </a>
        )}
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={enviando}
        className="inline-flex items-center gap-1 px-3 py-1.5 border border-outline-variant text-on-surface-variant text-[11px] font-bold rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50"
      >
        {enviando ? <Icone nome="progress_activity" className="animate-spin text-[14px]" /> : <Icone nome={icone} className="text-[14px]" />}
        {label}
      </button>
      {erro && <p className="text-[9px] text-error mt-0.5">{erro}</p>}
    </div>
  )
}


function EditorFaseModal({ itemId, titulo, htmlInicial, marcadores = [], modelo, onClose, onSucesso }: {
  itemId: string
  titulo: string
  htmlInicial: string
  /** Lacunas do modelo, preenchidas antes do editor abrir (mala direta). */
  marcadores?: Marcador[]
  /** Modelo escolhido — define a série do documento no SEI. */
  modelo?: string
  onClose: () => void
  onSucesso: (res: { mensagem: string; fase_avancada_para: string | null }) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Modelo com lacuna abre no formulário; sem lacuna, direto no editor.
  const temCampos = camposPreenchiveis(marcadores).length > 0
  const [preenchendo, setPreenchendo] = useState(temCampos)
  const [valores, setValores] = useState<Record<string, ValorCampo>>(
    () => valoresIniciais(marcadores),
  )

  useEffect(() => {
    if (preenchendo) return
    if (editorRef.current && editorRef.current.innerHTML === '') {
      // A substituição parte sempre do modelo original: reaplicar sobre o texto
      // já preenchido não encontraria mais os marcadores.
      editorRef.current.innerHTML = aplicarMarcadores(htmlInicial, marcadores, valores)
    }
  }, [htmlInicial, marcadores, preenchendo, valores])

  async function handleEnviar() {
    const html = editorRef.current?.innerHTML ?? ''
    setEnviando(true)
    setErro(null)
    try {
      const res = await apiPost<{ sucesso: boolean; mensagem: string; fase_avancada_para: string | null }>(
        `/processos-andamento/${itemId}/fase-acao/executar`, { html, modelo },
      )
      onSucesso(res)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest rounded-lg shadow-card w-[98vw] max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-stack-lg py-stack-md border-b border-outline-variant">
          <h3 className="text-headline-sm text-on-surface">{titulo}</h3>
          <button
            onClick={onClose}
            disabled={enviando}
            className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors disabled:opacity-30"
            aria-label="Fechar"
          >
            <Icone nome="close" />
          </button>
        </div>

        {/* Corpo: primeiro os dados do documento, depois o editor */}
        <div className="flex-1 overflow-y-auto p-stack-lg space-y-4">
          {erro && (
            <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg" role="alert">
              {erro}
            </div>
          )}

          {preenchendo ? (
            <MalaDiretaForm
              marcadores={marcadores}
              valores={valores}
              onChange={(campoId, valor) => setValores((v) => ({ ...v, [campoId]: valor }))}
            />
          ) : (
            <>
              <p className="text-body-md text-on-surface-variant bg-secondary-container/10 border border-secondary-container/30 rounded-lg px-4 py-3">
                Edite o texto abaixo conforme necessário. Ao confirmar, o documento será incluído no SEI e a fase avançará automaticamente.
              </p>

              <div className="rounded-lg border border-outline-variant overflow-hidden bg-white">
                <div
                  ref={editorRef}
                  contentEditable={!enviando}
                  suppressContentEditableWarning
                  className="doc-isolado min-h-[300px] p-4 focus:outline-none"
                  aria-label="Editor do documento"
                />
              </div>
            </>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end gap-3 px-stack-lg py-stack-md border-t border-outline-variant">
          <button
            onClick={onClose}
            disabled={enviando}
            className="px-4 py-2 text-on-surface-variant text-label-lg rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>

          {preenchendo ? (
            /* Sempre habilitado: campo em branco é permitido e mantém a
               marcação no texto para resolver no editor. */
            <button
              onClick={() => setPreenchendo(false)}
              className="px-6 py-2 bg-primary text-white text-label-lg font-bold rounded-lg hover:bg-primary-container transition-colors inline-flex items-center gap-2"
            >
              Continuar para o documento
              <Icone nome="arrow_forward" className="text-[18px]" />
            </button>
          ) : (
            <>
              {temCampos && (
                <button
                  onClick={() => setPreenchendo(true)}
                  disabled={enviando}
                  className="px-4 py-2 border border-outline-variant text-on-surface-variant text-label-lg rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                  title="Refaz o documento a partir do modelo, com os dados que você informar"
                >
                  <Icone nome="arrow_back" className="text-[18px]" />
                  Rever dados
                </button>
              )}
              <button
                onClick={handleEnviar}
                disabled={enviando}
                className="px-6 py-2 bg-primary text-white text-label-lg font-bold rounded-lg hover:bg-primary-container transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                {enviando && <Icone nome="progress_activity" className="animate-spin text-[16px]" />}
                Confirmar e enviar ao SEI
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
