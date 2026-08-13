import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";

/*
  `archiver` FIXADO EM 7, e não na 8.

  A 8 é publicada apenas como ESM. Ela até funciona sob `require` no
  `node:20-alpine` de hoje, porque o Node 20.20 aceita a mistura — mas isso
  transforma "Node 20" numa exigência de patch mínimo não declarada em lugar
  nenhum, e o Jest, que é CommonJS, não carrega o pacote de jeito nenhum: os
  testes destes três endpoints deixariam de existir.

  A 7 é CommonJS, tem a mesma função e mantém a API `archiver("zip", opcoes)`,
  que é a que a documentação mostra.
*/
import archiver from "archiver";

import { HtmlParaPdfService } from "../../integrations/pdf/html-para-pdf.service";
import {
  FalhaAoJuntar,
  juntarPdfs,
  PdfParaJuntar,
  ResultadoJuncao,
} from "../../integrations/pdf/juntar-pdfs";
import {
  CacheSeiService,
  TTL_INFINITO,
  TTL_LISTA,
} from "../../integrations/sei/cache-sei.service";
import { SeiNaoConfiguradoError } from "../../integrations/sei/sei-errors";
import { SeiService } from "../../integrations/sei/sei.service";
import { chaveDoDia } from "../../shared/datas";
import { PrismaService } from "../../shared/prisma.service";
import {
  AndamentoSei,
  ConteudoDocumentoResposta,
  DocumentoResposta,
  RespostaConjuntoProbatorio,
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
 * Unidade usada no conjunto probatório quando o item não tem uma gravada.
 *
 * Mesmo valor do backend Python. É a unidade que na prática abriga os processos
 * sancionatórios instaurados.
 */
const UNIDADE_PADRAO_CONJUNTO = "110053117";

/** Série do SEI para "Anexo", que é como o conjunto probatório é juntado. */
const SERIE_ANEXO = "1917";

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
    private readonly html: HtmlParaPdfService,
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
  // Arquivo composto: ZIP e PDF unificado
  // ==========================================================================

  /** ZIP dos documentos de um item da caixa de entrada. */
  async gerarZipDoItemCaixaEntrada(
    itemId: number,
  ): Promise<{ zip: Buffer; nome: string }> {
    const item = await this.prisma.caixaEntrada.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        numeroSei: true,
        idProcedimento: true,
        idUnidadeSei: true,
        agenteRegulado: true,
      },
    });

    if (!item) {
      throw new NotFoundException("Item não encontrado");
    }
    if (!item.idProcedimento) {
      throw new NotFoundException("Nenhum documento disponível");
    }

    const idUnidade = await this.resolverUnidade(
      item.idUnidadeSei,
      item.agenteRegulado,
    );
    const nome = `documentos_${item.numeroSei ?? itemId}.zip`;

    return {
      zip: await this.gerarZip(item.idProcedimento, idUnidade, nome),
      nome,
    };
  }

  /**
   * ZIP dos documentos de um processo em andamento.
   *
   * Usa o procedimento do processo SANCIONATÓRIO quando existe, e cai no da
   * fiscalização enquanto não houve instauração — é o mesmo critério do backend
   * Python (`_id_procedimento_documento`). Trocar a ordem mostraria os documentos
   * do processo errado numa tela cujo assunto é o processo instaurado.
   */
  async gerarZipDoProcesso(
    itemId: number,
  ): Promise<{ zip: Buffer; nome: string }> {
    const item = await this.prisma.caixaEntrada.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        numeroSei: true,
        numeroProcessoSei: true,
        idProcedimento: true,
        idProcedimentoProcesso: true,
        idUnidadeSei: true,
        agenteRegulado: true,
      },
    });

    if (!item) {
      throw new NotFoundException("Item não encontrado");
    }

    const idProcedimento = item.idProcedimentoProcesso ?? item.idProcedimento;
    if (!idProcedimento) {
      throw new NotFoundException("Nenhum documento disponível");
    }

    const idUnidade = await this.resolverUnidade(
      item.idUnidadeSei,
      item.agenteRegulado,
    );
    const numero = item.numeroProcessoSei ?? item.numeroSei ?? String(itemId);
    const nome = `documentos_${numero}.zip`;

    return { zip: await this.gerarZip(idProcedimento, idUnidade, nome), nome };
  }

  /**
   * Todos os documentos de um processo num ZIP.
   *
   * Documento que não baixa entra como um `.txt` com o motivo, em vez de
   * simplesmente faltar. Um ZIP com 12 dos 15 documentos e nenhuma explicação
   * parece completo, e quem confere o processo não tem como notar a ausência.
   */
  async gerarZip(
    idProcedimento: string,
    idUnidadeHint: string | null,
    nomeZip: string,
  ): Promise<Buffer> {
    const documentos = await this.listarPorProcedimento(
      idProcedimento,
      idUnidadeHint,
    );

    if (documentos.length === 0) {
      throw new NotFoundException("Nenhum documento encontrado");
    }

    const arquivo = archiver("zip", { zlib: { level: 9 } });
    const pedacos: Buffer[] = [];
    arquivo.on("data", (p: Buffer) => pedacos.push(p));

    const finalizado = new Promise<void>((cumprir, recusar) => {
      arquivo.on("end", () => cumprir());
      arquivo.on("error", recusar);
    });

    const usados = new Map<string, number>();

    for (const documento of documentos) {
      try {
        const { bytes, nomeArquivo } = await this.obterBytes(
          documento.numero,
          documento.tipo,
          idUnidadeHint,
        );
        arquivo.append(bytes, { name: this.semRepetir(nomeArquivo, usados) });
      } catch (erro) {
        this.logger.warn(
          `Documento ${documento.numero} fora do ZIP: ${this.mensagem(erro)}`,
        );
        arquivo.append(
          `Não foi possível baixar este documento.\n\nNúmero: ${documento.numero}\nNome: ${documento.nome}\nMotivo: ${this.mensagem(erro)}\n`,
          { name: `ERRO_${documento.numero}.txt` },
        );
      }
    }

    await arquivo.finalize();
    await finalizado;

    this.logger.log(
      `ZIP ${nomeArquivoSeguro(nomeZip)} montado com ${documentos.length} documentos.`,
    );

    return Buffer.concat(pedacos);
  }

  /**
   * Documentos do processo concatenados num único PDF.
   *
   * Os internos são HTML e passam pela conversão sem navegador; os externos já
   * são binários e entram direto quando são PDF. Formato que não é PDF nem HTML
   * (planilha, por exemplo) não tem como ser concatenado e é reportado.
   */
  async gerarPdfUnificado(
    idProcedimento: string,
    idUnidade: string,
  ): Promise<ResultadoJuncao> {
    const documentos = await this.listarPorProcedimento(
      idProcedimento,
      idUnidade,
    );

    if (documentos.length === 0) {
      throw new NotFoundException("Nenhum documento encontrado");
    }

    const paraJuntar: PdfParaJuntar[] = [];
    const falhasAntes: FalhaAoJuntar[] = [];

    for (const documento of documentos) {
      try {
        const { bytes, contentType } = await this.obterBytes(
          documento.numero,
          documento.tipo,
          idUnidade,
        );

        if (this.ehPdf(bytes, contentType)) {
          paraJuntar.push({
            numero: documento.numero,
            nome: documento.nome,
            bytes,
          });
          continue;
        }

        if (this.ehHtml(bytes, contentType)) {
          const convertido = await this.html.converter(
            this.comoTexto(bytes),
          );
          paraJuntar.push({
            numero: documento.numero,
            nome: documento.nome,
            bytes: convertido,
          });
          continue;
        }

        falhasAntes.push({
          numero: documento.numero,
          nome: documento.nome,
          motivo: `Formato não concatenável em PDF (${contentType})`,
        });
      } catch (erro) {
        this.logger.warn(
          `Documento ${documento.numero} fora do PDF: ${this.mensagem(erro)}`,
        );
        falhasAntes.push({
          numero: documento.numero,
          nome: documento.nome,
          motivo: this.mensagem(erro).slice(0, 200),
        });
      }
    }

    const juncao = await juntarPdfs(paraJuntar);
    const falhas = [...falhasAntes, ...juncao.falhas];

    /*
      A condição é `incluidos`, não `paginas`.

      Nenhum documento incluído é o fato inequívoco. Contagem de página não serve
      de porteiro aqui porque o pdf-lib acrescenta uma folha em branco ao salvar
      documento vazio — checar "páginas > 0" daria certo para um conjunto onde
      nada entrou.
    */
    if (juncao.incluidos === 0) {
      const detalhe = falhas
        .slice(0, 5)
        .map((f) => `${f.numero} (${f.motivo})`)
        .join("; ");
      throw new NotFoundException(
        `Nenhum documento pôde ser convertido para PDF. ${falhas.length} falharam: ${detalhe}`,
      );
    }

    return { ...juncao, falhas };
  }

  /**
   * Gera o conjunto probatório e o junta ao processo instaurado.
   *
   * Reúne os documentos do processo de FISCALIZAÇÃO num PDF único e o inclui como
   * documento externo no processo SANCIONATÓRIO — são dois processos distintos no
   * SEI, e é por isso que o item precisa ter os dois identificadores.
   *
   * O upload e a inclusão usam a MESMA unidade, porque o SEI valida isso e recusa
   * o vínculo se divergirem.
   */
  async incluirConjuntoProbatorio(
    itemId: number,
  ): Promise<RespostaConjuntoProbatorio> {
    const item = await this.prisma.caixaEntrada.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        numeroSei: true,
        idProcedimento: true,
        idProcedimentoProcesso: true,
        idUnidadeSei: true,
      },
    });

    if (!item) {
      throw new NotFoundException("Item não encontrado");
    }
    if (!item.idProcedimento) {
      throw new BadRequestException(
        "Processo de fiscalização sem id_procedimento",
      );
    }
    if (!item.idProcedimentoProcesso) {
      throw new BadRequestException(
        "Processo ainda não foi instaurado (sem id_procedimento_processo)",
      );
    }

    const idUnidade = item.idUnidadeSei ?? UNIDADE_PADRAO_CONJUNTO;

    const pdf = await this.gerarPdfUnificado(item.idProcedimento, idUnidade);

    const nomeArquivo = `Conjunto_probatorio_${item.numeroSei ?? itemId}.pdf`;

    let idArquivo: string;
    try {
      idArquivo = await this.sei.enviarArquivo(
        idUnidade,
        nomeArquivo,
        pdf.bytes,
      );
    } catch (erro) {
      throw new BadGatewayException(
        `Erro ao fazer upload do arquivo: ${this.mensagem(erro)}`,
      );
    }

    let resultado: Record<string, unknown>;
    try {
      resultado = (await this.sei.incluirDocumentoExterno(
        item.idProcedimentoProcesso,
        idUnidade,
        {
          idSerie: SERIE_ANEXO,
          idArquivo,
          dataDocumento: chaveDoDia(new Date()),
          nomeArvore: "Conjunto probatório",
          descricao: `Documentos do processo de fiscalização ${item.numeroSei ?? ""}`.trim(),
        },
      )) as Record<string, unknown>;
    } catch (erro) {
      throw new BadGatewayException(
        `Erro ao incluir documento externo: ${this.mensagem(erro)}`,
      );
    }

    // A lista de documentos do processo mudou. Sem invalidar, o usuário não veria
    // o documento que acabou de gerar e tentaria de novo, duplicando no SEI.
    await this.cache.invalidarProcesso(item.idProcedimentoProcesso);

    const kb = Math.floor(pdf.bytes.length / 1024);
    const total = pdf.incluidos + pdf.falhas.length;

    const resposta: RespostaConjuntoProbatorio = {
      sucesso: true,
      id_documento: this.texto(resultado.idDocumento),
      documento_formatado: this.texto(resultado.documentoFormatado),
      link_acesso: this.texto(resultado.linkAcesso),
      tamanho_pdf: pdf.bytes.length,
      total_docs: total,
      docs_incluidos: pdf.incluidos,
      docs_falha: pdf.falhas,
      mensagem: `Conjunto probatório incluído com sucesso (${pdf.incluidos}/${total} documentos, ${kb} KB).`,
    };

    /*
      O aviso não é enfeite.

      Conjunto probatório incompleto que se apresenta como completo é pior do que
      um erro: quem assina não tem como saber o que ficou de fora, e é peça de
      processo sancionatório.
    */
    if (pdf.falhas.length > 0) {
      const nomes = pdf.falhas
        .slice(0, 5)
        .map((f) => f.numero)
        .join(", ");
      resposta.aviso =
        `${pdf.falhas.length} documento(s) não puderam ser incluídos no PDF: ${nomes}. ` +
        "Esses documentos precisam ser anexados manualmente se necessário.";
    }

    return resposta;
  }

  // ==========================================================================
  // Apoio
  // ==========================================================================

  private texto(valor: unknown): string | null {
    return typeof valor === "string" && valor ? valor : null;
  }

  /** `application/pdf` no cabeçalho, ou a assinatura `%PDF` nos bytes. */
  private ehPdf(bytes: Buffer, contentType: string): boolean {
    return (
      contentType.toLowerCase().includes("pdf") ||
      bytes.subarray(0, 4).toString("latin1") === "%PDF"
    );
  }

  /**
   * HTML pelo cabeçalho ou pelo início do conteúdo.
   *
   * A checagem dos bytes existe porque documento interno do SEI às vezes chega
   * com `application/octet-stream`: confiar só no cabeçalho classificaria como
   * formato desconhecido e deixaria de fora justamente o corpo do processo.
   */
  private ehHtml(bytes: Buffer, contentType: string): boolean {
    if (contentType.toLowerCase().includes("html")) {
      return true;
    }
    const inicio = bytes.subarray(0, 200).toString("latin1").toLowerCase();
    return inicio.includes("<html") || inicio.includes("<!doctype html");
  }

  /**
   * Bytes como texto, respeitando o charset declarado.
   *
   * O SEI serve documento antigo em ISO-8859-1. Ler tudo como UTF-8 trocaria
   * cada acento por caractere de substituição, e o PDF sairia com "FISCALIZA��O".
   */
  private comoTexto(bytes: Buffer): string {
    const amostra = bytes.subarray(0, 1024).toString("latin1");

    /*
      As aspas são opcionais no padrão porque o SEI escreve das duas formas:
      `charset="iso-8859-1"` no `<meta>` e `charset=iso-8859-1` no cabeçalho.
      Exigir a forma sem aspas — que é a intuitiva de escrever — faria a detecção
      falhar justamente no caso mais comum, e todo acento sairia como caractere de
      substituição no PDF.
    */
    const latino = /charset\s*=\s*["']?\s*(iso-8859-1|latin1)/i.test(amostra);

    return bytes.toString(latino ? "latin1" : "utf8");
  }

  /** Evita nome repetido dentro do ZIP, que sobrescreveria o anterior. */
  private semRepetir(nome: string, usados: Map<string, number>): string {
    const vezes = usados.get(nome);

    if (vezes === undefined) {
      usados.set(nome, 0);
      return nome;
    }

    const proximo = vezes + 1;
    usados.set(nome, proximo);

    const ponto = nome.lastIndexOf(".");
    return ponto > 0
      ? `${nome.slice(0, ponto)}_${proximo}${nome.slice(ponto)}`
      : `${nome}_${proximo}`;
  }

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
