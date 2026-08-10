import type { ColunaOrdenavel } from './api'

/** Identificador de cada coluna da tabela. */
export type ChaveColuna =
  | 'criacao'
  | 'tipo'
  | 'numero_sei'
  | 'razao_social'
  | 'cnpj_cpf'
  | 'agente'
  | 'situacao'
  | 'fase'
  | 'ultima_acao'

export interface DefinicaoColuna {
  chave: ChaveColuna
  titulo: string
  /** Coluna pela qual o backend sabe ordenar; ausente = não ordenável. */
  ordenarPor?: ColunaOrdenavel
  /** Tipo de filtro exibido na linha de filtros do cabeçalho. */
  filtro?: 'tipo' | 'periodo-criacao' | 'periodo-acao'
}

/**
 * Colunas da Consulta Unificada, na ordem de exibição.
 *
 * Os filtros de tipo e de período ficam no cabeçalho da própria coluna, no
 * lugar de disputarem espaço com os filtros gerais no topo da tela.
 */
export const COLUNAS: DefinicaoColuna[] = [
  { chave: 'criacao', titulo: 'Criação', ordenarPor: 'criacao', filtro: 'periodo-criacao' },
  { chave: 'tipo', titulo: 'Tipo', filtro: 'tipo' },
  { chave: 'numero_sei', titulo: 'Nº SEI', ordenarPor: 'numero_sei' },
  { chave: 'razao_social', titulo: 'Razão Social/Nome', ordenarPor: 'razao_social' },
  { chave: 'cnpj_cpf', titulo: 'CNPJ/CPF', ordenarPor: 'cnpj_cpf' },
  { chave: 'agente', titulo: 'Agente Regulado', ordenarPor: 'agente' },
  { chave: 'situacao', titulo: 'Situação', ordenarPor: 'situacao' },
  { chave: 'fase', titulo: 'Fase', ordenarPor: 'fase' },
  { chave: 'ultima_acao', titulo: 'Última Ação', ordenarPor: 'ultima_acao', filtro: 'periodo-acao' },
]

const CHAVE_ARMAZENAMENTO = 'consulta-unificada-colunas-ocultas'

/** Colunas que o usuário escondeu, lidas do armazenamento local. */
export function lerColunasOcultas(): ChaveColuna[] {
  if (typeof window === 'undefined') return []
  try {
    const salvo = window.localStorage.getItem(CHAVE_ARMAZENAMENTO)
    if (!salvo) return []
    const lista = JSON.parse(salvo)
    return Array.isArray(lista) ? lista.filter((c) => COLUNAS.some((d) => d.chave === c)) : []
  } catch {
    // Preferência corrompida não deve impedir a tela de abrir.
    return []
  }
}

export function gravarColunasOcultas(ocultas: ChaveColuna[]): void {
  try {
    window.localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(ocultas))
  } catch {
    // Armazenamento indisponível (modo privado, cota): segue sem persistir.
  }
}
