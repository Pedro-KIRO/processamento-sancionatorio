import { Injectable, Logger } from "@nestjs/common";

import { PrismaService } from "../../shared/prisma.service";

/** Não expira: usar para conteúdo que não muda depois de gravado. */
export const TTL_INFINITO = 0;

/** 5 minutos — listas que crescem conforme o processo anda. */
export const TTL_LISTA = 300;

export const TTL_CURTO = 60;

/**
 * Acima disto o valor não é guardado.
 *
 * Sem o teto, um PDF grande de anexo entraria numa coluna de texto do banco a
 * cada consulta e o cache passaria a ser o problema em vez da solução. O
 * documento continua acessível: só volta a ser baixado do SEI sob demanda.
 */
export const TAMANHO_MAXIMO_CACHE = 8 * 1024 * 1024;

/**
 * Cache persistente de respostas do SEI, na tabela `cache_sei`.
 *
 * É persistente e não em memória de propósito: a API roda em contêiner que pode
 * ser reiniciado ou escalado, e o custo que se quer evitar é a chamada ao SEI,
 * que é lenta e às vezes indisponível — um cache por processo perderia o ganho
 * a cada deploy.
 *
 * REGRA DE TTL POR TIPO DE CHAVE
 *
 * - `doc:*` usa `TTL_INFINITO`. Documento registrado no SEI não muda de
 *   conteúdo, então rebaixá-lo só geraria download repetido do mesmo arquivo.
 * - `docs:*` e `hist:*` usam `TTL_LISTA`. Crescem conforme o processo anda, e
 *   além do TTL são invalidados na hora quando o próprio app inclui um
 *   documento (ver `invalidarProcesso`).
 *
 * FALHA DE CACHE NUNCA PROPAGA
 *
 * Ler ou gravar com erro devolve como se não houvesse cache, e quem chamou
 * segue para o SEI. O cache é otimização: derrubar a requisição do usuário
 * porque a tabela auxiliar falhou trocaria uma resposta lenta por uma tela de
 * erro.
 */
@Injectable()
export class CacheSeiService {
  private readonly logger = new Logger(CacheSeiService.name);

  constructor(private readonly prisma: PrismaService) {}

  chaveDocumento(numeroDoc: string): string {
    return `doc:${numeroDoc}`;
  }

  chaveListaDocumentos(idProcedimento: string): string {
    return `docs:${idProcedimento}`;
  }

  chaveHistorico(idProcedimento: string, modo: string): string {
    return `hist:${idProcedimento}:${modo}`;
  }

  /** Lê uma entrada. Devolve `null` se ausente, expirada ou ilegível. */
  async obter<T>(chave: string, ttlSegundos = TTL_LISTA): Promise<T | null> {
    try {
      const registro = await this.prisma.cacheSei.findUnique({
        where: { chave },
      });

      if (!registro) {
        return null;
      }

      if (ttlSegundos > 0) {
        const idadeMs = Date.now() - registro.atualizadoEm.getTime();
        if (idadeMs > ttlSegundos * 1000) {
          return null;
        }
      }

      return JSON.parse(registro.valorJson) as T;
    } catch (erro) {
      this.logger.debug(
        `Falha ao ler cache ${chave} (ignorando): ${this.mensagem(erro)}`,
      );
      return null;
    }
  }

  /** Grava ou atualiza uma entrada. Silencioso em caso de erro. */
  async gravar(chave: string, valor: unknown): Promise<void> {
    try {
      const bruto = JSON.stringify(valor);

      // JSON.stringify devolve undefined para função e symbol — gravar isso
      // deixaria uma entrada que estoura no JSON.parse da próxima leitura.
      if (typeof bruto !== "string") {
        return;
      }

      const tamanho = Buffer.byteLength(bruto, "utf8");
      if (tamanho > TAMANHO_MAXIMO_CACHE) {
        this.logger.log(
          `Cache ${chave} ignorado: ${tamanho} bytes acima do limite`,
        );
        return;
      }

      await this.prisma.cacheSei.upsert({
        where: { chave },
        create: { chave, valorJson: bruto, tamanho },
        update: { valorJson: bruto, tamanho },
      });
    } catch (erro) {
      this.logger.debug(
        `Falha ao gravar cache ${chave} (ignorando): ${this.mensagem(erro)}`,
      );
    }
  }

  /** Remove uma entrada específica. */
  async invalidar(chave: string): Promise<void> {
    try {
      await this.prisma.cacheSei.deleteMany({ where: { chave } });
    } catch (erro) {
      this.logger.debug(
        `Falha ao invalidar cache ${chave} (ignorando): ${this.mensagem(erro)}`,
      );
    }
  }

  /**
   * Invalida as listas cacheadas de um processo.
   *
   * Chamar depois de o app incluir documento no SEI. Sem isso a lista fica
   * velha até o TTL expirar, e o usuário não vê o documento que acabou de
   * gerar — o que parece falha na geração, levando a gerar de novo e duplicar
   * o documento no SEI.
   */
  async invalidarProcesso(idProcedimento: string): Promise<void> {
    if (!idProcedimento) {
      return;
    }

    const chaves = [
      this.chaveListaDocumentos(idProcedimento),
      this.chaveHistorico(idProcedimento, "resumido"),
      this.chaveHistorico(idProcedimento, "completo"),
    ];

    try {
      await this.prisma.cacheSei.deleteMany({ where: { chave: { in: chaves } } });
    } catch (erro) {
      this.logger.debug(
        `Falha ao invalidar o processo ${idProcedimento} (ignorando): ${this.mensagem(erro)}`,
      );
    }
  }

  /** Remove todas as entradas. Devolve quantas saíram. */
  async limparTudo(): Promise<number> {
    const { count } = await this.prisma.cacheSei.deleteMany({});
    return count;
  }

  private mensagem(erro: unknown): string {
    return erro instanceof Error ? erro.message : String(erro);
  }
}
