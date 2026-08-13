/**
 * Formato de saída dos documentos — em **snake_case**, como o FastAPI devolvia.
 *
 * Consumidores: `apps/web/src/features/analise/AnaliseRelatorioPage.tsx` (aba
 * Documentos) e o `<a href download>` das duas telas de análise.
 */
export interface DocumentoResposta {
  numero: string;
  nome: string;
  /** `"interno"` (gerado no SEI) ou `"externo"` (arquivo anexado). */
  tipo: TipoDocumento;
  data_geracao: string | null;
}

export type TipoDocumento = "interno" | "externo";

export const TIPO_INTERNO: TipoDocumento = "interno";
export const TIPO_EXTERNO: TipoDocumento = "externo";

/**
 * Resposta de `/documentos/{numero}/conteudo`.
 *
 * `conteudo` é repassado como o SEI devolveu, sem normalizar. O frontend extrai
 * o base64 com `extrairBase64` (`features/processosAndamento/documento.ts`),
 * que procura o valor em vários nomes de campo conhecidos porque o formato do
 * SEI difere entre documento interno e anexo externo. Uniformizar aqui seria
 * melhor, mas mudaria o que a tela recebe e é decisão separada desta migração.
 */
export interface ConteudoDocumentoResposta {
  numero: string;
  nome: string;
  tipo: TipoDocumento;
  conteudo: unknown;
}

/**
 * Andamento do SEI, no recorte que a listagem de documentos usa.
 *
 * Tipagem frouxa de propósito: é resposta de API externa, e o SEI ora manda
 * `atributoAndamento`, ora `atributos`. Estreitar o tipo aqui só mudaria o erro
 * de lugar.
 */
export interface AndamentoSei {
  idTarefa?: unknown;
  descricao?: unknown;
  dataHora?: unknown;
  atributoAndamento?: unknown;
  atributos?: unknown;
  documento?: unknown;
}

/** Andamento de geração de documento interno. */
export const TAREFA_DOC_INTERNO = "2";

/** Andamento de juntada de documento externo. */
export const TAREFA_DOC_EXTERNO = "13";

/** Andamento de exclusão de documento — remove da lista. */
export const TAREFA_DOC_EXCLUIDO = "33";

/**
 * Número do documento a partir dos atributos do andamento.
 *
 * Duas fontes, na ordem em que o SEI as oferece: o atributo de nome
 * `"DOCUMENTO"` e, na falta dele, o `protocoloProcedimento` do primeiro item de
 * `documento[]`. Os dois existem porque o SEI não é consistente entre versões de
 * andamento, e sem o número o item não tem como ser aberto.
 */
export function extrairNumeroDocumento(andamento: AndamentoSei): string | null {
  const atributos = andamento.atributoAndamento ?? andamento.atributos ?? [];

  if (Array.isArray(atributos)) {
    for (const atributo of atributos) {
      if (!atributo || typeof atributo !== "object") {
        continue;
      }
      const registro = atributo as Record<string, unknown>;
      if (String(registro.nome ?? "").toUpperCase() === "DOCUMENTO") {
        const valor = String(registro.valor ?? "").trim();
        if (valor) {
          return valor;
        }
      }
    }
  }

  const documentos = andamento.documento;
  if (Array.isArray(documentos) && documentos.length > 0) {
    const primeiro = documentos[0] as Record<string, unknown> | null;
    const protocolo = String(primeiro?.protocoloProcedimento ?? "").trim();
    if (protocolo) {
      return protocolo;
    }
  }

  return null;
}

/**
 * Nome do documento a partir da descrição do andamento.
 *
 * A descrição vem como `"Gerado documento ... 12345678 (NOME DO TIPO), ..."`, e
 * o trecho entre parênteses é o nome que o usuário reconhece. Vale a extração
 * porque a alternativa é uma chamada de metadado por documento: numa aba com 40
 * documentos, isso troca uma requisição por quarenta.
 *
 * Sem parênteses, cai em `"Documento {numero}"` — pior de ler, mas identifica.
 */
export function extrairNomeDaDescricao(
  descricao: unknown,
  numero: string,
): string {
  const texto = typeof descricao === "string" ? descricao : "";
  const abre = texto.indexOf("(");
  const fecha = texto.indexOf(")", abre + 1);

  if (abre >= 0 && fecha > abre + 1) {
    const nome = texto.slice(abre + 1, fecha).trim();
    if (nome) {
      return nome;
    }
  }

  return `Documento ${numero}`;
}

/**
 * Resposta de `/processos-andamento/{id}/incluir-conjunto-probatorio`.
 *
 * `docs_falha` e `aviso` existem porque conjunto probatório incompleto que se
 * apresenta como completo é pior do que um erro: é peça de processo
 * sancionatório, e quem assina precisa saber o que ficou de fora.
 */
export interface RespostaConjuntoProbatorio {
  sucesso: true;
  id_documento: string | null;
  documento_formatado: string | null;
  link_acesso: string | null;
  tamanho_pdf: number;
  /** Documentos encontrados no processo de fiscalização. */
  total_docs: number;
  /** Quantos entraram no PDF. */
  docs_incluidos: number;
  docs_falha: { numero: string; nome: string; motivo: string }[];
  mensagem: string;
  aviso?: string;
}

/** Extensão de arquivo correspondente a um `Content-Type`. */
export function extensaoPorContentType(contentType: string): string {
  const tipo = contentType.toLowerCase().split(";")[0].trim();

  const mapa: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
    "application/msword": ".doc",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "text/html": ".html",
    "text/plain": ".txt",
  };

  return mapa[tipo] ?? ".bin";
}

/**
 * Nome de arquivo seguro para o cabeçalho `Content-Disposition`.
 *
 * Mantém apenas letras, dígitos, espaço, ponto, sublinhado e hífen. Não é
 * cosmético: o nome vem do SEI e vai para dentro de um cabeçalho HTTP entre
 * aspas — aspas, quebra de linha ou barra no nome permitiriam injetar cabeçalho
 * ou escapar do diretório na hora de salvar.
 */
export function nomeArquivoSeguro(nome: string): string {
  const limpo = nome
    .split("")
    .map((c) => (/[\p{L}\p{N} ._-]/u.test(c) ? c : "_"))
    .join("")
    .trim();

  return limpo || "documento";
}
