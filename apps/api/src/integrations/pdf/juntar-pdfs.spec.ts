// Importa de "@jest/globals" em vez de usar as globais do Jest — ver a nota em
// app/anotacoes/anotacoes.service.spec.ts.
import { beforeAll, describe, expect, it } from "@jest/globals";
import { PDFDocument } from "pdf-lib";

import { juntarPdfs } from "./juntar-pdfs";

/** PDF de verdade, com o número de páginas pedido. */
async function pdfComPaginas(quantidade: number): Promise<Buffer> {
  const documento = await PDFDocument.create();
  for (let i = 0; i < quantidade; i += 1) {
    documento.addPage([595, 842]);
  }
  return Buffer.from(await documento.save());
}

describe("juntarPdfs", () => {
  let umaPagina: Buffer;
  let tresPaginas: Buffer;

  beforeAll(async () => {
    umaPagina = await pdfComPaginas(1);
    tresPaginas = await pdfComPaginas(3);
  });

  it("junta na ordem recebida e soma as páginas", async () => {
    const r = await juntarPdfs([
      { numero: "1", nome: "primeiro", bytes: umaPagina },
      { numero: "2", nome: "segundo", bytes: tresPaginas },
    ]);

    expect(r.paginas).toBe(4);
    expect(r.incluidos).toBe(2);
    expect(r.falhas).toEqual([]);
    expect(r.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  /*
    A regra central: um arquivo ruim não pode zerar o conjunto.

    Documento corrompido, truncado ou protegido existe no acervo do SEI e o
    servidor não tem como consertá-lo. Abortar tudo entregaria nada quando o que
    se quer é o conjunto probatório.
  */
  it("segue com os demais quando um PDF é inválido", async () => {
    const r = await juntarPdfs([
      { numero: "1", nome: "bom", bytes: umaPagina },
      { numero: "2", nome: "corrompido", bytes: Buffer.from("isto não é PDF") },
      { numero: "3", nome: "outro bom", bytes: tresPaginas },
    ]);

    expect(r.paginas).toBe(4);
    expect(r.incluidos).toBe(2);
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0]).toMatchObject({ numero: "2", nome: "corrompido" });
  });

  /*
    A falha precisa dizer QUAL documento e por quê: é isso que o usuário vê para
    saber o que anexar manualmente. Falha sem identificação não serve.
  */
  it("identifica o documento e o motivo na falha", async () => {
    const r = await juntarPdfs([
      { numero: "9988", nome: "laudo técnico", bytes: Buffer.from("xx") },
    ]);

    expect(r.falhas[0].numero).toBe("9988");
    expect(r.falhas[0].nome).toBe("laudo técnico");
    expect(r.falhas[0].motivo.length).toBeGreaterThan(0);
    // Recortado: a mensagem vai para a tela, e rastreamento de pilha de
    // biblioteca não ajuda quem confere o processo.
    expect(r.falhas[0].motivo.length).toBeLessThanOrEqual(200);
  });

  /*
    ESTA TRAVA EXISTE POR UM DEFEITO REAL DO pdf-lib.

    O `save()` insere uma página em branco quando o documento não tem nenhuma:
    `getPageCount()` sai de 0 para 1. Se a contagem fosse feita depois de salvar,
    um conjunto em que TODOS os documentos falharam reportaria uma página, e quem
    checasse "páginas > 0" concluiria que deu certo — subindo uma folha em branco
    ao SEI como conjunto probatório de processo sancionatório.
  */
  it("não conta a página em branco que o pdf-lib insere ao salvar", async () => {
    const r = await juntarPdfs([
      { numero: "1", nome: "a", bytes: Buffer.from("x") },
      { numero: "2", nome: "b", bytes: Buffer.from("y") },
    ]);

    expect(r.paginas).toBe(0);
    expect(r.incluidos).toBe(0);
    expect(r.falhas).toHaveLength(2);
  });

  it("lida com lista vazia", async () => {
    const r = await juntarPdfs([]);

    expect(r.paginas).toBe(0);
    expect(r.incluidos).toBe(0);
    expect(r.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
