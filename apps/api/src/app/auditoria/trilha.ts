/*
  Regras da trilha de auditoria (Documentação de Negócio v3.0).

  Funções puras, separadas do middleware para poderem ser testadas sem subir a
  aplicação — são elas que decidem o que entra na trilha e como a linha é
  classificada.
*/

/** Métodos que alteram dados e por isso entram na trilha. */
export const METODOS_AUDITADOS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Caminhos ignorados: não alteram dado de negócio e só poluiriam a trilha.
 * Escritos SEM o prefixo /api, porque a comparação é feita depois de removê-lo.
 */
export const CAMINHOS_IGNORADOS = ["/docs", "/openapi.json", "/health"];

const PREFIXO_API = "/api";
const ID_NO_CAMINHO = /\/(\d+)(?:\/|$)/;

/**
 * Caminho sem o `/api` da frente.
 *
 * Existe porque a entidade da trilha é o primeiro segmento do caminho. Quando a
 * API passou a viver sob `/api`, toda linha passou a ser gravada com entidade
 * "api", e o filtro por área do `GET /auditoria` deixou de encontrar qualquer
 * coisa — a trilha continuava sendo escrita, mas ficava impossível de consultar.
 */
export function semPrefixo(caminho: string): string {
  if (caminho === PREFIXO_API) return "/";
  if (caminho.startsWith(`${PREFIXO_API}/`)) {
    return caminho.slice(PREFIXO_API.length);
  }
  return caminho;
}

/** Primeiro segmento do caminho (ignorando o /api), para filtrar por área. */
export function entidadeDoCaminho(caminho: string): string | null {
  const partes = semPrefixo(caminho)
    .split("/")
    .filter((p) => p.length > 0);

  return partes[0] ?? null;
}

/** Primeiro id numérico do caminho, quando houver. */
export function idDoCaminho(caminho: string): number | null {
  const achado = ID_NO_CAMINHO.exec(caminho);
  return achado ? Number(achado[1]) : null;
}

export function deveAuditar(metodo: string, caminho: string): boolean {
  if (!METODOS_AUDITADOS.has(metodo.toUpperCase())) return false;

  const limpo = semPrefixo(caminho);
  return !CAMINHOS_IGNORADOS.some((ignorado) => limpo.startsWith(ignorado));
}
