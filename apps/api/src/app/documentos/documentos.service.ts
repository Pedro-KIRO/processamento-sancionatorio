import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  CacheSeiService,
  TTL_INFINITO,
  TTL_LISTA,
} from "../../integrations/sei/cache-sei.service";
import { SeiNaoConfiguradoError } from "../../integrations/sei/sei-errors";
import { SeiService } from "../../integrations/sei/sei.service";
import { PrismaService } from "../../shared/prisma.service";
import {
  AndamentoSei,
  ConteudoDocumentoResposta,
  DocumentoResposta,
  extensaoPorContentType,
  extrairNomeDaDescricao,
  extrairNumeroDocumento,
  nomeArquivoSeguro,
  TAREFA_DOC_EXCLUIDO,
  TAREFA_DOC_INTERNO,
  TipoDocumento,
  TIPO_EXTERNO,
  TIPO_INTERNO,
} from "./dto/documento.dto";

/**
 * Unidades que podem ter acesso a um processo.
 *
 * O SEI só entrega os documentos de um processo à unidade em que ele está
 * aberto, e não há endpoint que informe qual é. Quando o banco não sabe a
 * unidade, resta tentar — daí a lista.
 */
const UNIDADES_CONSULTA = [
  "110051045",
  "110051042",
  "110053117",
  "110051044",
  "110051043",
  "110053119",
] as const;

/** Itens por página na consulta de andamentos, conforme a API do SEI. */
const ITENS_POR_PAGINA = 100;

/**
 * Teto de páginas percorridas ao montar a lista de documentos.
 *
 * O laço avança enquanto o SEI devolver página cheia, e o backend Python não
 * tinha limite: uma resposta que sempre viesse cheia deixaria a requisição
 * girando até o timeout, prendendo uma conexão do pool. 50 páginas são 5.000
 * andamentos de documento, muito acima de qualquer processo real.
 */
const MAXIMO_PAGINAS = 50;

@Injectable()
export class DocumentosService {
  private readonly logger = new Logger(DocumentosService.name);

  /**
   * Última unidade que respondeu com sucesso a uma consulta de documento.
   *
   * Vale como palpite porque documentos de um mesmo processo pertencem à mesma
   * unidade, e os processos são consultados em sequência pelo mesmo analista.
   * Acertar na primeira tentativa evita até cinco chamadas que falham — cada
   * uma com o custo de rede completo.
   *
   * Estado de instância, não persistido: o serviço é singleton, e é palpite, não
   * dado. Errar custa uma tentativa a mais.
   */
  private ultimaUnidadeComSucesso: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sei: SeiService,
    private readonly cache: CacheSeiService,
  ) {}

  // ==========================================================================
  // Listagem
  // ==========================================================================

  /** Documentos de um item da caixa de entrada. */
  async listarPorItemCaixaEntrada(itemId: number): Promise<DocumentoResposta[]> {
    const item = await this.prisma.caixaEntrada.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        idProcedimento: true,
        idUnidadeSei: true,
        agenteRegulado: true,
      },
    });

    if (!item) {
      throw new NotFoundException("Item não encontrado");
    }

    // Sem procedimento não há o que listar. Lista vazia, não 404: o item existe,
    // apenas nunca foi vinculado a um processo no SEI.
    if (!item.idProcedimento) {
      return [];
    }

    const idUnidade = await this.resolverUnidade(
      item.idUnidadeSei,
      item.agenteRegulado,
    );

    return this.listarPorProcedimento(item.idProcedimento, idUnidade);
  }

  /**
   * Documentos de um procedimento, montados a partir dos andamentos.
   *
   * O SEI não expõe "documentos do processo" como recurso: o que existe é o
   * histórico de andamentos, filtrado pelas tarefas de documento. Tarefa 2 é
   * geração de documento interno, 13 é juntada de externo e 33 é exclusão —
   * então a lista é o conjunto de gerados menos o de excluídos.
   */
  async listarPorProcedimento(
    idProcedimento: string,
    idUnidadeHint: string | null,
  ): Promise<DocumentoResposta[]> {
    if (!idProcedimento) {
      return [];
    }

    const chave = this.cache.chaveListaDocumentos(idProcedimento);
    const cacheado = await this.cache.obter<DocumentoResposta[]>(
      chave,
      TTL_LISTA,
    );
    if (cacheado) {
      return cacheado;
    }

    const idUnidade = idUnidadeHint ?? UNIDADES_CONSULTA[0];

    const encontrados = new Map<string, DocumentoResposta>();
    const excluidos = new Set<string>();

    for (let pagina = 0; pagina < MAXIMO_PAGINAS; pagina += 1) {
      let andamentos: AndamentoSei[];

      try {
        const resposta = await this.sei.listarAndamentos(
          idProcedimento,
          idUnidade,
          {
            tipoHistorico: "Z",
            tarefas: `${TAREFA_DOC_INTERNO},13,${TAREFA_DOC_EXCLUIDO}`,
            start: pagina,
            limit: ITENS_POR_PAGINA,
          },
        );

        const lista = (resposta as Record<string, unknown>).Andamentos;
        andamentos = Array.isArray(lista) ? (lista as AndamentoSei[]) : [];
      } catch (erro) {
        /*
          Falta de credencial PROPAGA; falha do SEI não.

          Os dois casos parecem iguais aqui e são diferentes: SEI instável passa,
          variável de ambiente faltando não. Se as duas fossem engolidas, esquecer
          SEI_CLIENT_ID em homologação apareceria como "este processo não tem
          documentos", e ninguém procuraria variável de ambiente a partir desse
          sintoma.

          Para a falha do SEI, interrompe sem propagar, como o Python fazia: a aba
          de documentos é uma entre várias na tela de análise, e derrubar a
          requisição apagaria a tela inteira. Devolver o que já se conseguiu
          montar mostra os documentos das páginas anteriores.
        */
        if (erro instanceof SeiNaoConfiguradoError) {
          throw new ServiceUnavailableException(erro.message);
        }

        this.logger.warn(
          `Falha ao listar andamentos (processo ${idProcedimento}, página ${pagina}): ${this.mensagem(erro)}`,
        );
        break;
      }

      if (andamentos.length === 0) {
        break;
      }

      for (const andamento of andamentos) {
        const numero = extrairNumeroDocumento(andamento);
        if (!numero) {
          continue;
        }

        const idTarefa = String(andamento.idTarefa ?? "");

        if (idTarefa === TAREFA_DOC_EXCLUIDO) {
          excluidos.add(numero);
          continue;
        }

        // Só o primeiro andamento de cada documento conta. Os andamentos vêm do
        // mais recente para o mais antigo, e um documento pode ter mais de um
        // (assinatura, por exemplo).
        if (!encontrados.has(numero)) {
          encontrados.set(numero, {
            numero,
            nome: extrairNomeDaDescricao(andamento.descricao, numero),
            tipo:
              idTarefa === TAREFA_DOC_INTERNO ? TIPO_INTERNO : TIPO_EXTERNO,
            data_geracao:
              typeof andamento.dataHora === "string" ? andamento.dataHora : null,
          });
        }
      }

      if (andamentos.length < ITENS_POR_PAGINA) {
        break;
      }

      if (pagina === MAXIMO_PAGINAS - 1) {
        this.logger.warn(
          `Processo ${idProcedimento}: teto de ${MAXIMO_PAGINAS} páginas de andamentos atingido; a lista pode estar incompleta.`,
        );
      }
    }

    for (const numero of excluidos) {
      encontrados.delete(numero);
    }

    // Os andamentos chegam do mais recente para o mais antigo; a aba mostra em
    // ordem cronológica.
    const documentos = [...encontrados.values()].reverse();

    if (documentos.length > 0) {
      await this.cache.gravar(chave, documentos);
    }

    return documentos;
  }

  // ==========================================================================
  // Conteúdo de um documento
  // ==========================================================================

  /**
   * Metadados e conteúdo de um documento, como o SEI os devolve.
   *
   * Guardado com `TTL_INFINITO`: documento registrado no SEI não muda de
   * conteúdo, então baixar duas vezes é só custo.
   */
  async obterConteudo(
    numeroDoc: string,
    tipoDoc: TipoDocumento | null,
    idUnidadeHint: string | null = null,
  ): Promise<ConteudoDocumentoResposta> {
    const chave = this.cache.chaveDocumento(numeroDoc);
    const cacheado =
      await this.cache.obter<ConteudoDocumentoResposta>(chave, TTL_INFINITO);
    if (cacheado) {
      return cacheado;
    }

    const { metadados, idUnidade } = await this.consultarComPalpite(
      numeroDoc,
      idUnidadeHint,
    );

    let conteudo: unknown;
    let tipoFinal: TipoDocumento;

    try {
      if (tipoDoc === TIPO_EXTERNO) {
        conteudo = await this.anexoComoPayload(numeroDoc, idUnidade);
        tipoFinal = TIPO_EXTERNO;
      } else if (tipoDoc === TIPO_INTERNO) {
        conteudo = await this.sei.baixarConteudo(numeroDoc, idUnidade);
        tipoFinal = TIPO_INTERNO;
      } else {
        // Tipo não informado: tenta interno e cai para anexo. A ordem importa
        // pouco em custo (uma chamada a mais no pior caso) e muito em acerto —
        // a maioria dos documentos de um processo é interna.
        try {
          conteudo = await this.sei.baixarConteudo(numeroDoc, idUnidade);
          tipoFinal = TIPO_INTERNO;
        } catch {
          conteudo = await this.anexoComoPayload(numeroDoc, idUnidade);
          tipoFinal = TIPO_EXTERNO;
        }
      }
    } catch (erro) {
      throw new BadGatewayException(
        `Erro ao baixar documento: ${this.mensagem(erro)}`,
      );
    }

    const resposta: ConteudoDocumentoResposta = {
      numero: numeroDoc,
      // Espaço no padrão daqui e sublinhado no de `obterBytes`: um vai para a
      // tela, o outro para nome de arquivo.
      nome: this.nomeDoDocumento(metadados, `Documento ${numeroDoc}`),
      tipo: tipoFinal,
      conteudo,
    };

    await this.cache.gravar(chave, resposta);

    return resposta;
  }

  // ==========================================================================
  // Download como arquivo
  // ==========================================================================

  /** Bytes de um documento, com nome de arquivo e `Content-Type` para servir. */
  async obterBytes(
    numeroDoc: string,
    tipoDoc: TipoDocumento | null,
    idUnidadeHint: string | null = null,
  ): Promise<{ bytes: Buffer; nomeArquivo: string; contentType: string }> {
    const { metadados, idUnidade } = await this.consultarComPalpite(
      numeroDoc,
      idUnidadeHint,
    );

    const nomeBase = nomeArquivoSeguro(
      this.nomeDoDocumento(metadados, `Documento_${numeroDoc}`),
    );

    try {
      if (tipoDoc === TIPO_EXTERNO) {
        return this.anexoComoArquivo(numeroDoc, idUnidade, nomeBase);
      }

      if (tipoDoc === TIPO_INTERNO) {
        return this.conteudoComoArquivo(numeroDoc, idUnidade, nomeBase);
      }

      try {
        return await this.conteudoComoArquivo(numeroDoc, idUnidade, nomeBase);
      } catch {
        return await this.anexoComoArquivo(numeroDoc, idUnidade, nomeBase);
      }
    } catch (erro) {
      throw new BadGatewayException(
        `Erro ao baixar documento: ${this.mensagem(erro)}`,
      );
    }
  }

  // ==========================================================================
  // Apoio
  // ==========================================================================

  /**
   * Unidade a usar para um item da caixa de entrada.
   *
   * Ordem: a unidade gravada no item (a varredura descobriu qual tinha acesso),
   * depois a configurada para o agente regulado, depois nada — e aí quem chama
   * cai na tentativa entre as seis.
   */
  private async resolverUnidade(
    idUnidadeSei: string | null,
    agenteRegulado: string | null,
  ): Promise<string | null> {
    if (idUnidadeSei) {
      return idUnidadeSei;
    }

    if (agenteRegulado) {
      const config = await this.prisma.configUnidade.findFirst({
        where: { agenteRegulado },
        select: { idUnidade: true },
      });
      if (config) {
        return config.idUnidade;
      }
    }

    return null;
  }

  /**
   * Consulta os metadados usando o palpite primeiro e a lista depois.
   *
   * Separado de `consultarEmUnidades` porque o palpite acerta quase sempre e
   * economiza até cinco chamadas perdidas.
   */
  private async consultarComPalpite(
    numeroDoc: string,
    idUnidadeHint: string | null,
  ): Promise<{ metadados: Record<string, unknown>; idUnidade: string }> {
    if (idUnidadeHint) {
      try {
        const metadados = await this.sei.consultarDocumento(
          numeroDoc,
          idUnidadeHint,
        );
        this.ultimaUnidadeComSucesso = idUnidadeHint;
        return {
          metadados: metadados as Record<string, unknown>,
          idUnidade: idUnidadeHint,
        };
      } catch (erro) {
        if (erro instanceof SeiNaoConfiguradoError) {
          throw new ServiceUnavailableException(erro.message);
        }
        // Qualquer outra falha: segue para a tentativa entre as unidades
        // conhecidas, porque o palpite pode simplesmente não ter acesso.
      }
    }

    return this.consultarEmUnidades(numeroDoc);
  }

  /**
   * Consulta os metadados tentando cada unidade, da mais provável para as
   * demais.
   *
   * Propaga 502 quando nenhuma responde, e não 404: o documento pode existir e
   * estar em unidade fora da lista. Dizer "não encontrado" mandaria o analista
   * procurar o documento errado, em vez de reportar falha de acesso.
   */
  private async consultarEmUnidades(
    numeroDoc: string,
  ): Promise<{ metadados: Record<string, unknown>; idUnidade: string }> {
    const ordem = [...UNIDADES_CONSULTA] as string[];

    if (
      this.ultimaUnidadeComSucesso &&
      ordem.includes(this.ultimaUnidadeComSucesso)
    ) {
      ordem.splice(ordem.indexOf(this.ultimaUnidadeComSucesso), 1);
      ordem.unshift(this.ultimaUnidadeComSucesso);
    }

    let ultimoErro: unknown = null;

    for (const idUnidade of ordem) {
      try {
        const metadados = await this.sei.consultarDocumento(
          numeroDoc,
          idUnidade,
        );
        this.ultimaUnidadeComSucesso = idUnidade;
        return {
          metadados: metadados as Record<string, unknown>,
          idUnidade,
        };
      } catch (erro) {
        // Sem credencial nenhuma unidade vai responder: insistir seis vezes só
        // atrasa a mensagem que diz qual variável preencher.
        if (erro instanceof SeiNaoConfiguradoError) {
          throw new ServiceUnavailableException(erro.message);
        }
        ultimoErro = erro;
      }
    }

    throw new BadGatewayException(
      `Erro ao consultar documento: ${this.mensagem(ultimoErro)}`,
    );
  }

  /**
   * Anexo no formato que o backend Python devolvia.
   *
   * O cliente do SEI entrega `Buffer` para não inflar a memória, mas este
   * endpoint devolve JSON e o frontend espera base64 no campo `conteudo`. A
   * conversão fica aqui, no único ponto que precisa dela.
   */
  private async anexoComoPayload(
    numeroDoc: string,
    idUnidade: string,
  ): Promise<Record<string, unknown>> {
    const { bytes, contentType } = await this.sei.baixarAnexo(
      numeroDoc,
      idUnidade,
    );

    return {
      conteudo: bytes.toString("base64"),
      content_type: contentType,
      tamanho: bytes.length,
    };
  }

  private async anexoComoArquivo(
    numeroDoc: string,
    idUnidade: string,
    nomeBase: string,
  ): Promise<{ bytes: Buffer; nomeArquivo: string; contentType: string }> {
    const { bytes, contentType } = await this.sei.baixarAnexo(
      numeroDoc,
      idUnidade,
    );
    const extensao = extensaoPorContentType(contentType);

    return {
      bytes,
      nomeArquivo: this.comExtensao(nomeBase, extensao),
      contentType,
    };
  }

  /**
   * Documento interno como arquivo HTML.
   *
   * O SEI devolve o conteúdo em base64 dentro de JSON; aqui volta a bytes para
   * ser servido como arquivo.
   */
  private async conteudoComoArquivo(
    numeroDoc: string,
    idUnidade: string,
    nomeBase: string,
  ): Promise<{ bytes: Buffer; nomeArquivo: string; contentType: string }> {
    const resposta = (await this.sei.baixarConteudo(
      numeroDoc,
      idUnidade,
    )) as Record<string, unknown>;

    const base64 = typeof resposta.conteudo === "string" ? resposta.conteudo : "";

    return {
      bytes: Buffer.from(base64, "base64"),
      nomeArquivo: this.comExtensao(nomeBase, ".html"),
      contentType: "text/html; charset=utf-8",
    };
  }

  /** Acrescenta a extensão, sem duplicar quando o nome já termina nela. */
  private comExtensao(nomeBase: string, extensao: string): string {
    return nomeBase.toLowerCase().endsWith(extensao)
      ? nomeBase
      : `${nomeBase}${extensao}`;
  }

  /**
   * Nome do documento a partir dos metadados.
   *
   * `nomeArvore` é o rótulo que o usuário vê na árvore do processo, e por isso
   * vem antes de `nome`.
   */
  private nomeDoDocumento(
    metadados: Record<string, unknown>,
    padrao: string,
  ): string {
    const nomeArvore = metadados.nomeArvore;
    if (typeof nomeArvore === "string" && nomeArvore.trim()) {
      return nomeArvore;
    }

    const nome = metadados.nome;
    if (typeof nome === "string" && nome.trim()) {
      return nome;
    }

    return padrao;
  }

  private mensagem(erro: unknown): string {
    return erro instanceof Error ? erro.message : String(erro);
  }
}
