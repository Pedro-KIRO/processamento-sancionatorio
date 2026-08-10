import type { Marcador } from '../../lib/malaDireta'

/** Dados completos de um item da caixa de entrada (retorno de GET /caixa-entrada/:id). */
export interface DetalhesRelatorio {
  id: number
  id_relatorio: string | null
  numero_sei: string | null
  id_procedimento: string | null
  razao_social: string | null
  agente_regulado: string | null
  segmento: string | null
  tipo_documento: string | null
  cnpj_cpf: string | null
  /** Município do agente, resolvido via listaMunicipios (já acentuado). */
  municipio: string | null
  /** Superintendência regional correspondente ao município. */
  superintendencia: string | null
  /** Não conformidades apuradas no checklist de fiscalização. */
  total_apontamentos: number | null
  /** Quantas perguntas do checklist foram avaliadas (denominador). */
  total_itens_avaliados: number | null
  data_recebimento: string | null
  data_remetido: string | null
  status_triagem: string | null
}

/** Uma não conformidade do checklist (retorno de GET /caixa-entrada/:id/apontamentos). */
export interface Apontamento {
  pergunta: string
  resposta_esperada: string
  resposta_dada: string
  enquadramento: string
}

/** Resumo de conformidade do relatório. */
export interface ResumoApontamentos {
  total_apontamentos: number
  itens_avaliados: number
  /** Itens marcados como "não se aplica" — ficam fora da apuração. */
  nao_aplicaveis: number
  em_conformidade: boolean
  apontamentos: Apontamento[]
}

/** Um número SEI do agente: relatório de fiscalização ou processo sancionatório. */
export interface RegistroAgente {
  tipo: 'relatorio' | 'processo'
  numero_sei: string | null
  /** ID interno do procedimento no SEI, para montar o link direto. */
  id_procedimento: string | null
  caixa_entrada_id: number
  status_triagem: string | null
  /** True quando o registro pertence ao item aberto na tela. */
  atual: boolean
}

/** Inventário de relatórios e processos do agente
 *  (retorno de GET /caixa-entrada/:id/historico-agente). */
export interface HistoricoAgente {
  total: number
  total_relatorios: number
  total_processos: number
  registros: RegistroAgente[]
}

/** Anotação interna (retorno de GET /caixa-entrada/:id/anotacoes). */
export interface Anotacao {
  id: number
  caixa_entrada_id: number
  autor: string | null
  texto: string
  criado_em: string
}

/** Documento do processo (retorno de GET /caixa-entrada/:id/documentos). */
export interface Documento {
  numero: string
  nome: string
  tipo: string // "interno" ou "externo"
  data_geracao: string | null
}

/** Tipo de despacho SEI que pode ser gerado a partir da tela de análise. */
export type TipoDespacho = 'arquivar' | 'tac' | 'instaurar'

/** Template HTML carregado para edição (retorno de GET /despachos/:tipo). */
export interface TemplateDespacho {
  html: string
  /** Lacunas do modelo, para o formulário de mala direta que antecede o editor. */
  marcadores?: Marcador[]
}

/** Resultado de uma ação de despacho executada com sucesso no SEI. */
export interface ResultadoDespacho {
  numero_sei: string
  id_procedimento: string
  id_documento: string | null
  documento_formatado: string | null
  /** Problemas não-críticos que não impediram o resultado (ex.: falha ao
   *  incluir no bloco de assinatura) — o usuário precisa concluir manualmente. */
  avisos: string[]
}
