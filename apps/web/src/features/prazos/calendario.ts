import type { PrazoLinha } from './types'

/**
 * Converte 'YYYY-MM-DD' em Date local.
 *
 * `new Date('2026-08-05')` é interpretado como UTC pelo navegador e, em fuso
 * negativo como o de São Paulo, volta 04/08 — o prazo apareceria no dia
 * anterior no calendário. Montando por componentes o dia fica correto.
 */
export function paraData(iso: string | null): Date | null {
  if (!iso) return null
  const [ano, mes, dia] = iso.split('-').map(Number)
  if (!ano || !mes || !dia) return null
  return new Date(ano, mes - 1, dia)
}

export function mesmoDia(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function inicioDoDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Domingo da semana em que a data cai. */
export function inicioDaSemana(d: Date): Date {
  const base = inicioDoDia(d)
  base.setDate(base.getDate() - base.getDay())
  return base
}

export function somarDias(d: Date, dias: number): Date {
  const saida = new Date(d)
  saida.setDate(saida.getDate() + dias)
  return saida
}

/**
 * As 6 semanas que cobrem o mês, começando no domingo.
 *
 * Seis linhas fixas em vez de o número exato: com altura variável a grade
 * "pula" ao trocar de mês, o que atrapalha quem navega mês a mês.
 */
export function semanasDoMes(referencia: Date): Date[][] {
  const primeiro = new Date(referencia.getFullYear(), referencia.getMonth(), 1)
  const inicio = inicioDaSemana(primeiro)
  const semanas: Date[][] = []
  for (let s = 0; s < 6; s++) {
    const semana: Date[] = []
    for (let d = 0; d < 7; d++) {
      semana.push(somarDias(inicio, s * 7 + d))
    }
    semanas.push(semana)
  }
  return semanas
}

/** Agrupa os prazos por data de vencimento, na chave 'YYYY-MM-DD'. */
export function agruparPorDia(prazos: PrazoLinha[]): Map<string, PrazoLinha[]> {
  const mapa = new Map<string, PrazoLinha[]>()
  for (const p of prazos) {
    if (!p.data_vencimento) continue
    const lista = mapa.get(p.data_vencimento) ?? []
    lista.push(p)
    mapa.set(p.data_vencimento, lista)
  }
  return mapa
}

export function chaveDia(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

export const DIAS_SEMANA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

export function nomeDoMes(d: Date): string {
  return `${MESES[d.getMonth()]} de ${d.getFullYear()}`
}

/** "2 – 8 de agosto de 2026", com o mês repetido quando a semana virar o mês. */
export function intervaloDaSemana(inicio: Date): string {
  const fim = somarDias(inicio, 6)
  if (inicio.getMonth() === fim.getMonth()) {
    return `${inicio.getDate()} – ${fim.getDate()} de ${nomeDoMes(inicio)}`
  }
  return `${inicio.getDate()} de ${MESES[inicio.getMonth()]} – ${fim.getDate()} de ${nomeDoMes(fim)}`
}
