import { BASE_API, apiGet, apiPost, apiPut } from '../../api/client'
import type { Marcador } from '../../lib/malaDireta'
import type { Documento } from '../analise/types'
import type { ConteudoDocumento, FiltrosProcessos, ItemProcessoAndamento } from './types'

export function listarProcessosAndamento(filtros: FiltrosProcessos = {}): Promise<ItemProcessoAndamento[]> {
  const p = new URLSearchParams()
  if (filtros.busca) p.set('busca', filtros.busca)
  if (filtros.agente) p.set('agente', filtros.agente)
  if (filtros.dataInicio) p.set('data_inicio', filtros.dataInicio)
  if (filtros.dataFim) p.set('data_fim', filtros.dataFim)
  if (filtros.filtro) p.set('filtro', filtros.filtro)
  const qs = p.toString()
  return apiGet<ItemProcessoAndamento[]>(`/processos-andamento${qs ? `?${qs}` : ''}`)
}

/** Busca os detalhes de um processo em andamento pelo ID. */
export function obterDetalhesProcesso(id: number | string): Promise<ItemProcessoAndamento> {
  return apiGet<ItemProcessoAndamento>(`/processos-andamento/${id}`)
}

/** Histórico de documentos do processo (mais recente primeiro). */
export function listarDocumentosProcesso(id: number | string): Promise<Documento[]> {
  return apiGet<Documento[]>(`/processos-andamento/${id}/documentos`)
}

/** Conteúdo (base64) de um documento específico do processo. */
export function obterConteudoDocumentoProcesso(
  id: number | string,
  numeroDoc: string,
  tipo?: string,
): Promise<ConteudoDocumento> {
  const params = tipo ? `?tipo=${encodeURIComponent(tipo)}` : ''
  return apiGet<ConteudoDocumento>(`/processos-andamento/${id}/documentos/${numeroDoc}/conteudo${params}`)
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
export function listarHistoricoProcesso(
  itemId: number | string,
  modo: 'resumido' | 'completo' = 'resumido',
): Promise<Andamento[]> {
  return apiGet<Andamento[]>(`/processos-andamento/${itemId}/historico?modo=${modo}`)
}


// ==============================================================================
// Fases do processo
// ==============================================================================

export interface FaseProcesso {
  id: number
  fase: string
  data_entrada: string
  data_saida: string | null
  autor: string | null
  observacao: string | null
}

/**
 * Documento que a fase espera agora.
 *
 * Uma fase pode produzir mais de um documento em sequência — julgamento exige
 * encaminhamento à Consultoria Jurídica, relatório opinativo e decisão, cada um
 * com assinantes diferentes. A fase só avança depois do último.
 */
/** Opção de modelo de um passo (as três decisões, os três opinativos...). */
export interface ModeloPasso {
  chave: string
  nome: string
}

export interface PassoFase {
  titulo: string
  descricao: string
  chave_documento: string
  numero: number
  total: number
  ultimo: boolean
  cargos_assinatura: string[]
  dias_prazo: number | null
  /** "documento" (o app gera do modelo) ou "anexo" (PDF enviado pelo usuário). */
  tipo: 'documento' | 'anexo'
  modelos: ModeloPasso[]
}

export interface FaseAtualResponse {
  fase_atual: string | null
  proxima_fase: string | null
  data_entrada?: string
  todas: string[]
  passo_atual?: PassoFase | null
  total_passos?: number
  passos_concluidos?: number
  /** Texto exibido nas fases em que o app espera o interessado. */
  aguardando?: string | null
}

export interface PrazoProcesso {
  id: number
  fase: string
  dias: number
  /** Início da contagem — na defesa prévia, a disponibilização do acesso externo. */
  data_inicio: string
  data_vencimento: string
  /** True quando a visualização do acesso externo reiniciou a contagem. */
  reiniciado: boolean
  /** Data da visualização que reiniciou o prazo. */
  data_reinicio: string | null
  status: string
  data_resposta: string | null
  registrado_sei: boolean
}

export interface EventoProcesso {
  id: number
  tipo: string
  descricao: string | null
  autor: string | null
  criado_em: string
}

export function obterFaseAtual(itemId: number | string): Promise<FaseAtualResponse> {
  return apiGet<FaseAtualResponse>(`/processos-andamento/${itemId}/fase-atual`)
}

/** Modelo do próximo documento da fase, já com as variáveis preenchidas. */
export interface TemplateFaseResponse {
  titulo: string
  html: string
  fase: string
  chave_documento: string
  descricao: string
  passo: number
  total_passos: number
  ultimo_passo: boolean
  cargos_assinatura: string[]
  dias_prazo: number | null
  tipo: 'documento' | 'anexo'
  modelos: ModeloPasso[]
  /** Lacunas do modelo, para o formulário de mala direta que antecede o editor. */
  marcadores?: Marcador[]
}

export function obterTemplateFase(
  itemId: number | string, modelo?: string,
): Promise<TemplateFaseResponse> {
  const query = modelo ? `?modelo=${encodeURIComponent(modelo)}` : ''
  return apiGet<TemplateFaseResponse>(
    `/processos-andamento/${itemId}/fase-acao/template${query}`,
  )
}

export interface ResultadoFase {
  sucesso: boolean
  numero_sei: string | null
  documento_formatado: string | null
  fase_avancada_para: string | null
  mensagem: string
}

/**
 * Anexa um PDF no passo que espera documento externo.
 *
 * Hoje o único caso é a manifestação da Consultoria Jurídica, que chega pronta
 * e não é redigida no app.
 */
export async function anexarDocumentoFase(
  itemId: number | string, arquivo: File,
): Promise<ResultadoFase> {
  const corpo = new FormData()
  corpo.append('arquivo', arquivo)

  const resp = await fetch(`${BASE_API}/processos-andamento/${itemId}/fase-acao/anexar`, {
    method: 'POST',
    body: corpo,
  })
  if (!resp.ok) {
    // O backend devolve {detail: "..."}; o texto cru serve de reserva.
    const texto = await resp.text()
    try {
      throw new Error(JSON.parse(texto).detail ?? texto)
    } catch (e) {
      throw e instanceof Error && e.message ? e : new Error(texto)
    }
  }
  return resp.json()
}

export function listarFases(itemId: number | string): Promise<FaseProcesso[]> {
  return apiGet<FaseProcesso[]>(`/processos-andamento/${itemId}/fases`)
}

export function avancarFase(itemId: number | string, observacao?: string): Promise<FaseProcesso> {
  return apiPost<FaseProcesso>(`/processos-andamento/${itemId}/avancar-fase`, { observacao })
}

export function definirPrazo(itemId: number | string, dias?: number, dataVencimento?: string): Promise<PrazoProcesso> {
  return apiPost<PrazoProcesso>(`/processos-andamento/${itemId}/definir-prazo`, { dias, data_vencimento: dataVencimento })
}

export function listarPrazos(itemId: number | string): Promise<PrazoProcesso[]> {
  return apiGet<PrazoProcesso[]>(`/processos-andamento/${itemId}/prazos`)
}

export function listarEventos(itemId: number | string): Promise<EventoProcesso[]> {
  return apiGet<EventoProcesso[]>(`/processos-andamento/${itemId}/eventos`)
}


/** Inclui o conjunto probatório (PDF unificado dos docs da fiscalização) no processo instaurado. */
export function incluirConjuntoProbatorio(itemId: number | string): Promise<{ sucesso: boolean; mensagem: string }> {
  return apiPost(`/processos-andamento/${itemId}/incluir-conjunto-probatorio`, {})
}

/** Inicia o prazo de 15 dias para defesa prévia (após disponibilização de acesso externo). */
export function iniciarPrazoDefesa(itemId: number | string): Promise<{ sucesso: boolean; mensagem: string }> {
  return apiPost(`/processos-andamento/${itemId}/iniciar-prazo-defesa`, {})
}

/** Gera edital (citação ou intimação) no processo SEI. Analista publica manualmente depois. */
export function gerarEdital(
  itemId: number | string,
  tipo: 'citacao' | 'intimacao_alegacoes' = 'citacao',
): Promise<{ sucesso: boolean; documento_formatado: string; link_sei: string | null; mensagem: string }> {
  return apiPost(`/processos-andamento/${itemId}/gerar-edital`, { tipo })
}


/** Faz upload de medida cautelar (imagem/PDF) para o processo no SEI. */
export async function uploadMedidaCautelar(
  itemId: number | string,
  arquivo: File,
  descricao?: string,
): Promise<{ sucesso: boolean; documento_formatado: string; link_sei: string | null; mensagem: string }> {
  const formData = new FormData()
  formData.append('arquivo', arquivo)

  const params = new URLSearchParams()
  if (descricao) params.set('descricao', descricao)

  const url = `${BASE_API}/processos-andamento/${itemId}/medida-cautelar${params.toString() ? '?' + params.toString() : ''}`
  const resp = await fetch(url, {
    method: 'POST',
    body: formData,
  })
  if (!resp.ok) {
    const corpo = await resp.json().catch(() => ({}))
    const msg = corpo?.detail ?? `Erro ${resp.status}`
    throw new Error(typeof msg === 'string' ? msg : msg.message ?? JSON.stringify(msg))
  }
  return resp.json()
}


// ============================================================================
// Atribuição de responsável
// ============================================================================

export interface Atribuicao {
  responsavel_id: number | null
  responsavel_nome: string | null
  responsavel_email: string | null
  pode_editar: boolean
}

export function obterAtribuicao(itemId: number | string): Promise<Atribuicao> {
  return apiGet<Atribuicao>(`/processos-andamento/${itemId}/atribuicao`)
}

export function alterarAtribuicao(itemId: number | string, responsavelId: number | null): Promise<Atribuicao> {
  return apiPut<Atribuicao>(`/processos-andamento/${itemId}/atribuicao`, { responsavel_id: responsavelId })
}


// ============================================================================
// Priorização (★) pela Coordenação
// ============================================================================

export interface Prioridade {
  prioritario: boolean
  justificativa: string | null
  definida_por: string | null
  definida_em: string | null
  pode_editar: boolean
}

export function obterPrioridade(itemId: number | string): Promise<Prioridade> {
  return apiGet<Prioridade>(`/processos-andamento/${itemId}/prioridade`)
}

export function alterarPrioridade(
  itemId: number | string,
  prioritario: boolean,
  justificativa?: string,
): Promise<Prioridade> {
  return apiPut<Prioridade>(`/processos-andamento/${itemId}/prioridade`, {
    prioritario,
    justificativa: justificativa ?? null,
  })
}


// ============================================================================
// Recurso e Decisão II
// ============================================================================

export type ResultadoDecisaoII = 'mantida' | 'reformada' | 'retorno_fase'

export interface PrazoRecurso {
  chave: string
  rotulo: string
  dias: number
  base_legal: string
  data_vencimento: string | null
  dias_restantes: number | null
  semaforo: 'verde' | 'amarelo' | 'vermelho' | null
}

export interface Recurso {
  caixa_entrada_id: number
  existe: boolean
  interposto: boolean | null
  data_interposicao: string | null
  registrado_por: string | null
  parecer_numero_sei: string | null
  parecer_em: string | null
  parecer_por: string | null
  parecer_resumo: string | null
  decisao_resultado: ResultadoDecisaoII | null
  decisao_fase_retorno: string | null
  decisao_fundamentacao: string | null
  decisao_em: string | null
  decisao_por: string | null
  prazos: PrazoRecurso[]
  fases_disponiveis: string[]
  pode_registrar_interposicao: boolean
  pode_emitir_parecer: boolean
  pode_decidir: boolean
}

export function obterRecurso(itemId: number | string): Promise<Recurso> {
  return apiGet<Recurso>(`/processos-andamento/${itemId}/recurso`)
}

export function registrarInterposicao(
  itemId: number | string,
  interposto: boolean,
  dataInterposicao?: string,
): Promise<Recurso> {
  return apiPost<Recurso>(`/processos-andamento/${itemId}/recurso/interposicao`, {
    interposto,
    data_interposicao: dataInterposicao ?? null,
  })
}

export function registrarParecerJuridico(
  itemId: number | string,
  numeroSei: string,
  resumo: string,
): Promise<Recurso> {
  return apiPost<Recurso>(`/processos-andamento/${itemId}/recurso/parecer`, {
    numero_sei: numeroSei || null,
    resumo: resumo || null,
  })
}

export function registrarDecisaoII(
  itemId: number | string,
  resultado: ResultadoDecisaoII,
  fundamentacao: string,
  faseRetorno?: string,
): Promise<Recurso> {
  return apiPost<Recurso>(`/processos-andamento/${itemId}/recurso/decisao-ii`, {
    resultado,
    fundamentacao: fundamentacao || null,
    fase_retorno: faseRetorno ?? null,
  })
}
