import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Icone } from './Icone'

/**
 * Editor de documento no estilo do editor do SEI: barra de formatação e os
 * estilos de bloco oficiais, aplicados como classe CSS no `<p>`.
 *
 * As classes são o que dá ao documento a formatação oficial quando ele é criado
 * no SEI, por isso o editor oferece a lista em vez de formatação livre.
 *
 * O conteúdo é `contentEditable`, e não estado controlado do React: reescrever
 * o HTML a cada tecla faria o cursor pular. Quem usa o componente lê o HTML
 * pela ref (`obterHtml`) no momento de salvar.
 */
export interface EditorDocumentoRef {
  obterHtml: () => string
  definirHtml: (html: string) => void
}

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

interface EstiloBloco {
  label: string
  classe: string
}

const ESTILOS_BLOCO: EstiloBloco[] = [
  { label: 'Texto_Justificado_Recuo_Primeira_Linha', classe: 'Texto_Justificado_Recuo_Primeira_Linha' },
  { label: 'Texto_Justificado', classe: 'Texto_Justificado' },
  { label: 'Texto_Centralizado', classe: 'Texto_Centralizado' },
  { label: 'Texto_Centralizado_Maiusculas', classe: 'Texto_Centralizado_Maiusculas' },
  { label: 'Texto_Alinhado_Direita', classe: 'Texto_Alinhado_Direita' },
  { label: 'Texto_Alinhado_Esquerda', classe: 'Texto_Alinhado_Esquerda' },
  { label: 'Tabela_Texto_Centralizado', classe: 'Tabela_Texto_Centralizado' },
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

interface EditorDocumentoProps {
  /** Desabilita a edição (durante o salvamento, por exemplo). */
  somenteLeitura?: boolean
  rotulo?: string
  /** Altura da área de edição. Padrão: 60vh. */
  altura?: string
  /** Chamado na primeira alteração feita pelo usuário. */
  onAlterar?: () => void
}

export const EditorDocumento = forwardRef<EditorDocumentoRef, EditorDocumentoProps>(
  function EditorDocumento(
    { somenteLeitura = false, rotulo = 'Editor do documento', altura = '60vh', onAlterar },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null)
    const [estiloAtual, setEstiloAtual] = useState('')

    useImperativeHandle(ref, () => ({
      obterHtml: () => editorRef.current?.innerHTML ?? '',
      definirHtml: (html: string) => {
        if (editorRef.current) editorRef.current.innerHTML = html
      },
    }))

    function aplicarFormatacao(comando: string, valor?: string) {
      editorRef.current?.focus()
      document.execCommand(comando, false, valor)
      onAlterar?.()
    }

    function detectarEstiloAtual() {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) {
        setEstiloAtual('')
        return
      }
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
      let node: Node | null = sel.getRangeAt(0).startContainer
      while (node && node !== editorRef.current) {
        if (node.nodeType === 1 && (node as HTMLElement).tagName === 'P') {
          ;(node as HTMLElement).className = classe
          break
        }
        node = node.parentNode
      }
      setEstiloAtual(classe)
      editorRef.current?.focus()
      onAlterar?.()
    }

    return (
      <div className="rounded-lg border border-outline-variant overflow-hidden bg-white">
        <div className="flex flex-wrap items-center gap-1 bg-surface-container-low border-b border-outline-variant px-2 py-1.5">
          <DropdownEstilos
            label="Estilos"
            estilos={ESTILOS_BLOCO}
            onSelecionar={aplicarEstiloBloco}
            desabilitado={somenteLeitura}
            valorAtual={estiloAtual}
          />
          <DropdownEstilos
            label="Numeração"
            estilos={ESTILOS_NUMERACAO}
            onSelecionar={aplicarEstiloBloco}
            desabilitado={somenteLeitura}
            valorAtual={estiloAtual}
          />
          <Separador />
          <GrupoBotoes botoes={BOTOES_FORMATACAO} onClick={aplicarFormatacao} desabilitado={somenteLeitura} />
          <Separador />
          <GrupoBotoes botoes={BOTOES_ALINHAMENTO} onClick={aplicarFormatacao} desabilitado={somenteLeitura} />
          <Separador />
          <GrupoBotoes botoes={BOTOES_LISTA} onClick={aplicarFormatacao} desabilitado={somenteLeitura} />
          <Separador />
          <GrupoBotoes botoes={BOTOES_HISTORICO} onClick={aplicarFormatacao} desabilitado={somenteLeitura} />
        </div>
        <div
          ref={editorRef}
          contentEditable={!somenteLeitura}
          suppressContentEditableWarning
          className="doc-isolado overflow-y-auto"
          style={{ height: altura }}
          role="textbox"
          aria-multiline="true"
          aria-label={rotulo}
          onKeyUp={detectarEstiloAtual}
          onClick={detectarEstiloAtual}
          onInput={onAlterar}
        />
      </div>
    )
  },
)

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
          // Evita perder a seleção de texto do editor ao clicar no botão.
          onMouseDown={(e) => e.preventDefault()}
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
  const estiloAtivo = estilos.find((e) => e.classe === valorAtual)

  return (
    <select
      className="text-[11px] bg-white border border-outline-variant rounded px-1.5 py-1 text-on-surface-variant cursor-pointer hover:border-primary focus:outline-none focus:border-primary disabled:opacity-40 max-w-[180px]"
      disabled={desabilitado}
      value={estiloAtivo ? estiloAtivo.classe : ''}
      onChange={(e) => {
        if (e.target.value) onSelecionar(e.target.value)
      }}
      title={label}
      aria-label={label}
    >
      <option value="">{label}</option>
      {estilos.map((est) => (
        <option key={est.classe} value={est.classe}>
          {est.label}
        </option>
      ))}
    </select>
  )
}
