import { dirname, join, resolve } from "node:path";

import { Injectable, Logger } from "@nestjs/common";
import htmlParaPdfmake from "html-to-pdfmake";
/*
  `jsdom` FIXADO EM 26, e não `linkedom` nem a última versão do jsdom.

  O `linkedom` é mais leve e parece equivalente — parseia o documento
  corretamente. Só que o `html-to-pdfmake` usa APIs de DOM que ele não implementa
  e, em vez de falhar, devolve definição VAZIA: sai um PDF válido de uma página em
  branco, com sucesso reportado. Num conjunto probatório de processo
  sancionatório, esse é o pior desfecho possível — pior que um erro, porque nada
  avisa.

  A versão está travada em 26 porque a 30 depende de pacote publicado apenas como
  ESM, que o Jest não carrega. Vale dizer que ele FUNCIONA em `node:20-alpine`
  (verificado): o impedimento é só de teste, mas ficar sem teste automatizado de
  conversão é justamente o que deixaria passar o caso do parágrafo anterior.
*/
import { JSDOM } from "jsdom";

import { sanitizarDocumento } from "./sanitizar-estilos";

/**
 * Diretório das fontes que o pdfmake distribui.
 *
 * Resolvido pelo `package.json` do pacote, e não por caminho relativo, porque em
 * produção o processo roda de `dist/` e o `node_modules` fica um nível acima — um
 * caminho relativo funcionaria em desenvolvimento e falharia no contêiner.
 */
const DIRETORIO_FONTES = join(
  dirname(require.resolve("pdfmake/package.json")),
  "fonts",
  "Roboto",
);

/**
 * Converte HTML em PDF sem navegador.
 *
 * POR QUE SEM NAVEGADOR
 *
 * A resposta usual em Node para HTML→PDF é o Puppeteer, que embute o Chromium. O
 * Dockerfile do template usa `node:20-alpine`, e o Chromium do Puppeteer é
 * compilado para glibc enquanto o Alpine usa musl: adotá-lo exigiria trocar a
 * imagem base por Debian ou instalar o Chromium do Alpine, mais umas 300 MB. O
 * Dockerfile é arquivo do template, então cada atualização passaria a dar
 * conflito nele.
 *
 * O caminho aqui é todo em JavaScript — `jsdom` monta o DOM, `html-to-pdfmake`
 * traduz para a definição do pdfmake e o pdfmake desenha. Nenhum dos pacotes tem
 * build nativo, então roda no Alpine sem tocar a imagem.
 *
 * O QUE SE PERDE
 *
 * Fidelidade. Isto é um renderizador de subconjunto: estrutura, tabela, negrito,
 * itálico, lista e alinhamento passam; CSS de layout moderno não. Vale registrar
 * que o `xhtml2pdf` do backend Python tem a mesma natureza e as mesmas
 * limitações — não se está trocando renderização completa por parcial, e sim
 * mantendo o mesmo patamar em outra linguagem.
 *
 * Por isso quem chama trata falha POR DOCUMENTO e segue com os demais, em vez de
 * abortar o conjunto.
 */
@Injectable()
export class HtmlParaPdfService {
  private readonly logger = new Logger(HtmlParaPdfService.name);
  private pdfmake: PdfmakeInstancia | null = null;

  async converter(html: string): Promise<Buffer> {
    const pdfmake = this.instancia();

    const dom = new JSDOM(html);

    // Retira os valores CSS que não viram número antes de o conversor tentar.
    sanitizarDocumento(dom.window.document);

    const corpo = dom.window.document.body.innerHTML;

    const definicao = htmlParaPdfmake(corpo, {
      window: dom.window as unknown as Window,
      removeExtraBlanks: true,
      /*
        Descarta a fonte declarada no HTML.

        Documento do SEI pede a fonte que o servidor usava na época — Arial,
        Verdana, Times, Calibri. O pdfmake aborta ao encontrar família que não
        foi registrada, e registrar todas é impossível. Descartar faz tudo cair
        na fonte padrão: muda a aparência, não o conteúdo.
      */
      ignoreStyles: ["font-family"],
    });

    /*
      RECUSA DEFINIÇÃO VAZIA VINDA DE HTML COM CONTEÚDO.

      Esta é a guarda mais importante do serviço. O conversor não lança erro
      quando não entende o documento: devolve uma definição vazia, e o pdfmake
      produz de bom grado um PDF válido de uma página em branco. O endpoint
      responderia 200, o conjunto probatório seria juntado ao processo e ninguém
      saberia que está em branco até abrir.

      Foi exatamente o que aconteceu ao trocar o jsdom por uma alternativa mais
      leve. Falhar aqui transforma um documento vazio silencioso em erro visível.
    */
    if (this.definicaoVazia(definicao) && corpo.trim().length > 0) {
      throw new Error(
        "A conversão não produziu conteúdo, embora o documento tenha corpo. " +
          "O PDF sairia em branco, então a operação foi interrompida.",
      );
    }

    const documento = pdfmake.createPdf({
      content: definicao,
      defaultStyle: { font: "Roboto", fontSize: 9 },
      pageSize: "A4",
      pageMargins: [40, 40, 40, 40],
    });

    return documento.getBuffer();
  }

  /**
   * A definição não tem nada que renderize.
   *
   * O conversor devolve array; vazio significa que nada foi entendido. Um array
   * com elementos, mas todos sem texto e sem tabela, dá no mesmo — daí a
   * checagem pelo conteúdo serializado, e não só pelo tamanho.
   */
  private definicaoVazia(definicao: unknown): boolean {
    if (!Array.isArray(definicao)) {
      return !definicao;
    }
    if (definicao.length === 0) {
      return true;
    }

    const serializada = JSON.stringify(definicao);
    return (
      !serializada.includes('"text"') && !serializada.includes('"table"')
    );
  }

  /**
   * Instância do pdfmake, criada uma vez.
   *
   * A configuração é global no pacote (`addFonts`, políticas de acesso), então
   * repeti-la por chamada só gastaria tempo.
   */
  private instancia(): PdfmakeInstancia {
    if (this.pdfmake) {
      return this.pdfmake;
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfmake = require("pdfmake") as PdfmakeInstancia;

    /*
      AS DUAS POLÍTICAS ABAIXO SÃO DE SEGURANÇA.

      Sem elas o pdfmake apenas avisa e segue: busca recurso externo referenciado
      no documento e lê arquivo do disco. O HTML aqui vem do SEI, ou seja, é
      conteúdo que este código não escreveu. Uma tag de imagem apontando para um
      endereço da rede interna viraria requisição feita pelo servidor, com o
      alcance que o servidor tem e o cliente não; apontando para um caminho local
      viraria leitura de arquivo da máquina, embutida no PDF que o usuário baixa.

      Nada externo é buscado, e do disco só as fontes do próprio pdfmake.
    */
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((caminho: string) =>
      resolve(caminho).startsWith(DIRETORIO_FONTES),
    );

    pdfmake.addFonts({
      Roboto: {
        normal: join(DIRETORIO_FONTES, "Roboto-Regular.ttf"),
        bold: join(DIRETORIO_FONTES, "Roboto-Medium.ttf"),
        italics: join(DIRETORIO_FONTES, "Roboto-Italic.ttf"),
        bolditalics: join(DIRETORIO_FONTES, "Roboto-MediumItalic.ttf"),
      },
    });

    this.logger.log(
      `Conversão HTML→PDF pronta (sem navegador). Fontes em ${DIRETORIO_FONTES}.`,
    );

    this.pdfmake = pdfmake;
    return pdfmake;
  }
}

/**
 * Recorte da API do pdfmake usada aqui.
 *
 * O pacote não publica tipos, e em 0.3.x o `require("pdfmake")` devolve uma
 * INSTÂNCIA, não uma classe — o `PdfPrinter` de `pdfmake/js/Printer` é interno e
 * exige um `urlResolver` que só o entry principal monta.
 */
interface PdfmakeInstancia {
  addFonts(fontes: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(politica: () => boolean): void;
  setLocalAccessPolicy(politica: (caminho: string) => boolean): void;
  createPdf(definicao: unknown): { getBuffer(): Promise<Buffer> };
}
