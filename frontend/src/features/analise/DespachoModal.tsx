import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError } from '../../api/client'
import { Icone } from '../../components/Icone'
import { MalaDiretaForm } from '../../components/MalaDiretaForm'
import {
  aplicarMarcadores,
  camposPreenchiveis,
  valoresIniciais,
  type Marcador,
  type ValorCampo,
} from '../../lib/malaDireta'
import { executarDespacho, obterTemplateDespacho } from './api'
import type { ResultadoDespacho, TipoDespacho } from './types'

/** Informações de erro exibidas ao usuário, já classificadas. */
interface ErroDespacho {
  mensagem: string
  /** true = instabilidade do SEI, pode tentar de novo com segurança. */
  temporario: boolean
  /** Preenchido quando algo já foi criado no SEI antes da falha (ex.: um novo
   *  processo de instauração) — nesse caso NÃO oferecemos "tentar novamente"
   *  automático, pois isso duplicaria o que já existe. */
  numeroSeiCriado?: string | null
}

const TITULOS: Record<TipoDespacho, string> = {
  arquivar: 'Arquivar processo',
  tac: 'Termo de Ajustamento de Conduta (TAC)',
  instaurar: 'Instaurar processo administrativo',
}

const DESCRICOES: Record<TipoDespacho, string> = {
  arquivar: 'Um novo documento será criado no mesmo processo SEI da fiscalização.',
  tac: 'Um novo documento será criado no mesmo processo SEI da fiscalização.',
  instaurar:
    'Será criado um NOVO número de processo SEI para o processamento administrativo, com este documento incluído.',
}

interface DespachoModalProps {
  itemId: number | string
  tipo: TipoDespacho
  onClose: () => void
  onSucesso: (resultado: ResultadoDespacho) => void
}

// 'preenchendo' é a etapa de mala direta: as lacunas do modelo são preenchidas
// antes do editor abrir. Só aparece quando o modelo tem lacuna — modelo sem
// marcador vai direto para 'editando', sem etapa vazia no caminho.
type Etapa = 'carregando' | 'preenchendo' | 'editando' | 'confirmando' | 'enviando' | 'erro'

interface BotaoFormatacao {
  comando: string
  valor?: string
  icone: string
  titulo: string
}

const BOTOES_FORMATACAO: BotaoFormatacao[] = [
  { comando: 'bold', icone: 'format_bold', titulo: 'Negrito' },
  { comando: 'italic', icone: 'format_italic', titulo: 'Itálico' },
  { comando: 'underline', icone: 'format_underlined', titulo: 'Sublinhado' },
  { comando: 'strikeThrough', icone: 'format_strikethrough', titulo: 'Tachado' },
  { comando: 'subscript', icone: 'subscript', titulo: 'Subscrito' },
  { comando: 'superscript', icone: 'superscript', titulo: 'Sobrescrito' },
]

const BOTOES_ALINHAMENTO: BotaoFormatacao[] = [
  { comando: 'justifyLeft', icone: 'format_align_left', titulo: 'Alinhar à esquerda' },
  { comando: 'justifyCenter', icone: 'format_align_center', titulo: 'Centralizar' },
  { comando: 'justifyRight', icone: 'format_align_right', titulo: 'Alinhar à direita' },
  { comando: 'justifyFull', icone: 'format_align_justify', titulo: 'Justificar' },
]

const BOTOES_LISTA: BotaoFormatacao[] = [
  { comando: 'insertUnorderedList', icone: 'format_list_bulleted', titulo: 'Lista com marcadores' },
  { comando: 'insertOrderedList', icone: 'format_list_numbered', titulo: 'Lista numerada' },
  { comando: 'indent', icone: 'format_indent_increase', titulo: 'Aumentar recuo' },
  { comando: 'outdent', icone: 'format_indent_decrease', titulo: 'Diminuir recuo' },
]

const BOTOES_HISTORICO: BotaoFormatacao[] = [
  { comando: 'undo', icone: 'undo', titulo: 'Desfazer' },
  { comando: 'redo', icone: 'redo', titulo: 'Refazer' },
  { comando: 'removeFormat', icone: 'format_clear', titulo: 'Limpar formatação' },
]

/** Estilos de bloco do SEI (aplicados como classe CSS no <p>). */
interface EstiloBloco {
  label: string
  classe: string
}

const ESTILOS_BLOCO: EstiloBloco[] = [
  { label: 'Texto_Justificado_Recuo_Primeira_Linha', classe: 'Texto_Justificado_Recuo_Primeira_Linha' },
  { label: 'Texto_Justificado', classe: 'Texto_Justificado' },
  { label: 'Texto_Centralizado', classe: 'Texto_Centralizado' },
  { label: 'Texto_Alinhado_Direita', classe: 'Texto_Alinhado_Direita' },
  { label: 'Tabela_Texto_8', classe: 'Tabela_Texto_8' },
  { label: 'Citacao', classe: 'Citacao' },
  { label: 'Tarja_Titulo', classe: 'Tarja_Titulo' },
]

const ESTILOS_NUMERACAO: EstiloBloco[] = [
  { label: 'Paragrafo_Numerado_Nivel1', classe: 'Paragrafo_Numerado_Nivel1' },
  { label: 'Item_Nivel1', classe: 'Item_Nivel1' },
  { label: 'Item_Alinea_Letra', classe: 'Item_Alinea_Letra' },
  { label: 'Item_Inciso_Romano', classe: 'Item_Inciso_Romano' },
]

export function DespachoModal({ itemId, tipo, onClose, onSucesso }: DespachoModalProps) {
  const [etapa, setEtapa] = useState<Etapa>('carregando')
  const [erroCarregamento, setErroCarregamento] = useState<string | null>(null)
  const [erroEnvio, setErroEnvio] = useState<ErroDespacho | null>(null)
  const [cautelar, setCautelar] = useState(false)
  const [estiloAtual, setEstiloAtual] = useState<string>('')
  const [marcadores, setMarcadores] = useState<Marcador[]>([])
  const [valores, setValores] = useState<Record<string, ValorCampo>>({})
  const editorRef = useRef<HTMLDivElement>(null)
  // Modelo como veio da API, sem preenchimento. Guardado à parte para o
  // "Voltar" ao formulário poder refazer a substituição do zero — reaplicar
  // sobre o texto já preenchido não encontraria mais os marcadores.
  const htmlOriginalRef = useRef<string>('')
  const htmlCarregadoRef = useRef<string>('')
  // Guarda o HTML editado no momento do clique em "Confirmar", pois o editor
  // pode ser desmontado (ex.: etapa de confirmação da Instauração) antes do
  // envio de fato acontecer.
  const htmlParaEnviarRef = useRef<string>('')

  useEffect(() => {
    let ativo = true
    setEtapa('carregando')
    setErroCarregamento(null)
    obterTemplateDespacho(itemId, tipo)
      .then((r) => {
        if (!ativo) return
        htmlOriginalRef.current = r.html
        htmlCarregadoRef.current = r.html
        const lista = r.marcadores ?? []
        setMarcadores(lista)
        setValores(valoresIniciais(lista))
        // Sem lacuna a preencher, o formulário não tem o que mostrar.
        setEtapa(camposPreenchiveis(lista).length > 0 ? 'preenchendo' : 'editando')
      })
      .catch((e) => {
        if (!ativo) return
        setErroCarregamento(e instanceof ApiError ? e.message : String(e))
        setEtapa('erro')
      })
    return () => {
      ativo = false
    }
  }, [itemId, tipo])

  useEffect(() => {
    if (etapa === 'editando' && editorRef.current && editorRef.current.innerHTML === '') {
      editorRef.current.innerHTML = htmlCarregadoRef.current
    }
  }, [etapa])

  /** Aplica os valores do formulário e abre o editor com o texto já montado. */
  function avancarParaEditor() {
    htmlCarregadoRef.current = aplicarMarcadores(
      htmlOriginalRef.current, marcadores, valores,
    )
    setEtapa('editando')
  }

  function aplicarFormatacao(comando: string, valor?: string) {
    editorRef.current?.focus()
    document.execCommand(comando, false, valor)
  }

  function detectarEstiloAtual() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) { setEstiloAtual(''); return }
    let node: Node | null = sel.getRangeAt(0).startContainer
    while (node && node !== editorRef.current) {
      if (node.nodeType === 1 && (node as HTMLElement).tagName === 'P') {
        setEstiloAtual((node as HTMLElement).className || '')
        return
      }
      node = node.parentNode
    }
    setEstiloAtual('')
  }

  function aplicarEstiloBloco(classe: string) {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    let node: Node | null = range.startContainer
    while (node && node !== editorRef.current) {
      if (node.nodeType === 1 && (node as HTMLElement).tagName === 'P') {
        const el = node as HTMLElement
        el.className = classe
        break
      }
      node = node.parentNode
    }
    setEstiloAtual(classe)
    editorRef.current?.focus()
  }

  function pedirConfirmacao() {
    // Captura o HTML atual ANTES de qualquer troca de etapa, para não
    // depender do editor continuar montado no DOM depois deste ponto.
    htmlParaEnviarRef.current = editorRef.current?.innerHTML ?? ''
    setErroEnvio(null)
    if (tipo === 'instaurar') {
      setEtapa('confirmando')
    } else {
      enviar()
    }
  }

  async function enviar() {
    const htmlFinal = htmlParaEnviarRef.current
    setEtapa('enviando')
    setErroEnvio(null)
    try {
      const resultado = await executarDespacho(itemId, tipo, htmlFinal, cautelar)
      onSucesso(resultado)
    } catch (e) {
      if (e instanceof ApiError) {
        setErroEnvio({
          mensagem: e.message,
          temporario: e.temporario,
          numeroSeiCriado: e.detail?.numero_sei_criado,
        })
      } else {
        // Erro de rede não classificado pelo backend (ex.: sem conexão local).
        // Tratamos como temporário: é seguro tentar de novo, pois a requisição
        // provavelmente nem chegou a ser processada pelo servidor.
        setErroEnvio({ mensagem: String(e), temporario: true })
      }
      setEtapa('editando')
    }
  }

  // Renderizado via portal direto em document.body para não ficar sujeito ao
  // stacking context do header (sticky) do Layout, que antes ficava por cima
  // do topo do overlay.
  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={TITULOS[tipo]}
    >
      <div className="bg-surface-container-lowest rounded-lg shadow-card w-[98vw] max-w-7xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-stack-lg py-stack-md border-b border-outline-variant">
          <h3 className="text-headline-sm text-on-surface">{TITULOS[tipo]}</h3>
          <button
            onClick={onClose}
            disabled={etapa === 'enviando'}
            className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Fechar"
          >
            <Icone nome="close" />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-stack-lg space-y-4">
          {etapa === 'carregando' && (
            <div className="flex items-center justify-center py-16 gap-2 text-on-surface-variant">
              <Icone nome="progress_activity" className="animate-spin" />
              <span className="text-body-lg">Carregando modelo do documento...</span>
            </div>
          )}

          {etapa === 'erro' && (
            <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg" role="alert">
              {erroCarregamento ?? 'Erro ao carregar o modelo do documento.'}
            </div>
          )}

          {etapa === 'preenchendo' && (
            <MalaDiretaForm
              marcadores={marcadores}
              valores={valores}
              onChange={(campoId, valor) => setValores((v) => ({ ...v, [campoId]: valor }))}
            />
          )}

          {(etapa === 'editando' || etapa === 'enviando') && (
            <>
              <p className="text-body-md text-on-surface-variant bg-secondary-container/10 border border-secondary-container/30 rounded-lg px-4 py-3">
                {DESCRICOES[tipo]}
              </p>

              {erroEnvio && <AvisoErroEnvio erro={erroEnvio} />}

              {tipo === 'instaurar' && (
                <label className="flex items-center gap-2 text-body-md text-on-surface">
                  <input
                    type="checkbox"
                    checked={cautelar}
                    onChange={(e) => setCautelar(e.target.checked)}
                    disabled={etapa === 'enviando'}
                  />
                  Instauração com medida cautelar (documento vai para assinatura do Coordenador)
                </label>
              )}

              {/* Editor com barra de ferramentas, no estilo do editor do SEI */}
              <div className="rounded-lg border border-outline-variant overflow-hidden bg-white">
                <div className="flex flex-wrap items-center gap-1 bg-surface-container-low border-b border-outline-variant px-2 py-1.5">
                  <DropdownEstilos label="Estilos" estilos={ESTILOS_BLOCO} onSelecionar={aplicarEstiloBloco} desabilitado={etapa === 'enviando'} valorAtual={estiloAtual} />
                  <DropdownEstilos label="Numeração" estilos={ESTILOS_NUMERACAO} onSelecionar={aplicarEstiloBloco} desabilitado={etapa === 'enviando'} valorAtual={estiloAtual} />
                  <Separador />
                  <GrupoBotoes botoes={BOTOES_FORMATACAO} onClick={aplicarFormatacao} desabilitado={etapa === 'enviando'} />
                  <Separador />
                  <GrupoBotoes botoes={BOTOES_ALINHAMENTO} onClick={aplicarFormatacao} desabilitado={etapa === 'enviando'} />
                  <Separador />
                  <GrupoBotoes botoes={BOTOES_LISTA} onClick={aplicarFormatacao} desabilitado={etapa === 'enviando'} />
                  <Separador />
                  <GrupoBotoes botoes={BOTOES_HISTORICO} onClick={aplicarFormatacao} desabilitado={etapa === 'enviando'} />
                </div>
                <div
                  ref={editorRef}
                  contentEditable={etapa !== 'enviando'}
                  suppressContentEditableWarning
                  className="doc-isolado"
                  aria-label="Editor do documento"
                  onKeyUp={detectarEstiloAtual}
                  onClick={detectarEstiloAtual}
                />
              </div>
            </>
          )}

          {etapa === 'confirmando' && (
            <div className="space-y-4 py-8 text-center">
              <Icone nome="warning" className="text-5xl text-tertiary" />
              <p className="text-body-lg text-on-surface font-semibold">Tem certeza que deseja instaurar?</p>
              <p className="text-body-md text-on-surface-variant max-w-md mx-auto">
                Esta ação cria um NOVO número de processo SEI para o processamento administrativo.
                Essa operação não pode ser desfeita automaticamente pelo sistema.
              </p>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end gap-3 px-stack-lg py-stack-md border-t border-outline-variant">
          {etapa === 'preenchendo' ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 border border-outline-variant text-on-surface-variant rounded-lg hover:bg-surface-container-high transition-colors"
              >
                Cancelar
              </button>
              {/* Sempre habilitado: campo em branco é permitido e mantém a
                  marcação no texto para o analista resolver no editor. */}
              <button
                onClick={avancarParaEditor}
                className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-container transition-colors shadow-card inline-flex items-center gap-2"
              >
                Continuar para o documento
                <Icone nome="arrow_forward" className="text-[18px]" />
              </button>
            </>
          ) : etapa === 'confirmando' ? (
            <>
              <button
                onClick={() => setEtapa('editando')}
                className="px-4 py-2 border border-outline-variant text-on-surface-variant rounded-lg hover:bg-surface-container-high transition-colors"
              >
                Voltar
              </button>
              <button
                onClick={enviar}
                className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-container transition-colors shadow-card"
              >
                Sim, instaurar
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={etapa === 'enviando'}
                className="px-4 py-2 border border-outline-variant text-on-surface-variant rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              {/* Volta ao formulário e remonta o documento do modelo original,
                  descartando o que foi digitado no editor. */}
              {camposPreenchiveis(marcadores).length > 0 && (
                <button
                  onClick={() => setEtapa('preenchendo')}
                  disabled={etapa === 'enviando'}
                  className="px-4 py-2 border border-outline-variant text-on-surface-variant rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                  title="Refaz o documento a partir do modelo, com os dados que você informar"
                >
                  <Icone nome="arrow_back" className="text-[18px]" />
                  Rever dados
                </button>
              )}
              <button
                onClick={pedirConfirmacao}
                disabled={etapa !== 'editando' || Boolean(erroEnvio?.numeroSeiCriado)}
                title={erroEnvio?.numeroSeiCriado ? 'Ação bloqueada para evitar duplicidade — continue manualmente no SEI' : undefined}
                className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-container transition-colors shadow-card disabled:opacity-50 inline-flex items-center gap-2"
              >
                {etapa === 'enviando' && <Icone nome="progress_activity" className="animate-spin text-[18px]" />}
                {etapa === 'enviando' ? 'Enviando...' : 'Confirmar e criar no SEI'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ─── Sub-componentes da barra de ferramentas ─── */

function GrupoBotoes({
  botoes,
  onClick,
  desabilitado,
}: {
  botoes: BotaoFormatacao[]
  onClick: (comando: string, valor?: string) => void
  desabilitado: boolean
}) {
  return (
    <div className="flex items-center gap-0.5">
      {botoes.map((b) => (
        <button
          key={b.comando}
          type="button"
          title={b.titulo}
          aria-label={b.titulo}
          disabled={desabilitado}
          onMouseDown={(e) => {
            // Evita perder a seleção de texto do editor ao clicar no botão.
            e.preventDefault()
          }}
          onClick={() => onClick(b.comando, b.valor)}
          className="p-1.5 rounded text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors disabled:opacity-40 disabled:pointer-events-none"
        >
          <Icone nome={b.icone} className="text-[18px]" />
        </button>
      ))}
    </div>
  )
}

function Separador() {
  return <div className="w-px h-5 bg-outline-variant mx-1" />
}

function DropdownEstilos({
  label,
  estilos,
  onSelecionar,
  desabilitado,
  valorAtual,
}: {
  label: string
  estilos: EstiloBloco[]
  onSelecionar: (classe: string) => void
  desabilitado: boolean
  valorAtual?: string
}) {
  // Verificar se o estilo atual pertence a este dropdown
  const estiloAtivo = estilos.find((e) => e.classe === valorAtual)

  return (
    <select
      className="text-[11px] bg-white border border-outline-variant rounded px-1.5 py-1 text-on-surface-variant cursor-pointer hover:border-primary focus:outline-none focus:border-primary disabled:opacity-40 max-w-[180px]"
      disabled={desabilitado}
      value={estiloAtivo ? estiloAtivo.classe : ''}
      onChange={(e) => {
        if (e.target.value) onSelecionar(e.target.value)
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title={label}
    >
      <option value="">{label}</option>
      {estilos.map((est) => (
        <option key={est.classe} value={est.classe}>{est.label}</option>
      ))}
    </select>
  )
}

/**
 * Aviso de erro ao enviar o despacho, com o tratamento adequado para cada caso:
 * - Temporário (SEI instável/fora do ar): mensagem tranquilizadora, indicando
 *   que é seguro tentar de novo pelo próprio botão "Confirmar".
 * - Definitivo sem nada criado: indica que algo precisa ser verificado/ajustado
 *   antes de tentar de novo.
 * - Definitivo com processo já criado no SEI: alerta forte para NÃO tentar de
 *   novo pelo botão (duplicaria o processo) e orienta continuar manualmente.
 */
function AvisoErroEnvio({ erro }: { erro: ErroDespacho }) {
  if (erro.numeroSeiCriado) {
    return (
      <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg space-y-2" role="alert">
        <div className="flex items-center gap-2 font-bold">
          <Icone nome="report" className="text-[20px]" />
          Atenção: processo {erro.numeroSeiCriado} já foi criado no SEI
        </div>
        <p className="text-body-md">{erro.mensagem}</p>
        <p className="text-body-md font-semibold">
          Não clique em "Confirmar" novamente — isso criaria um processo duplicado. Acesse o
          processo {erro.numeroSeiCriado} diretamente no site do SEI para continuar manualmente.
        </p>
      </div>
    )
  }

  if (erro.temporario) {
    return (
      <div className="bg-tertiary-fixed/20 text-on-surface px-4 py-3 rounded-lg space-y-1" role="alert">
        <div className="flex items-center gap-2 font-bold text-tertiary">
          <Icone nome="cloud_off" className="text-[20px]" />
          O SEI parece estar temporariamente indisponível
        </div>
        <p className="text-body-md text-on-surface-variant">{erro.mensagem}</p>
        <p className="text-body-md text-on-surface-variant">
          Nenhum documento foi criado ainda. Pode tentar novamente em alguns instantes clicando em
          "Confirmar" de novo — ou, se preferir, feche esta janela e faça manualmente pelo site do SEI.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg space-y-1" role="alert">
      <div className="flex items-center gap-2 font-bold">
        <Icone nome="error" className="text-[20px]" />
        Não foi possível concluir a solicitação
      </div>
      <p className="text-body-md">{erro.mensagem}</p>
      <p className="text-body-md">
        Verifique os dados antes de tentar novamente, ou conclua manualmente pelo site do SEI.
      </p>
    </div>
  )
}
