/** Classificações do acervo. Os valores são os que o backend aceita. */
export type ClassificacaoBiblioteca = 'estoque_normativo' | 'parecer_cj' | 'nota_tecnica' | 'decisao_administrativa'

export const CLASSIFICACOES: ClassificacaoBiblioteca[] = [
  'estoque_normativo',
  'parecer_cj',
  'nota_tecnica',
  'decisao_administrativa',
]

export const LABELS_CLASSIFICACAO: Record<ClassificacaoBiblioteca, string> = {
  estoque_normativo: 'Estoque normativo',
  parecer_cj: 'Pareceres da Consultoria Jurídica',
  nota_tecnica: 'Notas técnicas',
  decisao_administrativa: 'Decisões Administrativas',
}

/** Rótulo curto, para caber nas abas e nas etiquetas da lista. */
export const LABELS_CURTOS: Record<ClassificacaoBiblioteca, string> = {
  estoque_normativo: 'Normativo',
  parecer_cj: 'Parecer CJ',
  nota_tecnica: 'Nota técnica',
  decisao_administrativa: 'Decisão Adm.',
}

export const ICONES_CLASSIFICACAO: Record<ClassificacaoBiblioteca, string> = {
  estoque_normativo: 'gavel',
  parecer_cj: 'balance',
  nota_tecnica: 'science',
  decisao_administrativa: 'assignment_turned_in',
}

export interface ItemBiblioteca {
  id: number
  classificacao: ClassificacaoBiblioteca
  classificacao_label: string
  titulo: string
  tema: string | null
  /** Data do documento (publicação/assinatura), não a do cadastro. */
  data_referencia: string | null
  link: string | null
  arquivo_nome: string | null
  arquivo_tamanho: number | null
  tem_texto: boolean
  tem_arquivo: boolean
  autor: string | null
  versao_atual: number
  criado_em: string | null
  atualizado_em: string | null
  /** Só vem no detalhe (GET /biblioteca/{id}); a listagem devolve null. */
  texto?: string | null
}

export interface VersaoBiblioteca {
  id: number
  numero: number
  autor: string | null
  criado_em: string | null
  titulo: string | null
  classificacao: string | null
  tema: string | null
  data_referencia: string | null
  link: string | null
  texto: string | null
}

/** Campos do formulário de cadastro/edição. */
export interface FormularioBiblioteca {
  classificacao: ClassificacaoBiblioteca
  titulo: string
  tema: string
  data_referencia: string
  link: string
  texto: string
}

export function formularioVazio(
  classificacao: ClassificacaoBiblioteca = 'estoque_normativo',
): FormularioBiblioteca {
  return { classificacao, titulo: '', tema: '', data_referencia: '', link: '', texto: '' }
}

/** Tamanho em KB/MB, para mostrar ao lado do nome do PDF. */
export function formatarTamanho(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
