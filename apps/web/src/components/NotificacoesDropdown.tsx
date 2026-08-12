import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiGet, apiPost } from '../api/client'
import { Icone } from './Icone'

interface Notificacao {
  id: number
  caixa_entrada_id: number | null
  tipo: string
  titulo: string
  descricao: string | null
  lida: boolean
  criado_em: string
}

interface ResumoNotificacoes {
  total_nao_lidas: number
  notificacoes: Notificacao[]
}

const ICONE_POR_TIPO: Record<string, string> = {
  defesa_juntada: 'description',
  defesa_intempestiva: 'running_with_errors',
  prazo_definido: 'hourglass_top',
  prazo_vencido: 'timer_off',
  prazo_proximo_vencer: 'timer',
  fase_avancada: 'arrow_forward',
  acesso_externo_visualizado: 'visibility',
  acesso_nao_visualizado: 'campaign',
}

function tempoRelativo(iso: string): string {
  const agora = Date.now()
  const data = new Date(iso).getTime()
  const diff = agora - data
  const minutos = Math.floor(diff / 60000)
  if (minutos < 1) return 'agora'
  if (minutos < 60) return `${minutos}min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `${horas}h`
  const dias = Math.floor(horas / 24)
  if (dias < 7) return `${dias}d`
  return new Date(iso).toLocaleDateString('pt-BR')
}

export function NotificacoesDropdown() {
  const [aberto, setAberto] = useState(false)
  const [dados, setDados] = useState<ResumoNotificacoes | null>(null)
  const [carregando, setCarregando] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Polling a cada 60s + load inicial
  useEffect(() => {
    carregarNotificacoes()
    const interval = setInterval(carregarNotificacoes, 60000)
    return () => clearInterval(interval)
  }, [])

  // Fechar ao clicar fora ou pressionar Escape
  useEffect(() => {
    function handleClickFora(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAberto(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false)
    }
    if (aberto) {
      document.addEventListener('mousedown', handleClickFora)
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickFora)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [aberto])

  async function carregarNotificacoes() {
    try {
      const resultado = await apiGet<ResumoNotificacoes>('/notificacoes?limit=10')
      setDados(resultado)
    } catch {
      // Silencioso
    }
  }

  async function marcarComoLida(id: number) {
    try {
      await apiPost(`/notificacoes/${id}/lida`, {})
      setDados((prev) =>
        prev
          ? {
              ...prev,
              total_nao_lidas: Math.max(0, prev.total_nao_lidas - 1),
              notificacoes: prev.notificacoes.map((n) =>
                n.id === id ? { ...n, lida: true } : n,
              ),
            }
          : prev,
      )
    } catch {
      // Silencioso
    }
  }

  async function marcarTodasLidas() {
    setCarregando(true)
    try {
      await apiPost('/notificacoes/marcar-todas-lidas', {})
      setDados((prev) =>
        prev
          ? {
              ...prev,
              total_nao_lidas: 0,
              notificacoes: prev.notificacoes.map((n) => ({ ...n, lida: true })),
            }
          : prev,
      )
    } catch {
      // Silencioso
    } finally {
      setCarregando(false)
    }
  }

  function handleClickNotificacao(notif: Notificacao) {
    if (!notif.lida) marcarComoLida(notif.id)
    if (notif.caixa_entrada_id) {
      navigate(`/processos/${notif.caixa_entrada_id}`)
      setAberto(false)
    }
  }

  const totalNaoLidas = dados?.total_nao_lidas ?? 0

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setAberto((a) => !a)
          if (!aberto) carregarNotificacoes()
        }}
        className="relative w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-primary hover:bg-surface-container transition-colors"
        aria-label={`Notificações${totalNaoLidas > 0 ? ` (${totalNaoLidas} não lidas)` : ''}`}
      >
        <Icone nome="notifications" />
        {totalNaoLidas > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
            {totalNaoLidas > 9 ? '9+' : totalNaoLidas}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 top-12 w-80 bg-surface-container-lowest rounded-xl shadow-lg border border-outline-variant overflow-hidden z-50">
          {/* Header do dropdown */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant">
            <h4 className="text-label-lg text-on-surface font-semibold">Notificações</h4>
            {totalNaoLidas > 0 && (
              <button
                onClick={marcarTodasLidas}
                disabled={carregando}
                className="text-[11px] text-primary hover:underline disabled:opacity-50"
              >
                Marcar todas como lidas
              </button>
            )}
          </div>

          {/* Lista */}
          <div className="max-h-80 overflow-y-auto">
            {!dados || dados.notificacoes.length === 0 ? (
              <div className="px-4 py-8 text-center text-on-surface-variant text-body-md">
                <Icone nome="notifications_none" className="text-[32px] mb-2 block mx-auto opacity-50" />
                Nenhuma notificação
              </div>
            ) : (
              dados.notificacoes.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleClickNotificacao(notif)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-surface-container-high transition-colors border-b border-outline-variant/50 last:border-b-0 ${
                    !notif.lida ? 'bg-primary-fixed/5' : ''
                  }`}
                >
                  <div className={`mt-0.5 w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    !notif.lida ? 'bg-primary-container text-primary' : 'bg-surface-container-high text-outline'
                  }`}>
                    <Icone nome={ICONE_POR_TIPO[notif.tipo] ?? 'info'} className="text-[16px]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-body-md leading-tight ${!notif.lida ? 'font-semibold text-on-surface' : 'text-on-surface-variant'}`}>
                      {notif.titulo}
                    </p>
                    {notif.descricao && (
                      <p className="text-[11px] text-on-surface-variant mt-0.5 line-clamp-2">
                        {notif.descricao}
                      </p>
                    )}
                    <p className="text-[10px] text-outline mt-1">{tempoRelativo(notif.criado_em)}</p>
                  </div>
                  {!notif.lida && (
                    <span className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
