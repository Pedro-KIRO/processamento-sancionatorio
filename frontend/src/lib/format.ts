/** Formata data ISO (ou YYYY-MM-DD) para dd/mm/aaaa. */
export function formatarData(valor: string | null): string {
  if (!valor) return '-'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const d = new Date(valor)
  return isNaN(d.getTime()) ? valor : d.toLocaleDateString('pt-BR')
}

/** Aplica máscara de CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00). */
export function mascararDocumento(valor: string | null): string {
  if (!valor) return '-'
  const d = valor.replace(/\D/g, '')
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  return valor
}

/**
 * Nome completo da divisão a partir do código de segmento gravado no banco.
 *
 * O banco guarda o segmento abreviado e sem acento (`Educacao`, `Veiculos`,
 * `Condutores`), mas a divisão tem nome próprio — no caso de Educação, bem
 * mais longo. Os nomes abaixo são os mesmos usados no app de Processamento
 * original (tela "Divisões").
 */
const DIVISAO_POR_SEGMENTO: Record<string, string> = {
  educacao: 'Educação e Medidas Administrativas de Trânsito',
  veiculos: 'Veículos',
  condutores: 'Condutores',
  geral: 'Geral',
}

/** Normaliza texto para comparação: sem acento, sem espaços extras, minúsculo. */
function chaveNormalizada(texto: string | null): string {
  return (texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Traduz o segmento para o nome completo da divisão responsável.
 *
 * Se o segmento não for reconhecido, devolve o próprio valor recebido — melhor
 * mostrar o código do que um espaço vazio.
 */
export function divisaoPorSegmento(segmento: string | null): string {
  const chave = chaveNormalizada(segmento)
  if (!chave) return '-'
  return DIVISAO_POR_SEGMENTO[chave] ?? (segmento as string)
}

export type TipoPessoa = 'fisica' | 'juridica' | 'indefinido'

/**
 * Identifica se o documento é de pessoa física ou jurídica.
 *
 * A distinção é pela quantidade de dígitos: CPF tem 11 (pessoa física) e CNPJ
 * tem 14 (pessoa jurídica). Qualquer outro tamanho fica 'indefinido' — acontece
 * quando o cadastro do agente está incompleto no SharePoint.
 */
export function tipoPessoa(documento: string | null): TipoPessoa {
  const d = (documento ?? '').replace(/\D/g, '')
  if (d.length === 11) return 'fisica'
  if (d.length === 14) return 'juridica'
  return 'indefinido'
}

/** Rótulo do tipo de pessoa, para exibir no lugar do genérico "CPF/CNPJ". */
export function rotuloTipoPessoa(documento: string | null): string {
  switch (tipoPessoa(documento)) {
    case 'fisica':
      return 'Pessoa Física'
    case 'juridica':
      return 'Pessoa Jurídica'
    default:
      return 'Documento'
  }
}

/** Nome do documento conforme o tipo: CPF, CNPJ ou genérico. */
export function rotuloDocumento(documento: string | null): string {
  switch (tipoPessoa(documento)) {
    case 'fisica':
      return 'CPF'
    case 'juridica':
      return 'CNPJ'
    default:
      return 'CPF/CNPJ'
  }
}

/**
 * Razão social / nome do agente sempre em caixa alta.
 *
 * Padrão visual do projeto: o nome do agente regulado (razão social da empresa
 * ou nome da pessoa física) é o dado que identifica a linha, então fica em
 * caixa alta para destacar dos demais campos. É também como o SharePoint já
 * grava a maioria dos registros — a função só garante que os poucos gravados em
 * caixa mista não fiquem diferentes dos outros.
 */
export function formatarRazaoSocial(valor: string | null | undefined): string {
  if (!valor) return '-'
  const texto = valor.trim()
  return texto ? texto.toUpperCase() : '-'
}

/**
 * Siglas que não devem ser rebaixadas por `formatarTexto`.
 *
 * São classes de agente e tipos de documento gravados em caixa alta no
 * cadastro: virar "Ecv" ou "Cnpj" descaracterizaria o termo.
 */
const SIGLA = /^[A-ZÀ-Ý0-9&./-]{2,6}$/

/**
 * Palavras que não recebem inicial maiúscula em Title Case (preposições e
 * artigos curtos em português). Exceto quando estão no início da frase.
 */
const PALAVRAS_MENORES = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos',
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'por', 'para', 'com',
  'sem', 'sob', 'que', 'se',
])

/**
 * Demais textos: Sentence case (apenas a primeira letra maiúscula).
 *
 * Complemento do padrão acima — só a razão social/nome vai em caixa alta;
 * classe do agente, situação, tipo de documento e afins ficam com a primeira
 * letra maiúscula e o resto em minúsculo. Palavras que são siglas (ECV, EPIV,
 * CNPJ, TAC) passam intactas, senão o rótulo perderia o sentido.
 */
export function formatarTexto(valor: string | null | undefined): string {
  if (!valor) return '-'
  const texto = valor.trim()
  if (!texto) return '-'

  const palavras = texto.split(/(\s+)/).map((parte, indice) => {
    if (!parte.trim()) return parte
    if (SIGLA.test(parte)) return parte
    const minusculo = parte.toLocaleLowerCase('pt-BR')
    // Só a primeira palavra recebe inicial maiúscula; as outras ficam em
    // minúsculo, como em "Processo instaurado".
    return indice === 0
      ? minusculo.charAt(0).toLocaleUpperCase('pt-BR') + minusculo.slice(1)
      : minusculo
  })

  return palavras.join('')
}

/** Iniciais do nome para o avatar. */
export function iniciais(nome: string | null): string {
  if (!nome) return '?'
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase()
}

/**
 * Monta o link direto para o processo no portal web do SEI.
 * A URL base vem de VITE_SEI_WEB_URL (env). Se não configurada, retorna string vazia.
 *
 * Quando disponível, usa o `idProcedimento` (ID interno do SEI) que é o correto
 * para a ação procedimento_trabalhar. Caso contrário, faz fallback com o número
 * SEI limpo (funcionará se o SEI aceitar o protocolo como identificador).
 *
 * No app antigo (Power Automate), o fluxo "LinkDireto" consultava a API do SEI
 * com o número limpo + idUnidade e retornava o link "procedimento_trabalhar".
 * Aqui usamos diretamente o idProcedimento obtido da API.
 */
export function montarLinkSei(numeroSei: string, idProcedimento?: string | null): string {
  const base = import.meta.env.VITE_SEI_WEB_URL
  if (!base) return ''
  const id = idProcedimento || numeroSei.replace(/[.\-/\s]/g, '')
  return `${base.replace(/\/$/, '')}/controlador.php?acao=procedimento_trabalhar&id_procedimento=${id}`
}
