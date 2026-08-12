export interface ItemProcessoAndamento {
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
  numero_processo_sei: string | null
  id_procedimento_processo: string | null
  data_instauracao: string | null
  /** Priorização (★) da Coordenação: destaque e primeiro lugar na fila. */
  prioritario: boolean
  prioridade_justificativa: string | null
}

export interface FiltrosProcessos {
  busca?: string
  agente?: string
  dataInicio?: string
  dataFim?: string
  filtro?: string  // prazos, cautelares, decisoes, arquivamento
}

/** Conteúdo bruto de um documento do processo (retorno da API do SEI,
 *  repassado pelo backend). O formato exato do campo `conteudo` varia
 *  conforme o tipo do documento — ver `extrairBase64Documento` em
 *  `lib/documento.ts` para a extração defensiva do base64. */
export interface ConteudoDocumento {
  numero: string
  nome: string
  tipo: string // "interno" ou "externo"
  conteudo: unknown
}
