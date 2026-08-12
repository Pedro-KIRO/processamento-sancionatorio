/**
 * Extração defensiva do conteúdo base64 de um documento devolvido pela API
 * do SEI (repassado "crú" pelo backend, ver `documentos.py`). O formato exato
 * da resposta de `/documentos/{numero}/conteudo` e `/anexos` não está 100%
 * confirmado — no ambiente real, validar e simplificar esta função.
 */

const CAMPOS_BASE64_CONHECIDOS = ['conteudo', 'arquivo', 'documento', 'base64', 'fileContent', 'conteudoBase64']

/** Tenta achar uma string base64 dentro de um payload que pode ser string
 *  direta ou um objeto com o base64 em um dos campos conhecidos. */
export function extrairBase64(payload: unknown): string | null {
  if (typeof payload === 'string') return payload
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>
    for (const campo of CAMPOS_BASE64_CONHECIDOS) {
      const valor = obj[campo]
      if (typeof valor === 'string' && valor.length > 0) return valor
    }
  }
  return null
}

/** Decodifica um base64 para texto. Tenta UTF-8 primeiro; se o conteúdo
 *  declarar charset ISO-8859-1 (comum no SEI), re-decodifica com esse encoding. */
export function decodificarBase64Texto(base64: string): string | null {
  try {
    const binario = atob(base64)
    const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0))

    // Tenta UTF-8 primeiro
    let texto = new TextDecoder('utf-8').decode(bytes)

    // Se o HTML declarar charset iso-8859-1 (ou latin1), re-decodifica
    const inicioLower = texto.slice(0, 500).toLowerCase()
    if (inicioLower.includes('charset=iso-8859-1') || inicioLower.includes('charset=latin1')) {
      texto = new TextDecoder('iso-8859-1').decode(bytes)
    }

    return texto
  } catch {
    return null
  }
}

/** Heurística simples para saber se um texto decodificado é HTML. */
export function pareceHtml(texto: string): boolean {
  const inicio = texto.trimStart().slice(0, 200).toLowerCase()
  return inicio.includes('<!doctype html') || inicio.includes('<html')
}

/** Verifica se um base64 contém um PDF (magic bytes %PDF). */
export function parecePdf(base64: string): boolean {
  try {
    // Os primeiros 4 bytes de um PDF são %PDF (JVBERi em base64)
    return base64.startsWith('JVBERi')
  } catch {
    return false
  }
}

/** Verifica se um base64 contém um arquivo ZIP/XLSX/DOCX (magic bytes PK). */
export function pareceZip(base64: string): boolean {
  try {
    // Os primeiros 2 bytes de um ZIP são PK (UEsDB em base64)
    return base64.startsWith('UEsDB')
  } catch {
    return false
  }
}

/** Converte base64 para Uint8Array (para uso com bibliotecas como SheetJS). */
export function base64ParaUint8Array(base64: string): Uint8Array {
  const binario = atob(base64)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i)
  }
  return bytes
}

/** Gera uma Blob URL para exibir um PDF embutido em <iframe>/<embed>.
 *  Blob URLs não têm limite de tamanho (diferente de data URLs que falham
 *  acima de ~2MB em muitos navegadores). */
export function gerarBlobUrlPdf(base64: string): string {
  const bytes = base64ParaUint8Array(base64)
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' })
  return URL.createObjectURL(blob)
}
