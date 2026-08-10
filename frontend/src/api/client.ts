/**
 * Prefixo de todas as rotas da API (ver backend/app/main.py).
 *
 * Existe porque, sem ele, o endereço da tela e o da API eram o mesmo texto:
 * `/cautelares` era ao mesmo tempo a tela e a lista de dados, e o backend
 * respondia com os dados. Quem apertasse F5 em oito telas via JSON cru.
 */
const PREFIXO_API = '/api'

/**
 * Origem do backend. Vazio em desenvolvimento e no build servido pelo próprio
 * backend, quando as chamadas são de mesma origem.
 *
 * Não dá para usar `??` aqui: o `frontend/.env` define `VITE_API_URL=` (string
 * vazia), e string vazia não é nulo — o `??` devolveria a vazia e o prefixo
 * nunca entraria.
 */
const ORIGEM = import.meta.env.VITE_API_URL || ''

/**
 * Base de toda chamada à API. Exportada porque os links de download usam
 * `<a href>` direto (o navegador precisa da URL, não de um fetch) e devem sair
 * daqui em vez de remontar o caminho na mão.
 */
export const BASE_API = `${ORIGEM}${PREFIXO_API}`

const BASE = BASE_API

/**
 * Corpo estruturado de erro retornado pelas rotas que chamam a API do SEI
 * (ver backend/app/api/routes/despachos.py). Outras rotas podem retornar
 * `detail` como string simples — nesse caso os campos abaixo vêm undefined.
 */
export interface DetalheErroApi {
  message?: string
  temporario?: boolean
  etapa?: string | null
  numero_sei_criado?: string | null
  id_procedimento_criado?: string | null
}

/** Erro de chamada à API que preserva o corpo (detail) da resposta, quando houver. */
export class ApiError extends Error {
  status: number
  detail?: DetalheErroApi

  constructor(status: number, path: string, detail?: DetalheErroApi) {
    super(detail?.message ?? `Erro ${status} ao chamar ${path}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  /** True quando o erro é uma instabilidade temporária do SEI (pode tentar novamente). */
  get temporario(): boolean {
    return this.detail?.temporario === true
  }
}

async function lancarErro(resp: Response, path: string): Promise<never> {
  let detail: DetalheErroApi | undefined
  try {
    const corpo = await resp.json()
    // FastAPI embrulha o corpo em { detail: ... }; `detail` pode ser string
    // (rotas simples) ou objeto estruturado (rotas de despachos SEI).
    const d = corpo?.detail
    detail = typeof d === 'string' ? { message: d } : d
  } catch {
    detail = undefined
  }
  throw new ApiError(resp.status, path, detail)
}

/** Obtém o token de acesso MSAL silenciosamente (se auth estiver configurada). */
async function obterToken(): Promise<string | null> {
  try {
    const { msalInstance, authConfigurada, apiScopes, msalReady } = await import('../auth/msalConfig')
    if (!authConfigurada) return null
    await msalReady
    const accounts = msalInstance.getAllAccounts()
    if (accounts.length === 0) return null
    const response = await msalInstance.acquireTokenSilent({ ...apiScopes, account: accounts[0] })
    return response.accessToken
  } catch {
    return null
  }
}

async function headersComToken(extras: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Accept: 'application/json', ...extras }
  const token = await obterToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

export async function apiGet<T>(path: string): Promise<T> {
  const headers = await headersComToken()
  const resp = await fetch(`${BASE}${path}`, { headers })
  if (!resp.ok) {
    await lancarErro(resp, path)
  }
  return (await resp.json()) as T
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const headers = await headersComToken({ 'Content-Type': 'application/json' })
  const resp = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    await lancarErro(resp, path)
  }
  return (await resp.json()) as T
}


/**
 * POST multipart (formulário com arquivo).
 *
 * Não define Content-Type de propósito: quem monta o boundary é o navegador, a
 * partir do FormData. Se fixássemos o cabeçalho, o backend não acharia as
 * partes.
 */
export async function apiPostForm<T>(path: string, corpo: FormData): Promise<T> {
  const headers = await headersComToken()
  const resp = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: corpo })
  if (!resp.ok) {
    await lancarErro(resp, path)
  }
  return (await resp.json()) as T
}

/**
 * GET de conteúdo binário (PDF), devolvido como Blob.
 *
 * Vai por fetch com token em vez de apontar o <iframe> direto para a URL: o
 * navegador não manda o Authorization numa navegação, e a rota exige
 * autenticação. Quem chama gera a Blob URL para exibir.
 */
export async function apiGetBlob(path: string): Promise<Blob> {
  const headers = await headersComToken()
  const resp = await fetch(`${BASE}${path}`, { headers })
  if (!resp.ok) {
    await lancarErro(resp, path)
  }
  return await resp.blob()
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const headers = await headersComToken({ 'Content-Type': 'application/json' })
  const resp = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    await lancarErro(resp, path)
  }
  return (await resp.json()) as T
}

/** DELETE cujo resultado é o registro atualizado (e não 204 sem corpo). */
export async function apiDeleteJson<T>(path: string): Promise<T> {
  const headers = await headersComToken()
  const resp = await fetch(`${BASE}${path}`, { method: 'DELETE', headers })
  if (!resp.ok) {
    await lancarErro(resp, path)
  }
  return (await resp.json()) as T
}

export async function apiDelete(path: string): Promise<void> {
  const headers = await headersComToken()
  const resp = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers,
  })
  if (!resp.ok) {
    await lancarErro(resp, path)
  }
}
