import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { apiGet } from '../../api/client'
import { Icone } from '../../components/Icone'

interface Alerta {
  chave: string
  rotulo: string
  total: number
  severidade: 'baixa' | 'media' | 'alta'
  descricao: string
  itens: number[]
}

/** Para onde cada alerta leva. Sem destino, o cartão fica só informativo. */
const DESTINO: Record<string, string> = {
  prazos_vencidos: '/prazos?situacao=vermelho',
  prazos_a_vencer: '/prazos?situacao=amarelo',
  sem_movimentacao: '/processos?filtro=controle_interno',
  cautelares_vencendo: '/cautelares',
  cautelares_vencidas: '/cautelares',
  recursos_pendentes: '/processos?filtro=decisoes',
  aguardando_assinatura: '/cautelares',
  encerramento_sem_conclusao: '/processos?filtro=arquivamento',
}

const ICONE: Record<string, string> = {
  prazos_vencidos: 'timer_off',
  prazos_a_vencer: 'timer',
  sem_movimentacao: 'hourglass_disabled',
  cautelares_vencendo: 'schedule',
  cautelares_vencidas: 'warning',
  recursos_pendentes: 'gavel',
  aguardando_assinatura: 'draw',
  encerramento_sem_conclusao: 'inventory_2',
}

/**
 * Alertas internos automáticos (regras transversais da Doc. de Negócio v3.0).
 *
 * São de acompanhamento gerencial: apontam pendência, não disparam ação. Só os
 * alertas com pendência aparecem — uma lista com oito zeros não ajuda ninguém e
 * ainda esconderia o que importa.
 */
export function AlertasInternos() {
  const [alertas, setAlertas] = useState<Alerta[]>([])

  useEffect(() => {
    apiGet<Alerta[]>('/alertas')
      .then((lista) => setAlertas(lista.filter((a) => a.total > 0)))
      .catch(() => setAlertas([]))
  }, [])

  if (alertas.length === 0) return null

  return (
    <section className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-card p-5">
      <h3 className="text-label-lg text-on-surface uppercase tracking-wider flex items-center gap-2 mb-3">
        <Icone nome="notification_important" className="text-[18px] text-error" />
        Alertas internos
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {alertas.map((a) => {
          const alta = a.severidade === 'alta'
          const destino = DESTINO[a.chave]
          const conteudo = (
            <>
              <div className="flex items-center gap-2">
                <Icone
                  nome={ICONE[a.chave] ?? 'warning'}
                  className={`text-[18px] ${alta ? 'text-error' : 'text-secondary'}`}
                />
                <span className={`text-headline-sm font-bold ${alta ? 'text-error' : 'text-secondary'}`}>
                  {a.total}
                </span>
              </div>
              <p className="text-label-md text-on-surface mt-1">{a.rotulo}</p>
              <p className="text-[11px] text-outline mt-0.5">{a.descricao}</p>
            </>
          )
          const classe = `block rounded-lg p-3 border text-left transition-colors ${
            alta
              ? 'border-error/30 bg-error-container/10 hover:bg-error-container/20'
              : 'border-outline-variant bg-surface-container-low hover:bg-surface-container'
          }`
          return destino ? (
            <Link key={a.chave} to={destino} className={classe}>
              {conteudo}
            </Link>
          ) : (
            <div key={a.chave} className={classe}>
              {conteudo}
            </div>
          )
        })}
      </div>
      <p className="text-[11px] text-outline mt-3">
        Alertas internos de acompanhamento gerencial, recalculados a cada acesso.
      </p>
    </section>
  )
}
