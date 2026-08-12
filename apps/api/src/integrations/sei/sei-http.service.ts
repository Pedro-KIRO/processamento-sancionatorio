import { Injectable, Logger } from "@nestjs/common";

import { jsonTolerante } from "./json-tolerante";
import { SeiConfigService } from "./sei-config.service";
import {
  classificar,
  deRespostaHttp,
  SeiApiError,
  SeiAuthError,
  SeiIndisponivelError,
} from "./sei-errors";

/**
 * Qual API do SEI atende a chamada.
 *
 * O SEI publica três hosts distintos, derivados do mesmo nome base:
 *   processos  — consulta e criação de processo, andamentos, prazos
 *   documentos — conteúdo e inclusão de documento, upload de arquivo
 *   parametros — séries, tipos de procedimento, blocos de assinatura
 *
 * Chamar o host errado devolve 404, que parece "processo não existe" e manda
 * quem investiga para o lado errado. Por isso o host é escolhido por nome, e não
 * montado à mão em cada método.
 */
export type ApiSei = "processos" | "documentos" | "parametros";

/** Opções de uma chamada ao SEI. */
export interface OpcoesChamada {
  metodo?: "GET" | "POST" | "PUT" | "DELETE";
  /** Caminho relativo à base, começando com "/". */
  caminho: string;
  idUnidade: string | number;
  /** Host do SEI. Padrão: `processos`. */
  api?: ApiSei;
  query?: Record<string, string | number | boolean | undefined>;
  corpo?: unknown;
  cabecalhosExtras?: Record<string, string>;
  /**
   * Se a chamada pode ser repetida automaticamente em caso de instabilidade.
   *
   * LEIA O COMENTÁRIO DE `executar` ANTES DE MARCAR COMO true.
   */
  podeRepetir: boolean;
}

const TIMEOUT_PADRAO_MS = 60_000;
const MAX_TENTATIVAS = 3;
const ESPERA_BASE_MS = 1_500;

/** Folga para renovar o token antes de ele expirar de fato. */
const FOLGA_RENOVACAO_MS = 60_000;

/**
 * Camada HTTP do cliente do SEI: token, cabeçalhos, classificação de erro e
 * repetição.
 *
 * Separada das chamadas de negócio para que a política de repetição e a
 * classificação de erro existam num lugar só — espalhá-las por 24 métodos é
 * como se perde a distinção entre falha temporária e definitiva.
 */
@Injectable()
export class SeiHttpService {
  private readonly logger = new Logger(SeiHttpService.name);

  private token: string | null = null;
  private tokenExpiraEm = 0;

  /**
   * Autenticação em andamento.
   *
   * O backend Python usa um `threading.Lock` aqui. Em Node o problema não é
   * paralelismo de thread, mas concorrência assíncrona: dez requisições que
   * chegam juntas com o token expirado dispararia dez autenticações. Guardar a
   * promessa em curso faz todas aguardarem a mesma chamada.
   */
  private autenticacaoEmCurso: Promise<string> | null = null;

  constructor(private readonly config: SeiConfigService) {}

  // ==========================================================================
  // Execução
  // ==========================================================================

  /**
   * Executa uma chamada ao SEI, classificando o erro e repetindo quando cabe.
   *
   * REGRA CENTRAL: só LEITURA repete.
   *
   * Operação de escrita — criar processo, incluir documento, definir prazo —
   * nunca é repetida automaticamente. Uma escrita que falhou por timeout pode
   * ter sido concluída no servidor: a resposta se perdeu, não a ação. Repetir
   * criaria um segundo processo ou um documento duplicado no SEI, e desfazer
   * isso é trabalho manual do analista.
   *
   * Por isso `podeRepetir` é obrigatório na interface, e não tem valor padrão:
   * quem escreve a chamada precisa decidir explicitamente.
   */
  async executar<T>(opcoes: OpcoesChamada): Promise<T> {
    this.config.exigirConfigurado();

    const tentativas = opcoes.podeRepetir ? MAX_TENTATIVAS : 1;
    let ultimoErro: SeiApiError | null = null;

    for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
      try {
        return await this.chamar<T>(opcoes);
      } catch (erro) {
        /*
          Falha de autenticação passa intacta.

          `SeiAuthError` não estende `SeiApiError` de propósito: não é erro de
          dado nem de disponibilidade do SEI, é problema de credencial ou do
          provedor de identidade. Sem esta linha, `classificar` cairia no caso
          genérico e trocaria "Resposta de token sem access_token" por "Falha
          inesperada ao chamar o SEI" — justamente a mensagem que diria a quem
          está diagnosticando onde olhar.
        */
        if (erro instanceof SeiAuthError) {
          throw erro;
        }

        const classificado = classificar(erro);

        // Erro definitivo não melhora com espera: falha na primeira.
        if (!(classificado instanceof SeiIndisponivelError)) {
          throw classificado;
        }

        ultimoErro = classificado;

        if (tentativa < tentativas) {
          // Backoff exponencial: 1,5s, 3s, 6s...
          const espera = ESPERA_BASE_MS * 2 ** (tentativa - 1);
          this.logger.warn(
            `SEI indisponível em ${opcoes.caminho} (tentativa ${tentativa}/${tentativas}). ` +
              `Nova tentativa em ${espera}ms.`,
          );
          await this.esperar(espera);
          continue;
        }

        throw classificado;
      }
    }

    throw ultimoErro ?? new SeiIndisponivelError("Falha desconhecida ao chamar o SEI.");
  }

  /** Uma tentativa de chamada, sem repetição. */
  private async chamar<T>(opcoes: OpcoesChamada): Promise<T> {
    const url = this.montarUrl(opcoes.caminho, opcoes.query, opcoes.api);
    const cabecalhos = await this.cabecalhos(
      opcoes.idUnidade,
      opcoes.cabecalhosExtras,
    );

    const temCorpo = opcoes.corpo !== undefined;
    if (temCorpo) {
      cabecalhos["Content-Type"] = "application/json";
    }

    const resposta = await fetch(url, {
      method: opcoes.metodo ?? "GET",
      headers: cabecalhos,
      body: temCorpo ? JSON.stringify(opcoes.corpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_PADRAO_MS),
    });

    if (!resposta.ok) {
      // O corpo do erro costuma trazer a mensagem do SEI, que é o que ajuda o
      // analista a entender a recusa. Ler pode falhar; nesse caso segue sem.
      const corpo = await resposta.text().catch(() => undefined);
      throw deRespostaHttp(resposta.status, corpo);
    }

    return this.lerCorpo<T>(resposta);
  }

  /**
   * Lê a resposta conforme o tipo devolvido.
   *
   * Alguns endpoints do SEI respondem 204 sem corpo (receber processo, excluir
   * documento). `resposta.json()` nesses casos lança erro de JSON inválido, e o
   * sintoma apareceria como falha numa operação que deu certo.
   */
  private async lerCorpo<T>(resposta: Response): Promise<T> {
    if (resposta.status === 204) {
      return undefined as T;
    }

    const texto = await resposta.text();
    if (!texto.trim()) {
      return undefined as T;
    }

    try {
      // Tolerante a caractere de controle cru dentro de string: o SEI devolve
      // isso quando o nome de um documento foi cadastrado com Enter no meio.
      // Ver json-tolerante.ts.
      return jsonTolerante<T>(texto);
    } catch {
      // Resposta não-JSON num endpoint que deveria devolver JSON é erro de
      // configuração (proxy devolvendo HTML, por exemplo), não dado válido.
      throw new SeiApiError(
        "O SEI devolveu uma resposta que não é JSON. Verifique a URL da API.",
        resposta.status,
        texto.slice(0, 500),
      );
    }
  }

  /** Baixa conteúdo binário (documento, anexo). */
  async baixarBinario(opcoes: OpcoesChamada): Promise<Buffer> {
    this.config.exigirConfigurado();

    const url = this.montarUrl(opcoes.caminho, opcoes.query, opcoes.api);
    const cabecalhos = await this.cabecalhos(opcoes.idUnidade, {
      ...opcoes.cabecalhosExtras,
      Accept: "*/*",
    });

    const resposta = await fetch(url, {
      method: opcoes.metodo ?? "GET",
      headers: cabecalhos,
      signal: AbortSignal.timeout(TIMEOUT_PADRAO_MS),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => undefined);
      throw deRespostaHttp(resposta.status, corpo);
    }

    return Buffer.from(await resposta.arrayBuffer());
  }

  // ==========================================================================
  // Autenticação
  // ==========================================================================

  /**
   * Token válido, renovando com folga antes de expirar.
   *
   * A folga de 60 segundos evita a corrida em que o token passa na verificação e
   * expira no caminho até o SEI — o pedido voltaria 401 sem motivo aparente.
   */
  private async tokenValido(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiraEm - FOLGA_RENOVACAO_MS) {
      return this.token;
    }

    // Se outra requisição já está autenticando, aguarda a mesma promessa em vez
    // de abrir uma segunda autenticação.
    if (this.autenticacaoEmCurso) {
      return this.autenticacaoEmCurso;
    }

    this.autenticacaoEmCurso = this.autenticar().finally(() => {
      this.autenticacaoEmCurso = null;
    });

    return this.autenticacaoEmCurso;
  }

  /** OAuth2 client_credentials. */
  private async autenticar(): Promise<string> {
    const corpo = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    // Obter token é idempotente, então pode repetir em caso de instabilidade do
    // provedor de identidade.
    let ultimoErro: SeiApiError | null = null;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa += 1) {
      try {
        const resposta = await fetch(this.config.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: corpo,
          signal: AbortSignal.timeout(TIMEOUT_PADRAO_MS),
        });

        if (!resposta.ok) {
          const texto = await resposta.text().catch(() => undefined);
          throw deRespostaHttp(resposta.status, texto);
        }

        const dados = (await resposta.json()) as {
          access_token?: string;
          expires_in?: number;
        };

        if (!dados.access_token) {
          // Não é falha de rede: o provedor respondeu 200 sem o token. Repetir
          // não resolve.
          throw new SeiAuthError("Resposta de token sem 'access_token'.");
        }

        this.token = dados.access_token;
        this.tokenExpiraEm = Date.now() + (dados.expires_in ?? 3600) * 1000;

        return this.token;
      } catch (erro) {
        if (erro instanceof SeiAuthError) throw erro;

        const classificado = classificar(erro);
        if (!(classificado instanceof SeiIndisponivelError)) {
          throw new SeiAuthError(
            `Falha ao autenticar no SEI: ${classificado.message}`,
          );
        }

        ultimoErro = classificado;
        if (tentativa < MAX_TENTATIVAS) {
          await this.esperar(ESPERA_BASE_MS * 2 ** (tentativa - 1));
        }
      }
    }

    throw new SeiAuthError(
      `Falha ao autenticar no SEI: ${ultimoErro?.message ?? "motivo desconhecido"}`,
    );
  }

  /**
   * Cabeçalhos exigidos pela API do SEI.
   *
   * Todos são obrigatórios — a ausência de qualquer um dos `X-` faz o SEI
   * recusar com mensagem genérica, difícil de relacionar à causa.
   */
  private async cabecalhos(
    idUnidade: string | number,
    extras?: Record<string, string>,
  ): Promise<Record<string, string>> {
    return {
      "X-SiglaSistema": this.config.siglaSistema,
      "X-IdentificacaoServico": this.config.identificacaoServico,
      "X-IdUnidade": String(idUnidade),
      "X-TraceId-SP": this.config.traceId,
      Authorization: `Bearer ${await this.tokenValido()}`,
      Accept: "application/json",
      ...extras,
    };
  }

  // ==========================================================================
  // Apoio
  // ==========================================================================

  private montarUrl(
    caminho: string,
    query?: Record<string, string | number | boolean | undefined>,
    api: ApiSei = "processos",
  ): string {
    const url = new URL(`${this.config.baseDa(api)}${caminho}`);

    for (const [chave, valor] of Object.entries(query ?? {})) {
      // Parâmetro ausente não vai na URL: `?limit=undefined` viraria o texto
      // "undefined" e o SEI recusaria.
      if (valor !== undefined) {
        url.searchParams.set(chave, String(valor));
      }
    }

    return url.toString();
  }

  private esperar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Descarta o token em cache. Usado em teste e após 401 inesperado. */
  invalidarToken(): void {
    this.token = null;
    this.tokenExpiraEm = 0;
  }
}
