import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Icone } from './Icone'

const CHAVE_ACESSO_CONFIRMADO = 'sei:acesso-confirmado'
const SEI_WEB_URL_PADRAO = 'https://sei.sp.gov.br/sei'

export const MINHA_AREA_URL =
  (import.meta.env.VITE_MINHA_AREA_URL as string | undefined)?.trim()
  || 'https://minhaarea.sp.gov.br/'

/**
 * Identifica links web do SEI sem depender de como cada tela os construiu.
 *
 * Alguns links vêm de `montarLinkSei`, outros são devolvidos pelo backend. O
 * guard aceita a URL configurada para o ambiente e também o endereço oficial
 * de produção, usado por respostas antigas da API.
 */
function ehLinkDoSei(href: string): boolean {
  let destino: URL
  try {
    destino = new URL(href, window.location.href)
  } catch {
    return false
  }

  const baseConfigurada = (import.meta.env.VITE_SEI_WEB_URL as string | undefined)?.trim()
  const bases = [baseConfigurada, SEI_WEB_URL_PADRAO].filter((base): base is string => Boolean(base))

  return bases.some((base) => {
    try {
      const urlBase = new URL(base)
      const caminhoBase = urlBase.pathname.replace(/\/$/, '')
      return destino.origin === urlBase.origin
        && (destino.pathname === caminhoBase || destino.pathname.startsWith(`${caminhoBase}/`))
    } catch {
      return false
    }
  })
}

function lerAcessoConfirmado(): boolean {
  try {
    return sessionStorage.getItem(CHAVE_ACESSO_CONFIRMADO) === '1'
  } catch {
    return false
  }
}

function persistirAcessoConfirmado() {
  try {
    sessionStorage.setItem(CHAVE_ACESSO_CONFIRMADO, '1')
  } catch {
    // O ref em memória mantém a confirmação enquanto esta montagem existir.
  }
}

function encontrarLink(alvo: EventTarget | null): HTMLAnchorElement | null {
  // Elementos de um iframe pertencem a outro realm e podem falhar em
  // `instanceof Element`; verificar o método funciona nos dois documentos.
  if (!alvo || typeof (alvo as Element).closest !== 'function') return null
  return (alvo as Element).closest('a[href]') as HTMLAnchorElement | null
}

/** Abre primeiro uma aba vazia para detectar bloqueio e remover `opener`. */
function abrirNovaAba(url: string): boolean {
  const novaAba = window.open('about:blank', '_blank')
  if (!novaAba) return false

  try {
    novaAba.opener = null
    novaAba.location.replace(url)
    return true
  } catch {
    novaAba.close()
    return false
  }
}

/**
 * Protege todos os links externos para o SEI com um único fluxo de acesso.
 *
 * O navegador não permite consultar o cookie HttpOnly do SEI em outro domínio.
 * Por isso, no primeiro link de cada aba o usuário confirma que já está logado
 * ou abre a Minha Área. Depois da confirmação, os demais links seguem direto.
 */
export function SeiLinkGuard({ children }: { children: ReactNode }) {
  const [destino, setDestino] = useState<string | null>(null)
  const [minhaAreaAberta, setMinhaAreaAberta] = useState(false)
  const [erroAbertura, setErroAbertura] = useState<string | null>(null)
  const acessoConfirmadoRef = useRef(lerAcessoConfirmado())
  const conteudoRef = useRef<HTMLDivElement>(null)
  const dialogoRef = useRef<HTMLElement>(null)
  const botaoFecharRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function acessoJaConfirmado(): boolean {
      if (acessoConfirmadoRef.current) return true
      const persistido = lerAcessoConfirmado()
      if (persistido) acessoConfirmadoRef.current = true
      return persistido
    }

    function interceptar(evento: MouseEvent, ativacao: 'principal' | 'auxiliar' | 'contexto') {
      if (evento.defaultPrevented || acessoJaConfirmado()) return
      if (ativacao === 'principal' && evento.button !== 0) return
      if (ativacao === 'auxiliar' && evento.button !== 1) return

      const link = encontrarLink(evento.target)
      if (!link || !ehLinkDoSei(link.href)) return

      evento.preventDefault()
      evento.stopPropagation()
      setDestino(link.href)
      setMinhaAreaAberta(false)
      setErroAbertura(null)
    }

    const aoClicar = (evento: MouseEvent) => interceptar(evento, 'principal')
    const aoClicarAuxiliar = (evento: MouseEvent) => interceptar(evento, 'auxiliar')
    const aoAbrirMenu = (evento: MouseEvent) => interceptar(evento, 'contexto')

    function adicionarListeners(documento: Document) {
      documento.addEventListener('click', aoClicar, true)
      documento.addEventListener('auxclick', aoClicarAuxiliar, true)
      documento.addEventListener('contextmenu', aoAbrirMenu, true)
    }

    function removerListeners(documento: Document) {
      documento.removeEventListener('click', aoClicar, true)
      documento.removeEventListener('auxclick', aoClicarAuxiliar, true)
      documento.removeEventListener('contextmenu', aoAbrirMenu, true)
    }

    // `srcDoc` cria outro Document: seus eventos não chegam ao document pai.
    // Observamos os iframes para cobrir também links presentes nos documentos
    // HTML exibidos pelas duas telas de análise. PDFs/cross-origin são ignorados.
    const iframesObservados = new Map<HTMLIFrameElement, () => void>()

    function observarIframe(iframe: HTMLIFrameElement) {
      if (iframesObservados.has(iframe)) return
      let documentoAtual: Document | null = null

      function conectarDocumento() {
        try {
          const proximoDocumento = iframe.contentDocument
          if (!proximoDocumento || proximoDocumento === documentoAtual) return
          if (documentoAtual) removerListeners(documentoAtual)
          documentoAtual = proximoDocumento
          adicionarListeners(documentoAtual)
        } catch {
          // Iframe cross-origin ou visualizador nativo: não há acesso ao DOM.
        }
      }

      function limpar() {
        iframe.removeEventListener('load', conectarDocumento)
        if (documentoAtual) removerListeners(documentoAtual)
      }

      iframe.addEventListener('load', conectarDocumento)
      conectarDocumento()
      iframesObservados.set(iframe, limpar)
    }

    function sincronizarIframes() {
      document.querySelectorAll<HTMLIFrameElement>('iframe').forEach(observarIframe)
      for (const [iframe, limpar] of iframesObservados) {
        if (!iframe.isConnected) {
          limpar()
          iframesObservados.delete(iframe)
        }
      }
    }

    adicionarListeners(document)
    sincronizarIframes()
    const observador = new MutationObserver(sincronizarIframes)
    observador.observe(document.documentElement, { childList: true, subtree: true })

    return () => {
      observador.disconnect()
      removerListeners(document)
      for (const limpar of iframesObservados.values()) limpar()
      iframesObservados.clear()
    }
  }, [])

  useEffect(() => {
    if (!destino) return

    const focoAnterior = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflowAnterior = document.body.style.overflow
    const conteudo = conteudoRef.current
    document.body.style.overflow = 'hidden'
    conteudo?.setAttribute('inert', '')
    conteudo?.setAttribute('aria-hidden', 'true')
    botaoFecharRef.current?.focus()

    function controlarTeclado(evento: KeyboardEvent) {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        setDestino(null)
        setMinhaAreaAberta(false)
        setErroAbertura(null)
        return
      }

      if (evento.key !== 'Tab' || !dialogoRef.current) return
      const focaveis = Array.from(dialogoRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((elemento) => !elemento.hasAttribute('hidden'))
      if (focaveis.length === 0) {
        evento.preventDefault()
        return
      }

      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      const focoNoDialogo = dialogoRef.current.contains(document.activeElement)
      if (evento.shiftKey && (!focoNoDialogo || document.activeElement === primeiro)) {
        evento.preventDefault()
        ultimo.focus()
      } else if (!evento.shiftKey && (!focoNoDialogo || document.activeElement === ultimo)) {
        evento.preventDefault()
        primeiro.focus()
      }
    }

    document.addEventListener('keydown', controlarTeclado)
    return () => {
      document.removeEventListener('keydown', controlarTeclado)
      document.body.style.overflow = overflowAnterior
      conteudo?.removeAttribute('inert')
      conteudo?.removeAttribute('aria-hidden')
      focoAnterior?.focus()
    }
  }, [destino])

  function fechar() {
    setDestino(null)
    setMinhaAreaAberta(false)
    setErroAbertura(null)
  }

  function abrirMinhaArea() {
    if (!abrirNovaAba(MINHA_AREA_URL)) {
      setErroAbertura('O navegador bloqueou a nova aba. Permita pop-ups para este site e tente novamente.')
      return
    }
    setErroAbertura(null)
    setMinhaAreaAberta(true)
  }

  function abrirProcesso() {
    if (!destino) return
    if (!abrirNovaAba(destino)) {
      setErroAbertura('O navegador bloqueou a nova aba. Permita pop-ups para este site e tente novamente.')
      return
    }

    acessoConfirmadoRef.current = true
    persistirAcessoConfirmado()
    fechar()
  }

  return (
    <>
      <div ref={conteudoRef} className="contents">
        {children}
      </div>

      {destino && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(evento) => { if (evento.target === evento.currentTarget) fechar() }}
        >
          <section
            ref={dialogoRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sei-acesso-titulo"
            aria-describedby="sei-acesso-descricao"
            className="w-full max-w-lg overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest shadow-card"
          >
            <div className="flex items-center justify-between border-b border-outline-variant px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-fixed/40 text-primary">
                  <Icone nome="account_circle" className="text-[24px]" />
                </span>
                <div>
                  <h2 id="sei-acesso-titulo" className="text-headline-sm text-on-surface">Acesso ao SEI</h2>
                  <p className="text-[11px] text-on-surface-variant">Confirmação necessária somente nesta aba</p>
                </div>
              </div>
              <button
                ref={botaoFecharRef}
                type="button"
                onClick={fechar}
                className="rounded-full p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high"
                aria-label="Fechar"
              >
                <Icone nome="close" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              {!minhaAreaAberta ? (
                <>
                  <p id="sei-acesso-descricao" className="text-body-md text-on-surface-variant">
                    O processo só abre diretamente quando sua sessão do SEI já foi iniciada pela Minha Área SP.
                  </p>
                  <div className="flex items-start gap-3 rounded-lg border border-secondary-container/30 bg-secondary-fixed/20 px-4 py-3">
                    <Icone nome="info" className="mt-0.5 shrink-0 text-[19px] text-secondary" />
                    <p className="text-[12px] text-on-surface-variant">
                      Por segurança, o navegador não permite que este aplicativo consulte automaticamente a sessão do SEI.
                    </p>
                  </div>
                </>
              ) : (
                <div id="sei-acesso-descricao" className="space-y-3 text-body-md text-on-surface-variant">
                  <p className="font-semibold text-on-surface">A Minha Área foi aberta em outra aba.</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>Conclua o login com sua conta gov.br.</li>
                    <li>Em <strong>Meus Sistemas</strong>, abra o SEI.</li>
                    <li>Quando o SEI carregar, volte aqui e abra o processo.</li>
                  </ol>
                </div>
              )}

              {erroAbertura && (
                <p role="alert" className="rounded-lg bg-error-container px-4 py-3 text-body-md text-on-error-container">
                  {erroAbertura}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-outline-variant bg-surface-container-low px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={fechar}
                className="rounded-lg px-4 py-2 text-label-lg text-on-surface-variant transition-colors hover:bg-surface-container-high"
              >
                Cancelar
              </button>
              {minhaAreaAberta && (
                <button
                  type="button"
                  onClick={abrirMinhaArea}
                  className="rounded-lg border border-outline-variant px-4 py-2 text-label-lg text-on-surface-variant transition-colors hover:bg-surface-container-high"
                >
                  Abrir Minha Área novamente
                </button>
              )}
              <button
                type="button"
                onClick={abrirProcesso}
                className="inline-flex items-center justify-center gap-1 rounded-lg border border-primary px-4 py-2 text-label-lg text-primary transition-colors hover:bg-primary/5"
              >
                {minhaAreaAberta ? 'Abrir processo no SEI' : 'Já estou logado — abrir processo'}
                <Icone nome="open_in_new" className="text-[16px]" />
              </button>
              {!minhaAreaAberta && (
                <button
                  type="button"
                  onClick={abrirMinhaArea}
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-4 py-2 text-label-lg text-white transition-colors hover:bg-primary-container"
                >
                  Entrar pela Minha Área
                  <Icone nome="login" className="text-[16px]" />
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  )
}
