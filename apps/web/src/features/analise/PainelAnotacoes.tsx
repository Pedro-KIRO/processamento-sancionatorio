import { useEffect, useRef, useState } from 'react'

import { Icone } from '../../components/Icone'
import { getMe } from '../me/api'
import { criarAnotacao, excluirAnotacao, listarAnotacoes } from './api'
import type { Anotacao } from './types'

/** Formata datetime ISO para exibição amigável (dd/mm/aaaa HH:mm). */
function formatarDataHora(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Anotações internas do processo, em painel recolhível acionado por um botão
 * flutuante.
 *
 * Antes as anotações ocupavam uma coluna fixa de 30% da largura nas telas de
 * análise, o que apertava a área de leitura do documento. Agora ficam fora do
 * fluxo: o botão mostra a contagem e abre o painel sobre a tela quando
 * necessário, deixando o documento com a largura inteira.
 *
 * O componente é autossuficiente (busca, cria e exclui as próprias anotações),
 * então as duas telas de análise apenas o instanciam com o `itemId`.
 */
export function PainelAnotacoes({ itemId }: { itemId: string | number | undefined }) {
  const [aberto, setAberto] = useState(false)
  const [anotacoes, setAnotacoes] = useState<Anotacao[]>([])
  const [novaAnotacao, setNovaAnotacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [nomeUsuario, setNomeUsuario] = useState<string | null>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const id = itemId != null ? String(itemId) : ''

  useEffect(() => {
    if (!id) return
    listarAnotacoes(id).then(setAnotacoes).catch(() => setAnotacoes([]))
    getMe().then((u) => setNomeUsuario(u.nome ?? u.email ?? null)).catch(() => {})
  }, [id])

  // Mantém a conversa rolada para a anotação mais recente.
  useEffect(() => {
    if (aberto && listaRef.current) {
      listaRef.current.scrollTop = listaRef.current.scrollHeight
    }
  }, [anotacoes, aberto])

  // Foca o campo de texto ao abrir, e fecha com Esc.
  useEffect(() => {
    if (!aberto) return
    textareaRef.current?.focus()
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto])

  async function enviar() {
    if (!id || !novaAnotacao.trim() || enviando) return
    setEnviando(true)
    try {
      const nova = await criarAnotacao(id, novaAnotacao.trim())
      setAnotacoes((prev) => [...prev, nova])
      setNovaAnotacao('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
    } catch {
      // Falha ao enviar: mantém o texto digitado para o usuário tentar de novo.
    } finally {
      setEnviando(false)
    }
  }

  async function remover(anotacaoId: number) {
    if (!id) return
    try {
      await excluirAnotacao(id, anotacaoId)
      setAnotacoes((prev) => prev.filter((a) => a.id !== anotacaoId))
    } catch {
      // Falha ao excluir: a anotação permanece na lista.
    }
  }

  if (!id) return null

  return (
    <>
      {/* Botão flutuante: sempre acessível, sem consumir largura do conteúdo */}
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-white shadow-lg hover:bg-primary-container transition-all hover:scale-105 flex items-center justify-center"
        title="Anotações internas"
        aria-label={`Anotações internas (${anotacoes.length})`}
        aria-expanded={aberto}
      >
        <Icone nome="sticky_note_2" className="text-[24px]" />
        {anotacoes.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-error text-white text-[11px] font-bold flex items-center justify-center border-2 border-white">
            {anotacoes.length}
          </span>
        )}
      </button>

      {/* Fundo escurecido — clicar fora fecha o painel */}
      {aberto && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setAberto(false)}
          aria-hidden="true"
        />
      )}

      {/* Painel lateral */}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[400px] bg-surface-container-lowest border-l border-outline-variant shadow-2xl flex flex-col transition-transform duration-200 ${
          aberto ? 'translate-x-0' : 'translate-x-full pointer-events-none'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Anotações internas"
        aria-hidden={!aberto}
      >
        <div className="bg-surface-container-low p-stack-md border-b border-outline-variant flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <Icone nome="sticky_note_2" className="text-[20px] text-primary" />
            <h4 className="text-label-lg text-on-surface uppercase">Anotações Internas</h4>
            <span className="text-[10px] bg-primary text-white px-2 py-0.5 rounded-full">
              {anotacoes.length}
            </span>
          </div>
          <button
            onClick={() => setAberto(false)}
            className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors"
            title="Fechar"
            aria-label="Fechar anotações"
          >
            <Icone nome="close" className="text-[20px] text-on-surface-variant" />
          </button>
        </div>

        <div ref={listaRef} className="flex-1 overflow-y-auto p-stack-md space-y-4">
          {anotacoes.length === 0 && (
            <p className="text-body-md text-on-surface-variant text-center py-8">Nenhuma anotação ainda.</p>
          )}
          {anotacoes.map((a) => (
            <div key={a.id} className="flex flex-col items-start max-w-[90%] group">
              <div className="p-3 rounded-lg bg-surface-container-high rounded-tl-none relative">
                <p className="text-[11px] font-bold text-primary mb-1">{a.autor ?? 'Anônimo'}</p>
                <p className="text-body-md whitespace-pre-wrap break-words">{a.texto}</p>
                {nomeUsuario && a.autor === nomeUsuario && (
                  <button
                    onClick={() => remover(a.id)}
                    className="absolute top-1 right-1 p-1 rounded-full opacity-0 group-hover:opacity-100 hover:bg-error-container transition-all"
                    title="Excluir anotação"
                    aria-label="Excluir anotação"
                  >
                    <Icone nome="close" className="text-[14px] text-error" />
                  </button>
                )}
              </div>
              <span className="text-[10px] text-on-surface-variant mt-1 mx-1">
                {formatarDataHora(a.criado_em)}
              </span>
            </div>
          ))}
        </div>

        <div className="p-stack-md border-t border-outline-variant shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              className="flex-1 bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 text-body-md focus:outline-none focus:border-primary resize-none min-h-[36px] max-h-[120px]"
              placeholder="Escrever anotação..."
              value={novaAnotacao}
              onChange={(e) => {
                setNovaAnotacao(e.target.value)
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  enviar()
                }
              }}
              rows={1}
              aria-label="Nova anotação (Shift+Enter para quebra de linha)"
            />
            <button
              className="w-9 h-9 flex items-center justify-center bg-primary text-white rounded-full hover:bg-primary-container transition-colors shadow-sm disabled:opacity-50 shrink-0"
              disabled={!novaAnotacao.trim() || enviando}
              onClick={enviar}
              aria-label="Enviar anotação"
            >
              <Icone nome={enviando ? 'progress_activity' : 'send'} className="text-[18px]" />
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
