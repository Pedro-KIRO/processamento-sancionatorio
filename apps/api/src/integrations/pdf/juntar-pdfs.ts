import { PDFDocument } from "pdf-lib";

/** Um PDF a entrar no documento final, com o que identificá-lo se falhar. */
export interface PdfParaJuntar {
  numero: string;
  nome: string;
  bytes: Buffer;
}

/** Documento que não pôde entrar, com o motivo — vai para a tela. */
export interface FalhaAoJuntar {
  numero: string;
  nome: string;
  motivo: string;
}

export interface ResultadoJuncao {
  bytes: Buffer;
  paginas: number;
  incluidos: number;
  falhas: FalhaAoJuntar[];
}

/**
 * Junta vários PDFs em um só, na ordem recebida.
 *
 * FALHA POR DOCUMENTO, NÃO POR CONJUNTO
 *
 * Um PDF corrompido, protegido por senha ou truncado derruba apenas a própria
 * inclusão: o motivo vai para `falhas` e o restante continua. Abortar tudo por
 * causa de um documento entregaria nada quando o que se quer é o conjunto
 * probatório — e o servidor não tem como consertar o arquivo que o SEI guardou.
 *
 * Cabe a quem chama mostrar `falhas` ao usuário. Um conjunto probatório
 * incompleto que se apresenta como completo é pior do que um erro: quem assina
 * não tem como saber o que ficou de fora.
 */
export async function juntarPdfs(
  documentos: PdfParaJuntar[],
): Promise<ResultadoJuncao> {
  const destino = await PDFDocument.create();
  const falhas: FalhaAoJuntar[] = [];
  let incluidos = 0;

  for (const documento of documentos) {
    try {
      const origem = await PDFDocument.load(documento.bytes, {
        // PDF gerado por ferramenta antiga costuma ter a tabela de referências
        // fora do padrão. Sem isto, arquivo que qualquer leitor abre seria
        // recusado aqui.
        ignoreEncryption: true,
      });

      const paginas = await destino.copyPages(origem, origem.getPageIndices());
      for (const pagina of paginas) {
        destino.addPage(pagina);
      }

      incluidos += 1;
    } catch (erro) {
      falhas.push({
        numero: documento.numero,
        nome: documento.nome,
        // Recorta a mensagem: ela vai para a tela, e rastreamento de pilha de
        // biblioteca não ajuda quem está conferindo o processo.
        motivo: (erro instanceof Error ? erro.message : String(erro)).slice(
          0,
          200,
        ),
      });
    }
  }

  /*
    Conta as páginas ANTES de salvar.

    O `save()` do pdf-lib INSERE uma página em branco quando o documento não tem
    nenhuma: `getPageCount()` sai de 0 para 1. Contar depois faria um conjunto em
    que todos os documentos falharam parecer ter conteúdo, e quem checasse
    "páginas > 0" concluiria que deu certo — subindo uma folha em branco ao SEI
    como conjunto probatório.
  */
  const paginas = destino.getPageCount();

  return {
    bytes: Buffer.from(await destino.save()),
    paginas,
    incluidos,
    falhas,
  };
}
