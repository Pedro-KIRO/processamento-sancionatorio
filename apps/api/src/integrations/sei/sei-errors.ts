/*
  Erros do cliente do SEI.

  A distinção entre TEMPORÁRIO e DEFINITIVO não é cosmética: ela atravessa a
  aplicação até a tela. O `DespachoModal` lê `detail.temporario` para decidir se
  mostra "instabilidade temporária do SEI" e mantém o botão Confirmar habilitado,
  ou se trata a falha como definitiva e bloqueia a ação.

  Classificar errado tem consequência direta:
    - temporário tratado como definitivo → o usuário perde o texto já digitado e
      acha que o despacho falhou de vez;
    - definitivo tratado como temporário → o usuário tenta de novo várias vezes,
      e cada tentativa pode criar processo ou documento duplicado no SEI.
*/

/**
 * A integração com o SEI não está configurada no ambiente.
 *
 * Tem classe própria porque NÃO é falha do SEI: é variável de ambiente faltando
 * na nossa instalação, e nenhuma tentativa posterior resolve.
 *
 * A distinção importa em quem trata falha do SEI de forma tolerante. A listagem
 * de documentos, por exemplo, engole erro do SEI e devolve os documentos que já
 * conseguiu montar, porque a aba é uma parte da tela e derrubar tudo seria pior.
 * Se a falta de credencial entrasse nesse mesmo caminho, esquecer uma variável
 * em homologação apareceria como "este processo não tem documentos" — e ninguém
 * procuraria uma variável de ambiente a partir desse sintoma.
 */
export class SeiNaoConfiguradoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeiNaoConfiguradoError";
  }
}

/** Falha ao obter o token de acesso do SEI. */
export class SeiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeiAuthError";
  }
}

/** Erro ao chamar a API do SEI. Base para os dois tipos abaixo. */
export class SeiApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly resposta?: string,
  ) {
    super(message);
    this.name = "SeiApiError";
  }
}

/**
 * Erro TEMPORÁRIO do SEI: servidor fora do ar, timeout, instabilidade de rede.
 *
 * Vale tentar novamente depois de algum tempo — não é problema com os dados
 * enviados.
 */
export class SeiIndisponivelError extends SeiApiError {
  constructor(message: string, statusCode?: number, resposta?: string) {
    super(message, statusCode, resposta);
    this.name = "SeiIndisponivelError";
  }
}

/**
 * Erro DEFINITIVO do SEI: dados inválidos, permissão, processo não encontrado.
 *
 * Tentar novamente sem alterar os dados provavelmente falha de novo. Requer
 * intervenção — corrigir dados, verificar a permissão da unidade, ou seguir
 * manualmente pelo site do SEI.
 */
export class SeiErroDefinitivoError extends SeiApiError {
  constructor(message: string, statusCode?: number, resposta?: string) {
    super(message, statusCode, resposta);
    this.name = "SeiErroDefinitivoError";
  }
}

/**
 * Códigos HTTP tratados como instabilidade passageira.
 *
 * 429 entra junto com os 5xx: pedido recusado por excesso de chamadas volta a
 * funcionar sozinho depois da espera, então é temporário para todos os efeitos.
 */
export const CODIGOS_TEMPORARIOS = new Set([429, 500, 502, 503, 504]);

/** Erro de rede que não chegou a produzir resposta HTTP. */
export function ehFalhaDeRede(erro: unknown): boolean {
  if (!(erro instanceof Error)) return false;

  // AbortError vem do AbortSignal.timeout(); TypeError com "fetch failed" é o
  // que o Node produz quando a conexão é recusada ou o DNS não resolve.
  return (
    erro.name === "AbortError" ||
    erro.name === "TimeoutError" ||
    (erro instanceof TypeError && /fetch failed|network/i.test(erro.message))
  );
}

/**
 * Converte uma falha em erro classificado do SEI.
 *
 * Erro que já é do SEI passa direto: reclassificar perderia a informação que a
 * camada de baixo já apurou.
 */
export function classificar(erro: unknown): SeiApiError {
  if (erro instanceof SeiApiError) return erro;

  if (ehFalhaDeRede(erro)) {
    return new SeiIndisponivelError(
      "Não foi possível conectar ao SEI (timeout ou conexão recusada). " +
        "O servidor pode estar temporariamente indisponível.",
    );
  }

  const mensagem = erro instanceof Error ? erro.message : String(erro);
  return new SeiApiError(`Falha inesperada ao chamar o SEI: ${mensagem}`);
}

/** Constrói o erro classificado a partir de uma resposta HTTP com falha. */
export function deRespostaHttp(status: number, corpo?: string): SeiApiError {
  if (CODIGOS_TEMPORARIOS.has(status)) {
    return new SeiIndisponivelError(
      `O servidor do SEI respondeu com erro ${status}. ` +
        "Isso costuma ser uma instabilidade temporária.",
      status,
      corpo,
    );
  }

  return new SeiErroDefinitivoError(
    `O SEI recusou a solicitação (HTTP ${status}). Verifique os dados enviados ` +
      "ou a permissão da unidade.",
    status,
    corpo,
  );
}
