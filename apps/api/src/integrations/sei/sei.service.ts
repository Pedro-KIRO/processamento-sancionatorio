import { createHash } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";

import { SeiHttpService } from "./sei-http.service";
import { SeiApiError } from "./sei-errors";

/** Resposta genérica do SEI: a forma varia por endpoint. */
export type RespostaSei = Record<string, unknown>;

/**
 * Cliente da API REST do SEI.
 *
 * Duas convenções valem para o arquivo inteiro:
 *
 * 1. **`podeRepetir` é decidido por método, não por chamador.** Consulta repete;
 *    escrita nunca. Ver o comentário de `SeiHttpService.executar` para o motivo —
 *    resumindo, escrita repetida pode duplicar processo ou documento no SEI.
 *
 * 2. **A unidade é sempre explícita.** O SEI só dá acesso ao processo pela
 *    unidade que o tem aberto, e passar a unidade errada devolve erro que parece
 *    "não encontrado". Nenhum método assume unidade padrão.
 */
@Injectable()
export class SeiService {
  private readonly logger = new Logger(SeiService.name);

  constructor(private readonly http: SeiHttpService) {}

  /**
   * Remove a máscara do número do processo ou documento.
   *
   * A API do SEI espera o número sem pontuação. O usuário copia do site COM
   * máscara, e mandar assim devolve "não encontrado" para um processo que
   * existe.
   */
  static limparNumero(numero: unknown): string {
    return String(numero ?? "").replace(/[.\-/\s]/g, "");
  }

  private limpar(numero: unknown): string {
    return SeiService.limparNumero(numero);
  }

  // ==========================================================================
  // Consultas de processo
  // ==========================================================================

  /** Processos na unidade. `tipo` "T" traz todos; "G" só os gerados por ela. */
  listarProcessos(
    idUnidade: string | number,
    opcoes: { limit?: number; start?: number; tipo?: string } = {},
  ): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      caminho: "/processos",
      idUnidade,
      query: {
        limit: opcoes.limit ?? 500,
        start: opcoes.start ?? 0,
        tipo: opcoes.tipo ?? "T",
      },
      podeRepetir: true,
    });
  }

  /** Tipos de procedimento disponíveis para a unidade. */
  listarTiposProcedimento(idUnidade: string | number): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      caminho: "/tipos-procedimento",
      idUnidade,
      api: "parametros",
      podeRepetir: true,
    });
  }

  /** Dados de um processo. */
  consultarProcesso(
    numero: unknown,
    idUnidade: string | number,
    ultimoAndamento = false,
  ): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      caminho: `/processos/${this.limpar(numero)}`,
      idUnidade,
      query: {
        // O SEI espera "S"/"N", não booleano.
        sinUltimoAndamento: ultimoAndamento ? "S" : "N",
      },
      podeRepetir: true,
    });
  }

  /**
   * Andamentos do processo, do mais recente para o mais antigo — é dessa ordem
   * que saem a data de criação (último item) e a data da última ação (primeiro).
   *
   * Serve a dois usos distintos, conforme os parâmetros: sem `tarefas` devolve o
   * histórico do processo; com `tarefas: "2,13,33"` devolve os andamentos de
   * documento, que é como se monta a lista de documentos.
   */
  listarAndamentos(
    numero: unknown,
    idUnidade: string | number,
    opcoes: {
      limit?: number;
      /** Índice da PÁGINA (0, 1, 2...), não deslocamento de itens. */
      start?: number;
      /** `"R"` só remessas, `"Z"` todos. */
      tipoHistorico?: string;
      /**
       * Filtro por tipo de andamento, separado por vírgula. `"2,13,33"` traz
       * geração de documento interno, de externo e exclusão — é assim que a
       * lista de documentos de um processo é montada, já que o SEI não expõe
       * "documentos do processo" como recurso próprio.
       */
      tarefas?: string;
      /** `"S"` faz o SEI incluir `atributoAndamento` em cada item. */
      retornaAtributos?: string;
    } = {},
  ): Promise<RespostaSei> {
    /*
      O processo vai em `protocoloProcedimento`, na QUERY, e o caminho é fixo.

      Não existe `/processos/{numero}/andamentos` no SEI: andamento é recurso de
      primeiro nível e o processo é filtro. Montar o número no caminho devolve
      404, que numa consulta de processo se lê como "processo não existe" — foi
      assim que este erro passou despercebido até alguém precisar da lista de
      documentos.

      Os defaults acompanham o backend Python: `tipoHistorico: "Z"` (todos os
      andamentos) e `retornaAtributos: "S"`, sem o qual o SEI omite
      `atributoAndamento` e o número do documento não vem em lugar nenhum.
    */
    return this.http.executar<RespostaSei>({
      caminho: "/andamentos/completo",
      idUnidade,
      query: {
        protocoloProcedimento: String(this.limpar(numero)),
        retornaAtributos: opcoes.retornaAtributos ?? "S",
        tipoHistorico: opcoes.tipoHistorico ?? "Z",
        limit: opcoes.limit,
        start: opcoes.start,
        tarefas: opcoes.tarefas,
      },
      podeRepetir: true,
    });
  }

  /** Séries (tipos de documento) disponíveis para a unidade. */
  listarSeries(idUnidade: string | number): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      caminho: "/series",
      idUnidade,
      api: "parametros",
      podeRepetir: true,
    });
  }

  /** Contato cadastrado no SEI para um CPF. */
  listarContato(cpf: string, idUnidade: string | number): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      caminho: "/contatos",
      idUnidade,
      query: { cpf: this.limpar(cpf) },
      podeRepetir: true,
    });
  }

  // ==========================================================================
  // Consultas de documento
  // ==========================================================================

  /**
   * Metadados de um documento.
   *
   * NÃO REPETE, mesmo sendo leitura. Motivo: quando a unidade informada não tem
   * acesso ao documento, o SEI responde 500 — que a classificação trata como
   * instabilidade. Repetir na mesma unidade não muda o resultado; o que resolve
   * é tentar outra unidade, e quem chama faz isso mais rápido do que as três
   * tentativas com espera exponencial.
   */
  consultarDocumento(
    numeroDoc: unknown,
    idUnidade: string | number,
  ): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      caminho: `/documentos/${this.limpar(numeroDoc)}`,
      idUnidade,
      api: "documentos",
      podeRepetir: false,
    });
  }

  /** Conteúdo (HTML) de um documento gerado no SEI. */
  baixarConteudo(
    numeroDoc: unknown,
    idUnidade: string | number,
  ): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      caminho: `/documentos/${this.limpar(numeroDoc)}/conteudo`,
      idUnidade,
      api: "documentos",
      // Mesmo motivo de consultarDocumento.
      podeRepetir: false,
    });
  }

  /**
   * Bytes de um documento externo (PDF anexado ao processo), com o tipo do
   * arquivo.
   *
   * Devolve `Buffer` em vez do base64 que o backend Python monta: quem consome
   * precisa dos bytes para servir o arquivo, e converter para texto e de volta
   * só gastaria memória — um PDF de 10 MB viraria 13 MB de base64.
   *
   * O `contentType` acompanha porque é a única fonte do formato do anexo: o
   * metadado do documento traz o nome na árvore, não a extensão.
   */
  baixarAnexo(
    numeroDoc: unknown,
    idUnidade: string | number,
  ): Promise<{ bytes: Buffer; contentType: string }> {
    return this.http.baixarBinarioComTipo({
      // "anexos", no plural — é o caminho publicado pelo SEI. No singular
      // responde 404, que quem chama lê como "documento sem anexo".
      caminho: `/documentos/${this.limpar(numeroDoc)}/anexos`,
      idUnidade,
      api: "documentos",
      podeRepetir: false,
    });
  }

  // ==========================================================================
  // Escrita: processo
  // ==========================================================================

  /**
   * Cria um processo no SEI.
   *
   * NÃO REPETE: um timeout pode significar processo já criado, e a segunda
   * tentativa criaria um duplicado que só se resolve manualmente.
   */
  criarProcesso(
    idUnidade: string | number,
    dados: {
      idTipoProcedimento: string | number;
      especificacao?: string;
      interessados?: unknown[];
      observacao?: string;
      nivelAcesso?: string;
    },
  ): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      metodo: "POST",
      caminho: "/processos",
      idUnidade,
      corpo: {
        idTipoProcedimento: String(dados.idTipoProcedimento),
        especificacao: dados.especificacao ?? "",
        interessados: dados.interessados ?? [],
        observacao: dados.observacao ?? "",
        // "P" = público. O padrão do SEI varia por unidade, então é explícito.
        nivelAcesso: dados.nivelAcesso ?? "P",
      },
      podeRepetir: false,
    });
  }

  /**
   * Recebe o processo na unidade.
   *
   * Necessário antes de incluir documento: o SEI só permite escrever em processo
   * que a unidade recebeu.
   */
  async receberProcesso(
    numero: unknown,
    idUnidade: string | number,
  ): Promise<void> {
    await this.http.executar<void>({
      metodo: "POST",
      caminho: `/processos/${this.limpar(numero)}/receber`,
      idUnidade,
      podeRepetir: false,
    });
  }

  /**
   * Registra prazo no processo.
   *
   * ATENÇÃO — VALOR SUSPEITO PRESERVADO: quando o prazo NÃO é em dias úteis, o
   * backend Python envia `sinDiasUteis: "N+"`, com um "+" que aparenta ser erro
   * de digitação (o esperado seria "N"). Mantido igual de propósito: não há como
   * verificar contra o SEI sem credencial, e se a API for tolerante a troca é
   * inócua, mas se ela validar estritamente o comportamento atual é o que está em
   * uso. Confirmar com o SEI antes de corrigir.
   */
  async definirPrazo(
    numero: unknown,
    idUnidade: string | number,
    dados: { dataPrazo: string; diasUteis?: boolean; motivo?: string },
  ): Promise<void> {
    await this.http.executar<void>({
      metodo: "POST",
      caminho: `/processos/${this.limpar(numero)}/prazo`,
      idUnidade,
      corpo: {
        dataPrazo: dados.dataPrazo,
        sinDiasUteis: dados.diasUteis ? "S" : "N+",
        motivo: dados.motivo ?? "",
      },
      podeRepetir: false,
    });
  }

  /** Exclui um processo. Só funciona enquanto não houver documento assinado. */
  async excluirProcesso(
    numero: unknown,
    idUnidade: string | number,
  ): Promise<void> {
    await this.http.executar<void>({
      metodo: "DELETE",
      caminho: `/processos/${this.limpar(numero)}`,
      idUnidade,
      podeRepetir: false,
    });
  }

  // ==========================================================================
  // Escrita: documento
  // ==========================================================================

  /**
   * Envia um arquivo para o SEI e devolve o `idArquivo`.
   *
   * O SEI exige o MD5 do conteúdo junto do base64 — é como ele confere que o
   * upload chegou íntegro.
   *
   * IMPORTANTE: o upload e a inclusão do documento têm de usar a MESMA unidade.
   * O arquivo enviado fica vinculado à unidade que o enviou, e incluir por outra
   * devolve erro que não menciona a unidade.
   */
  async enviarArquivo(
    idUnidade: string | number,
    nome: string,
    conteudo: Buffer,
  ): Promise<string> {
    const resposta = await this.http.executar<RespostaSei>({
      metodo: "POST",
      caminho: "/arquivos",
      idUnidade,
      api: "documentos",
      corpo: {
        nome,
        tamanho: String(conteudo.length),
        hash: createHash("md5").update(conteudo).digest("hex"),
        conteudo: conteudo.toString("base64"),
      },
      podeRepetir: false,
    });

    return this.extrairIdArquivo(resposta);
  }

  /**
   * Extrai o `idArquivo` da resposta do upload.
   *
   * O SEI é inconsistente aqui: às vezes devolve o campo `idArquivo`, às vezes
   * apenas uma mensagem com o id embutido ("Arquivo recebido. ID: 12345"). Sem o
   * segundo caminho, o upload parecia falhar em parte dos casos mesmo tendo
   * funcionado.
   */
  private extrairIdArquivo(resposta: RespostaSei): string {
    const direto = resposta.idArquivo;
    if (direto !== undefined && direto !== null && String(direto).trim()) {
      return String(direto).trim();
    }

    const mensagem = String(resposta.message ?? resposta.mensagem ?? "");
    const achado = /ID:\s*([\w-]+)/i.exec(mensagem);
    if (achado) {
      return achado[1];
    }

    throw new SeiApiError(
      "O SEI aceitou o arquivo mas não informou o identificador. " +
        `Resposta: ${JSON.stringify(resposta).slice(0, 300)}`,
    );
  }

  /**
   * Inclui documento GERADO (HTML) no processo.
   *
   * `documentoFormatado` é o número do documento criado, e é o que a aplicação
   * guarda para montar o link e para o bloco de assinatura.
   */
  incluirDocumento(
    numeroProcesso: unknown,
    idUnidade: string | number,
    dados: {
      idSerie: string | number;
      conteudoHtml: string;
      descricao?: string;
      nomeArvore?: string;
      nivelAcesso?: string;
    },
  ): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      metodo: "POST",
      caminho: `/processos/${this.limpar(numeroProcesso)}/documentos`,
      idUnidade,
      api: "documentos",
      corpo: {
        idSerie: String(dados.idSerie),
        // O SEI espera o HTML em base64.
        conteudo: Buffer.from(dados.conteudoHtml, "utf8").toString("base64"),
        descricao: dados.descricao ?? "",
        nomeArvore: dados.nomeArvore ?? "",
        nivelAcesso: dados.nivelAcesso ?? "P",
      },
      podeRepetir: false,
    });
  }

  /**
   * Inclui documento EXTERNO (arquivo já enviado) no processo.
   *
   * Exige `idArquivo` obtido em `enviarArquivo`, e a mesma unidade do upload.
   */
  incluirDocumentoExterno(
    numeroProcesso: unknown,
    idUnidade: string | number,
    dados: {
      idSerie: string | number;
      idArquivo: string;
      dataDocumento: string;
      descricao?: string;
      nomeArvore?: string;
      nivelAcesso?: string;
    },
  ): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      metodo: "POST",
      caminho: `/processos/${this.limpar(numeroProcesso)}/documentos`,
      idUnidade,
      api: "documentos",
      corpo: {
        idSerie: String(dados.idSerie),
        idArquivo: dados.idArquivo,
        dataDocumento: dados.dataDocumento,
        descricao: dados.descricao ?? "",
        nomeArvore: dados.nomeArvore ?? "",
        nivelAcesso: dados.nivelAcesso ?? "P",
      },
      podeRepetir: false,
    });
  }

  /** Coloca o documento num bloco de assinatura. */
  async incluirDocumentoEmBloco(
    idBloco: string | number,
    documentoFormatado: string,
    idUnidade: string | number,
  ): Promise<void> {
    await this.http.executar<void>({
      metodo: "POST",
      caminho: `/blocos/${idBloco}/documentos`,
      idUnidade,
      api: "parametros",
      corpo: { protocoloDocumento: this.limpar(documentoFormatado) },
      podeRepetir: false,
    });
  }

  /** Exclui um documento. Só funciona enquanto não estiver assinado. */
  async excluirDocumento(
    numeroDoc: unknown,
    idUnidade: string | number,
  ): Promise<void> {
    await this.http.executar<void>({
      metodo: "DELETE",
      caminho: `/documentos/${this.limpar(numeroDoc)}`,
      idUnidade,
      api: "documentos",
      podeRepetir: false,
    });
  }

  // ==========================================================================
  // Acesso externo
  // ==========================================================================

  /**
   * Disponibiliza acesso externo ao processo para o interessado.
   *
   * É o ato que efetiva a citação: a partir da visualização pelo interessado, o
   * prazo de defesa passa a correr. Por isso `email` e `cpf` importam — é por
   * eles que o SEI identifica quem recebeu.
   */
  disponibilizarAcessoExterno(
    numeroProcesso: unknown,
    idUnidade: string | number,
    dados: {
      email: string;
      cpf?: string;
      nome?: string;
      prazoDias?: number;
      senha?: string;
      motivo?: string;
    },
  ): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      metodo: "POST",
      caminho: `/processos/${this.limpar(numeroProcesso)}/disponibilizacoes-acesso-externo`,
      idUnidade,
      corpo: {
        email: dados.email,
        cpf: dados.cpf ? this.limpar(dados.cpf) : "",
        nome: dados.nome ?? "",
        prazo: dados.prazoDias !== undefined ? String(dados.prazoDias) : "",
        senha: dados.senha ?? "",
        motivo: dados.motivo ?? "",
      },
      podeRepetir: false,
    });
  }

  /**
   * Disponibilizações já feitas no processo.
   *
   * É aqui que se descobre se o interessado VISUALIZOU o acesso — o que decide
   * entre certidão de decurso e edital de citação quando o prazo vence sem
   * resposta.
   */
  listarDisponibilizacoesAcessoExterno(
    numeroProcesso: unknown,
    idUnidade: string | number,
  ): Promise<RespostaSei> {
    return this.http.executar<RespostaSei>({
      caminho: `/processos/${this.limpar(numeroProcesso)}/disponibilizacoes-acesso-externo`,
      idUnidade,
      podeRepetir: true,
    });
  }

  /** Cancela uma disponibilização de acesso externo. */
  async cancelarDisponibilizacaoAcessoExterno(
    numeroProcesso: unknown,
    idDisponibilizacao: string | number,
    idUnidade: string | number,
    motivo = "",
  ): Promise<void> {
    await this.http.executar<void>({
      metodo: "POST",
      caminho:
        `/processos/${this.limpar(numeroProcesso)}` +
        `/disponibilizacoes-acesso-externo/${idDisponibilizacao}/cancelamento`,
      idUnidade,
      corpo: { motivo },
      podeRepetir: false,
    });
  }
}
