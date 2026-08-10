import { apiDelete, apiGet, apiPost } from '../../api/client'
import type { Anotacao, DetalhesRelatorio, Documento, HistoricoAgente, ResultadoDespacho, ResumoApontamentos, TemplateDespacho, TipoDespacho } from './types'

/** Busca os detalhes de um item da caixa de entrada pelo ID. */
export function obterDetalhesRelatorio(id: number | string): Promise<DetalhesRelatorio> {
  return apiGet<DetalhesRelatorio>(`/caixa-entrada/${id}`)
}

/** Apontamentos (não conformidades) do checklist de fiscalização. */
export function obterApontamentos(itemId: number | string): Promise<ResumoApontamentos> {
  return apiGet<ResumoApontamentos>(`/caixa-entrada/${itemId}/apontamentos`)
}

/** Inventário de relatórios e processos do agente (por CPF/CNPJ). */
export function obterHistoricoAgente(itemId: number | string): Promise<HistoricoAgente> {
  return apiGet<HistoricoAgente>(`/caixa-entrada/${itemId}/historico-agente`)
}

/** Lista as anotações internas de um item da caixa de entrada. */
export function listarAnotacoes(itemId: number | string): Promise<Anotacao[]> {
  return apiGet<Anotacao[]>(`/caixa-entrada/${itemId}/anotacoes`)
}

/** Cria uma nova anotação interna. */
export function criarAnotacao(itemId: number | string, texto: string): Promise<Anotacao> {
  return apiPost<Anotacao>(`/caixa-entrada/${itemId}/anotacoes`, { texto })
}

/** Exclui uma anotação interna (somente o autor pode excluir). */
export function excluirAnotacao(itemId: number | string, anotacaoId: number): Promise<void> {
  return apiDelete(`/caixa-entrada/${itemId}/anotacoes/${anotacaoId}`)
}

/** Busca o HTML do relatório de fiscalização. */
export function obterRelatorioHtml(itemId: number | string): Promise<{ html: string }> {
  return apiGet<{ html: string }>(`/caixa-entrada/${itemId}/relatorio`)
}

/** Lista documentos do processo (histórico SEI). */
export function listarDocumentosCaixaEntrada(itemId: number | string): Promise<Documento[]> {
  return apiGet<Documento[]>(`/caixa-entrada/${itemId}/documentos`)
}

/** Conteúdo (base64) de um documento específico. */
export function obterConteudoDocumentoCaixaEntrada(
  itemId: number | string,
  numeroDoc: string,
  tipo?: string,
): Promise<{ numero: string; nome: string; tipo: string; conteudo: unknown }> {
  const params = tipo ? `?tipo=${encodeURIComponent(tipo)}` : ''
  return apiGet(`/documentos/${numeroDoc}/conteudo${params}`)
}

/** Busca o template HTML de um despacho (Arquivar/TAC/Instaurar) para edição. */
export function obterTemplateDespacho(itemId: number | string, tipo: TipoDespacho): Promise<TemplateDespacho> {
  return apiGet<TemplateDespacho>(`/caixa-entrada/${itemId}/despachos/${tipo}`)
}

/** Envia o HTML final (editado) e executa a ação real no SEI. */
export function executarDespacho(
  itemId: number | string,
  tipo: TipoDespacho,
  html: string,
  cautelar?: boolean,
): Promise<ResultadoDespacho> {
  const body: { html: string; cautelar?: boolean } = { html }
  if (tipo === 'instaurar') body.cautelar = Boolean(cautelar)
  return apiPost<ResultadoDespacho>(`/caixa-entrada/${itemId}/despachos/${tipo}`, body)
}


/** Andamento do histórico do processo SEI. */
export interface Andamento {
  id_andamento: string
  descricao: string
  data: string
  hora: string
  unidade_sigla: string
  unidade_descricao: string
  usuario_nome: string | null
  usuario_sigla: string | null
}

/** Lista histórico de andamentos do processo (modo resumido ou completo). */
export function listarHistoricoCaixaEntrada(
  itemId: number | string,
  modo: 'resumido' | 'completo' = 'resumido',
): Promise<Andamento[]> {
  return apiGet<Andamento[]>(`/caixa-entrada/${itemId}/historico?modo=${modo}`)
}
