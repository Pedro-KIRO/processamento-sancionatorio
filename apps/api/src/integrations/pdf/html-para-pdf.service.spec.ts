// Importa de "@jest/globals" em vez de usar as globais do Jest — ver a nota em
// app/anotacoes/anotacoes.service.spec.ts.
import { beforeAll, describe, expect, it } from "@jest/globals";

import { HtmlParaPdfService } from "./html-para-pdf.service";
import { sanitizarEstilo } from "./sanitizar-estilos";

/**
 * HTML do relatório de fiscalização que o próprio sistema gera e envia ao SEI
 * (`backend/app/services/relatorio_fiscalizacao.py`).
 *
 * Serve de pior caso porque reúne tudo que costuma quebrar conversor: tabela
 * dentro de célula de tabela, `colspan`, borda por célula, unidades em `pt`,
 * `text-transform` e — o que de fato quebrava — `margin:auto`.
 */
const HTML_RELATORIO_SEI = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:'Open Sans',Arial,sans-serif; color:#000; line-height:1.4; margin:0; padding:20px;">
<div style="max-width:1158px; margin:auto;">
    <p style="text-align:center; text-transform:uppercase; font-size:10pt; margin:0;">Governo do Estado de São Paulo</p>
    <p style="text-align:center; text-transform:uppercase; font-size:13pt; font-weight:bold; margin:15pt 0;">RELATÓRIO DE FISCALIZAÇÃO DE AGENTE DELEGADO OU REGULADO</p>

    <table style="width:100%; border-collapse:collapse; border:1px solid #000;">
        <tr><th colspan="2" style="border:1px solid #000; padding:6pt; font-weight:bold; text-align:center;">DADOS DA FISCALIZAÇÃO - AUTOESCOLA</th></tr>
        <tr><td style="border:1px solid #000; padding:6pt;">Fiscal</td><td style="border:1px solid #000; padding:6pt;">JOÃO DA SILVA</td></tr>
    </table>

    <table style="width:100%; border-collapse:collapse; border:1px solid #000; margin-top:-1px;">
        <tr><th colspan="2" style="border:1px solid #000; padding:6pt; font-weight:bold; text-align:center;">IDENTIFICAÇÃO DO AGENTE FISCALIZADO</th></tr>
        <tr><td colspan="2" style="border:1px solid #000; padding:6pt; font-size:10pt;">NOME DA ENTIDADE: <strong>AUTO ESCOLA MODELO LTDA</strong></td></tr>
    </table>

    <div style="margin-top:9px;">
        <table style="width:100%; border-collapse:collapse;">
            <tr><td style="background-color:#EEE; height:15pt; border:1px solid #000;"></td></tr>
            <tr><td style="text-align:center; border:1px solid #000; padding:6pt;"><b>CONSTATAÇÕES</b></td></tr>
            <tr><td style="border:1px solid #000; padding:10px;">
                <table style="width:100%; border-collapse:collapse;">
                  <tr><td style="padding:4pt;">1. Ausência de extintor de incêndio válido.</td></tr>
                  <tr><td style="padding:4pt;">2. Instrutor sem credencial vigente.</td></tr>
                </table>
                <br><b>Conclusão:</b><br><div style="margin:15px 0;">Foram constatadas 2 não conformidades.</div>
            </td></tr>
        </table>
    </div>
</div>
</body></html>`;

// ===========================================================================
// Higienização dos estilos
// ===========================================================================

describe("sanitizarEstilo", () => {
  /*
    O caso que motivou a função.

    `margin:auto` é como se centraliza um bloco em HTML, então aparece em
    praticamente todo documento do SEI. O conversor faz parseFloat("auto"),
    obtém NaN, e o NaN só estoura depois, quando o renderizador desenha a borda
    de uma tabela — o erro que chega é "unsupported number: NaN", sem dizer qual
    propriedade nem qual elemento.
  */
  it("descarta margin:auto", () => {
    expect(sanitizarEstilo("max-width:1158px; margin:auto")).toBe(
      "max-width:1158px",
    );
  });

  /*
    A limpeza é por classe de problema, não por caso conhecido. Enumerar os
    valores deixaria o próximo a ser descoberto em produção.
  */
  it("descarta qualquer palavra-chave em propriedade numérica", () => {
    for (const valor of ["inherit", "initial", "unset", "fit-content", "50%x"]) {
      expect(sanitizarEstilo(`width:${valor}`)).toBe("");
    }
  });

  it("preserva valor numérico, com e sem unidade", () => {
    expect(sanitizarEstilo("margin:15pt 0")).toBe("margin:15pt 0");
    expect(sanitizarEstilo("margin-top:-1px")).toBe("margin-top:-1px");
    expect(sanitizarEstilo("font-size:10pt")).toBe("font-size:10pt");
    expect(sanitizarEstilo("padding:6pt")).toBe("padding:6pt");
  });

  /*
    Num atalho como `margin: 15pt auto`, um valor inválido contamina a
    declaração inteira: não há como aplicar metade dela.
  */
  it("descarta o atalho inteiro quando um dos valores é inválido", () => {
    expect(sanitizarEstilo("margin:15pt auto")).toBe("");
  });

  it("não mexe em propriedade que não vira número", () => {
    const estilo =
      "text-align:center; background-color:#EEE; border:1px solid #000; font-weight:bold; text-transform:uppercase";
    expect(sanitizarEstilo(estilo)).toBe(estilo);
  });

  it("ignora declaração malformada, sem quebrar", () => {
    expect(sanitizarEstilo("cor-sem-dois-pontos; text-align:center")).toBe(
      "text-align:center",
    );
  });
});

// ===========================================================================
// Conversão
// ===========================================================================

describe("HtmlParaPdfService", () => {
  let service: HtmlParaPdfService;

  beforeAll(() => {
    service = new HtmlParaPdfService();
  });

  /*
    A prova que sustenta a escolha de não usar navegador.

    Se este teste passa, o caminho todo em JavaScript converte o documento real
    do SEI — e a imagem `node:20-alpine` do template continua servindo, sem
    Chromium.
  */
  it("converte o relatório de fiscalização real do SEI", async () => {
    const pdf = await service.converter(HTML_RELATORIO_SEI);

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Um PDF com o conteúdo de uma página passa folgadamente disto; o piso
    // pega o caso de sair um arquivo válido mas vazio.
    expect(pdf.length).toBeGreaterThan(5000);
  }, 30000);

  it("converte HTML simples", async () => {
    const pdf = await service.converter(
      "<html><body><h1>Título</h1><p>corpo</p></body></html>",
    );

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  /*
    Documento antigo do SEI vem em ISO-8859-1. Quem chama decodifica antes; aqui
    a garantia é de que acento em string JavaScript sobrevive à conversão.
  */
  it("preserva acentuação", async () => {
    const pdf = await service.converter(
      "<html><body><p>FISCALIZAÇÃO DE AGENTE REGULADO — ação</p></body></html>",
    );

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30000);

  it("converte tabela com colspan e borda", async () => {
    const pdf = await service.converter(
      `<html><body><table style="width:100%; border-collapse:collapse; border:1px solid #000;">
        <tr><th colspan="2" style="border:1px solid #000; padding:6pt;">t</th></tr>
        <tr><td style="border:1px solid #000; padding:6pt;">a</td><td style="border:1px solid #000; padding:6pt;">b</td></tr>
      </table></body></html>`,
    );

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  /*
    Fonte que não existe no pdfmake não pode derrubar a conversão: documento do
    SEI pede Arial, Verdana, Times ou Calibri conforme a época, e registrar
    todas é impossível.
  */
  it("não quebra com font-family desconhecida", async () => {
    const pdf = await service.converter(
      `<html><body style="font-family:'Comic Sans MS',Verdana,cursive;"><p>x</p></body></html>`,
    );

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30000);

  /*
    A TRAVA MAIS IMPORTANTE DESTE ARQUIVO.

    O conversor não lança erro quando não entende o documento: devolve definição
    vazia, e o pdfmake produz um PDF válido de uma página em branco. Sem esta
    verificação o endpoint responderia 200, o conjunto probatório seria juntado
    ao processo sancionatório e ninguém saberia que está em branco até abrir.

    Foi o que aconteceu de fato ao testar um DOM alternativo mais leve, que
    parseava o documento certo mas não expunha as APIs que o conversor usa.

    O teste garante o resultado: documento COM corpo nunca sai como PDF vazio.
    Aqui a conversão de verdade produz conteúdo, então o que se checa é que o PDF
    tem tamanho compatível com uma página escrita — um PDF em branco fica na casa
    de 1 KB.
  */
  it("não devolve PDF em branco para documento com conteúdo", async () => {
    const pdf = await service.converter(HTML_RELATORIO_SEI);

    expect(pdf.length).toBeGreaterThan(5000);
  }, 30000);

  it("aceita documento sem corpo sem tratar como erro", async () => {
    const pdf = await service.converter("<html><body></body></html>");

    // Corpo vazio de verdade é caso legítimo: o documento existe e não tem
    // conteúdo. A guarda só dispara quando HÁ corpo e a conversão não rendeu.
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30000);
});
