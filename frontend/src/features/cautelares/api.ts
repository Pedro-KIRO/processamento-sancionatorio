import { apiGet, apiPost, apiPostForm } from '../../api/client'
import type {
  Cautelar,
  CautelarCreatePayload,
  CautelarRenovarPayload,
  CautelarResumo,
  FiltrosCautelares,
} from './types'

/** Cartões do painel: vigentes, vencendo (≤3 dias), vencidas, defesa e fila. */
export function obterResumoCautelares(): Promise<CautelarResumo> {
  return apiGet<CautelarResumo>('/cautelares/resumo')
}

export function listarCautelares(filtros: FiltrosCautelares = {}): Promise<Cautelar[]> {
  const p = new URLSearchParams()
  if (filtros.situacao) p.set('situacao', filtros.situacao)
  if (filtros.unidade) p.set('unidade', filtros.unidade)
  if (filtros.aprovacao) p.set('aprovacao', filtros.aprovacao)
  if (filtros.somente_com_defesa) p.set('somente_com_defesa', 'true')
  const qs = p.toString()
  return apiGet<Cautelar[]>(`/cautelares${qs ? `?${qs}` : ''}`)
}

export function obterCautelar(id: number): Promise<Cautelar> {
  return apiGet<Cautelar>(`/cautelares/${id}`)
}

export function criarCautelar(dados: CautelarCreatePayload): Promise<Cautelar> {
  return apiPost<Cautelar>('/cautelares', dados)
}

/** Renova, criando outra cautelar que referencia a anterior. */
export function renovarCautelar(id: number, dados: CautelarRenovarPayload): Promise<Cautelar> {
  return apiPost<Cautelar>(`/cautelares/${id}/renovar`, dados)
}

/** Coordenador Geral concorda com a medida: segue para assinatura. */
export function aprovarCautelar(id: number): Promise<Cautelar> {
  return apiPost<Cautelar>(`/cautelares/${id}/aprovar`, {})
}

/** Coordenador Geral recusa: o processo volta à caixa de entrada. */
export function recusarCautelar(id: number, motivo: string): Promise<Cautelar> {
  return apiPost<Cautelar>(`/cautelares/${id}/recusar`, { motivo })
}

/** Revoga a medida; depois cabe a certidão de desbloqueio. */
export function revogarCautelar(id: number, motivo: string): Promise<Cautelar> {
  return apiPost<Cautelar>(`/cautelares/${id}/revogar`, { motivo })
}

/** Baixa a marca de "pendente de assinatura" depois de assinar no SEI. */
export function marcarAssinaturaConcluida(id: number): Promise<Cautelar> {
  return apiPost<Cautelar>(`/cautelares/${id}/assinatura-concluida`, {})
}

/** Certidão de bloqueio, com evidência de tela do sistema legado. */
export async function juntarCertidao(
  id: number,
  arquivo: File,
): Promise<{ sucesso: boolean; mensagem: string; cautelar_id: number }> {
  const formData = new FormData()
  formData.append('arquivo', arquivo)
  return apiPostForm(`/cautelares/${id}/certidao`, formData)
}

/** Certidão de desbloqueio, exigida quando a medida é revogada. */
export async function juntarCertidaoDesbloqueio(
  id: number,
  arquivo: File,
): Promise<{ sucesso: boolean; mensagem: string; cautelar_id: number }> {
  const formData = new FormData()
  formData.append('arquivo', arquivo)
  return apiPostForm(`/cautelares/${id}/certidao-desbloqueio`, formData)
}
