/**
 * Registra e consulta quais itens foram visitados pelo usuário na sessão.
 * Usa sessionStorage para que a marcação persista ao navegar mas limpe ao
 * fechar a aba (não polui entre sessões distintas).
 */

const CHAVE = 'itens:visitados'

function _ler(): Set<string> {
  try {
    const raw = sessionStorage.getItem(CHAVE)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function _gravar(visitados: Set<string>) {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify([...visitados]))
  } catch {
    // sessionStorage indisponível — segue sem persistir
  }
}

/** Marca um item como visitado (por chave única, ex.: "caixa:78" ou "processo:3"). */
export function marcarVisitado(chave: string) {
  const visitados = _ler()
  visitados.add(chave)
  _gravar(visitados)
}

/** Verifica se um item já foi visitado nesta sessão. */
export function foiVisitado(chave: string): boolean {
  return _ler().has(chave)
}
