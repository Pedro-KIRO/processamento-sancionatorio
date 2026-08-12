import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { chaveDoDia } from "../../shared/datas";
import { PrismaService } from "../../shared/prisma.service";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PerfisService } from "../perfis/perfis.service";
import {
  CLASSIFICACOES,
  ItemDetalhe,
  ItemResumo,
  MIMES_PDF,
  TAMANHO_MAXIMO_ARQUIVO,
  VersaoResposta,
} from "./dto/biblioteca.dto";

/** Campos escalares de um item, SEM texto e SEM os bytes do PDF. */
const CAMPOS_RESUMO = {
  id: true,
  classificacao: true,
  titulo: true,
  tema: true,
  dataReferencia: true,
  link: true,
  arquivoNome: true,
  arquivoTamanho: true,
  autor: true,
  versaoAtual: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

type ItemSemConteudo = Prisma.BibliotecaTextoGetPayload<{
  select: typeof CAMPOS_RESUMO;
}>;

/** Item com o texto, mas ainda sem os bytes do PDF. */
type ItemComTexto = ItemSemConteudo & {
  texto: string | null;
  arquivoMime: string | null;
};

/** Campos que a edição altera e que a versão guarda. */
interface CamposEditaveis {
  classificacao: string;
  titulo: string;
  tema: string | null;
  link: string | null;
  texto: string | null;
}

/**
 * Biblioteca: acervo de referência da área.
 *
 * O conteúdo de cada item pode ser link, PDF anexado, texto digitado — ou a
 * combinação deles. A regra é uma só: **não aceitar registro sem conteúdo**, para
 * o acervo não virar lista de títulos sem lastro. Essa regra é verificada no
 * cadastro, na edição e na remoção do PDF.
 *
 * ATENÇÃO AO STATUS DE ERRO: este domínio responde **400** nas validações, e não
 * o 422 usado em recursos e cautelares. É o que o backend Python faz aqui, e a
 * divergência entre módulos existe lá também — preservada para o comportamento
 * não mudar durante a convivência dos dois backends.
 */
@Injectable()
export class BibliotecaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perfis: PerfisService,
  ) {}

  // ==========================================================================
  // Filtros da tela
  // ==========================================================================

  /** Classificações aceitas, na ordem em que a tela mostra. */
  listarClassificacoes(): { valor: string; label: string }[] {
    return Object.entries(CLASSIFICACOES).map(([valor, label]) => ({
      valor,
      label,
    }));
  }

  /** Temas já usados, para o filtro e para o autocompletar do cadastro. */
  async listarTemas(classificacao?: string): Promise<string[]> {
    const registros = await this.prisma.bibliotecaTexto.findMany({
      where: {
        tema: { not: null },
        ...(classificacao ? { classificacao } : {}),
      },
      select: { tema: true },
      distinct: ["tema"],
    });

    const temas = new Set(
      registros
        .map((r) => r.tema?.trim())
        .filter((t): t is string => Boolean(t)),
    );

    // Ordena ignorando caixa e acento, como o `str.casefold` do Python: sem
    // isso, "Ápice" iria para o fim da lista.
    return [...temas].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  // ==========================================================================
  // Listagem e detalhe
  // ==========================================================================

  /**
   * Lista o acervo, do documento mais recente para o mais antigo.
   *
   * Ordena pela `dataReferencia` (a data do documento) e usa a data de cadastro
   * só como desempate — quem procura referência quer a mais nova sobre o tema,
   * não a que foi cadastrada por último. Itens sem data ficam no fim.
   */
  async listar(filtros: {
    classificacao?: string;
    tema?: string;
    busca?: string;
    limit?: number;
  }): Promise<ItemResumo[]> {
    const where: Prisma.BibliotecaTextoWhereInput = {};

    if (filtros.classificacao) {
      if (!(filtros.classificacao in CLASSIFICACOES)) {
        throw new BadRequestException("Classificação inválida.");
      }
      where.classificacao = filtros.classificacao;
    }

    if (filtros.tema) {
      where.tema = filtros.tema.trim();
    }

    if (filtros.busca?.trim()) {
      const termo = filtros.busca.trim();
      where.OR = [
        { titulo: { contains: termo, mode: "insensitive" } },
        { tema: { contains: termo, mode: "insensitive" } },
        { texto: { contains: termo, mode: "insensitive" } },
        { arquivoNome: { contains: termo, mode: "insensitive" } },
      ];
    }

    /*
      `select` explícito é obrigatório aqui: sem ele o Prisma traz `texto` e
      `arquivoConteudo` de todas as linhas, e o PDF chega a 10 MB por item — uma
      listagem de 200 itens arrastaria gigabytes para a memória. É o equivalente
      ao `deferred` do SQLAlchemy, que no Python protege o mesmo caso.
    */
    const registros = await this.prisma.bibliotecaTexto.findMany({
      where,
      select: CAMPOS_RESUMO,
      orderBy: [
        { dataReferencia: { sort: "desc", nulls: "last" } },
        { criadoEm: "desc" },
      ],
      take: Math.min(filtros.limit ?? 200, 500),
    });

    const comTexto = await this.idsComTexto(registros.map((r) => r.id));

    return registros.map((r) => this.paraResumo(r, comTexto.has(r.id)));
  }

  /** Item completo, com o texto. */
  async obter(id: number): Promise<ItemDetalhe> {
    const registro = await this.buscarComTexto(id);
    return this.paraDetalhe(registro);
  }

  // ==========================================================================
  // Cadastro e edição
  // ==========================================================================

  /**
   * Cadastra um item com link, texto e/ou PDF.
   *
   * O cadastro é multipart, e não JSON, para o PDF entrar junto dos demais
   * campos: se o arquivo fosse um segundo passo, um item que só tem PDF ficaria
   * salvo sem conteúdo no intervalo entre as duas chamadas — e para sempre, se a
   * segunda falhasse.
   */
  async criar(
    entrada: {
      classificacao: string;
      titulo: string;
      tema?: string;
      data_referencia?: string;
      link?: string;
      texto?: string;
    },
    pdf: { nome: string; conteudo: Buffer } | null,
    usuario: UsuarioAtualInfo,
  ): Promise<ItemDetalhe> {
    const campos = this.validarCampos(entrada);

    if (!campos.link && !campos.texto && !pdf) {
      throw new BadRequestException(
        "Informe ao menos um conteúdo: link, texto ou PDF.",
      );
    }

    const criado = await this.prisma.bibliotecaTexto.create({
      data: {
        classificacao: campos.classificacao,
        titulo: campos.titulo,
        tema: campos.tema,
        dataReferencia: this.paraData(entrada.data_referencia),
        link: campos.link,
        texto: campos.texto,
        arquivoNome: pdf?.nome ?? null,
        arquivoMime: pdf ? "application/pdf" : null,
        arquivoTamanho: pdf?.conteudo.length ?? null,
        arquivoConteudo: pdf?.conteudo ?? null,
        autor: usuario.nome || usuario.email,
      },
    });

    return this.paraDetalhe(criado);
  }

  /** Atualiza os campos do item e guarda o estado anterior como versão. */
  async atualizar(
    id: number,
    entrada: {
      classificacao: string;
      titulo: string;
      tema?: string | null;
      data_referencia?: string | null;
      link?: string | null;
      texto?: string | null;
    },
    usuario: UsuarioAtualInfo,
  ): Promise<ItemDetalhe> {
    const registro = await this.buscarComTexto(id);
    const campos = this.validarCampos({
      classificacao: entrada.classificacao,
      titulo: entrada.titulo,
      tema: entrada.tema ?? undefined,
      link: entrada.link ?? undefined,
      texto: entrada.texto ?? undefined,
    });

    // O PDF já anexado conta como conteúdo: um item que só tem PDF pode ter
    // link e texto vazios sem ficar sem lastro.
    if (!campos.link && !campos.texto && !registro.arquivoNome) {
      throw new BadRequestException(
        "O item ficaria sem conteúdo. Informe link, texto ou anexe um PDF.",
      );
    }

    const atualizado = await this.prisma.$transaction(async (tx) => {
      await this.guardarVersao(tx, registro);

      return tx.bibliotecaTexto.update({
        where: { id },
        data: {
          classificacao: campos.classificacao,
          titulo: campos.titulo,
          tema: campos.tema,
          dataReferencia: this.paraData(entrada.data_referencia),
          link: campos.link,
          texto: campos.texto,
          versaoAtual: (registro.versaoAtual || 1) + 1,
          autor: usuario.nome || usuario.email,
        },
      });
    });

    return this.paraDetalhe(atualizado);
  }

  /** Exclui um item. Somente quem cadastrou ou a coordenação. */
  async excluir(id: number, usuario: UsuarioAtualInfo): Promise<void> {
    const registro = await this.prisma.bibliotecaTexto.findUnique({
      where: { id },
      select: { id: true, autor: true },
    });

    if (!registro) {
      throw new NotFoundException("Item da biblioteca não encontrado.");
    }

    if (!(await this.podeExcluir(registro.autor, usuario))) {
      throw new ForbiddenException(
        "Somente quem cadastrou o item ou a coordenação pode excluí-lo.",
      );
    }

    // As versões têm chave estrangeira para o item, com onDelete: Cascade no
    // schema — o banco apaga o histórico junto.
    await this.prisma.bibliotecaTexto.delete({ where: { id } });
  }

  // ==========================================================================
  // Versões
  // ==========================================================================

  /** Histórico de versões, da mais recente para a mais antiga. */
  async listarVersoes(id: number): Promise<VersaoResposta[]> {
    await this.exigirItem(id);

    const versoes = await this.prisma.bibliotecaVersao.findMany({
      where: { itemId: id },
      orderBy: { numero: "desc" },
    });

    return versoes.map((v) => ({
      id: v.id,
      numero: v.numero,
      autor: v.autor,
      criado_em: v.criadoEm ? v.criadoEm.toISOString() : null,
      titulo: v.titulo,
      classificacao: v.classificacao,
      tema: v.tema,
      data_referencia: v.dataReferencia ? chaveDoDia(v.dataReferencia) : null,
      link: v.link,
      texto: v.texto,
    }));
  }

  /**
   * Restaura o item ao estado de uma versão anterior.
   *
   * Guarda o estado atual como nova versão ANTES de restaurar — sem isso,
   * restaurar por engano apagaria o que estava valendo, sem volta.
   */
  async restaurarVersao(
    id: number,
    numero: number,
    usuario: UsuarioAtualInfo,
  ): Promise<ItemDetalhe> {
    const registro = await this.buscarComTexto(id);

    const versao = await this.prisma.bibliotecaVersao.findFirst({
      where: { itemId: id, numero },
    });

    if (!versao) {
      throw new NotFoundException(`Versão ${numero} não encontrada.`);
    }

    const restaurado = await this.prisma.$transaction(async (tx) => {
      await this.guardarVersao(tx, registro);

      return tx.bibliotecaTexto.update({
        where: { id },
        data: {
          classificacao: versao.classificacao ?? registro.classificacao,
          titulo: versao.titulo ?? registro.titulo,
          tema: versao.tema,
          dataReferencia: versao.dataReferencia,
          link: versao.link,
          texto: versao.texto,
          versaoAtual: (registro.versaoAtual || 1) + 1,
          autor: usuario.nome || usuario.email,
        },
      });
    });

    return this.paraDetalhe(restaurado);
  }

  // ==========================================================================
  // PDF anexado
  // ==========================================================================

  /** Anexa ou substitui o PDF de um item já cadastrado. */
  async enviarArquivo(
    id: number,
    pdf: { nome: string; conteudo: Buffer },
  ): Promise<ItemDetalhe> {
    await this.exigirItem(id);

    const atualizado = await this.prisma.bibliotecaTexto.update({
      where: { id },
      data: {
        arquivoNome: pdf.nome,
        arquivoMime: "application/pdf",
        arquivoTamanho: pdf.conteudo.length,
        arquivoConteudo: pdf.conteudo,
      },
    });

    return this.paraDetalhe(atualizado);
  }

  /** Bytes do PDF anexado, para exibir na tela ou baixar. */
  async baixarArquivo(
    id: number,
  ): Promise<{ nome: string; mime: string; conteudo: Buffer }> {
    const registro = await this.prisma.bibliotecaTexto.findUnique({
      where: { id },
      select: {
        arquivoNome: true,
        arquivoMime: true,
        arquivoConteudo: true,
      },
    });

    if (!registro) {
      throw new NotFoundException("Item da biblioteca não encontrado.");
    }
    if (!registro.arquivoConteudo) {
      throw new NotFoundException("Este item não tem PDF anexado.");
    }

    return {
      nome: registro.arquivoNome || `biblioteca-${id}.pdf`,
      mime: registro.arquivoMime || "application/pdf",
      conteudo: Buffer.from(registro.arquivoConteudo),
    };
  }

  /** Remove o PDF, desde que sobre link ou texto no item. */
  async removerArquivo(id: number): Promise<ItemDetalhe> {
    const registro = await this.buscarComTexto(id);

    if (!registro.arquivoNome) {
      throw new NotFoundException("Este item não tem PDF anexado.");
    }
    if (!registro.link && !registro.texto) {
      throw new BadRequestException(
        "O item ficaria sem conteúdo. Informe link ou texto antes de remover o PDF.",
      );
    }

    const atualizado = await this.prisma.bibliotecaTexto.update({
      where: { id },
      data: {
        arquivoNome: null,
        arquivoMime: null,
        arquivoTamanho: null,
        arquivoConteudo: null,
      },
    });

    return this.paraDetalhe(atualizado);
  }

  /**
   * Confere o PDF enviado e devolve nome e conteúdo.
   *
   * A checagem dos primeiros bytes (`%PDF-`) é o que realmente vale: extensão e
   * content-type são apenas a promessa de quem envia, e um HTML salvo como .pdf
   * não abriria no visualizador da tela — o usuário veria um erro do navegador,
   * sem pista do motivo.
   */
  validarPdf(arquivo: {
    originalname?: string;
    mimetype?: string;
    buffer?: Buffer;
  }): { nome: string; conteudo: Buffer } {
    const nome = arquivo.originalname?.trim() || "documento.pdf";
    const tipo = (arquivo.mimetype ?? "").split(";")[0].trim().toLowerCase();

    if (!MIMES_PDF.has(tipo) && !nome.toLowerCase().endsWith(".pdf")) {
      throw new BadRequestException("Anexe um arquivo PDF.");
    }

    const conteudo = arquivo.buffer;
    if (!conteudo || conteudo.length === 0) {
      throw new BadRequestException("Arquivo vazio.");
    }
    if (conteudo.length > TAMANHO_MAXIMO_ARQUIVO) {
      throw new BadRequestException("Arquivo excede o limite de 10 MB.");
    }

    // Alguns geradores deixam espaço em branco antes da assinatura.
    const inicio = conteudo.subarray(0, 1024).toString("latin1").trimStart();
    if (!inicio.startsWith("%PDF-")) {
      throw new BadRequestException("O arquivo não parece ser um PDF válido.");
    }

    return { nome, conteudo };
  }

  // ==========================================================================
  // Apoio
  // ==========================================================================

  /**
   * Valida e normaliza os campos de texto, para cadastro e edição.
   *
   * Campo em branco no formulário é AUSÊNCIA de valor, não string vazia: gravado
   * como "", o `tem_texto` da listagem passaria a mentir e os filtros
   * encontrariam item sem conteúdo.
   */
  private validarCampos(entrada: {
    classificacao: string;
    titulo: string;
    tema?: string;
    link?: string;
    texto?: string;
  }): CamposEditaveis {
    if (!(entrada.classificacao in CLASSIFICACOES)) {
      throw new BadRequestException(
        `Classificação inválida. Use uma destas: ${Object.keys(
          CLASSIFICACOES,
        ).join(", ")}.`,
      );
    }

    const titulo = (entrada.titulo ?? "").trim();
    if (!titulo) {
      throw new BadRequestException("Informe o título.");
    }

    const link = (entrada.link ?? "").trim() || null;
    if (link && !/^https?:\/\//i.test(link)) {
      throw new BadRequestException(
        "O link deve começar com http:// ou https://.",
      );
    }

    return {
      classificacao: entrada.classificacao,
      titulo,
      tema: (entrada.tema ?? "").trim() || null,
      link,
      texto: (entrada.texto ?? "").trim() || null,
    };
  }

  /**
   * Quais itens têm texto, numa consulta só.
   *
   * Ler o campo item por item para saber se existe conteúdo dispararia uma
   * consulta por linha, cada uma trazendo o texto inteiro.
   */
  private async idsComTexto(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) return new Set();

    const comTexto = await this.prisma.bibliotecaTexto.findMany({
      where: { id: { in: ids }, texto: { not: null, notIn: [""] } },
      select: { id: true },
    });

    return new Set(comTexto.map((r) => r.id));
  }

  private async exigirItem(id: number): Promise<void> {
    const existe = await this.prisma.bibliotecaTexto.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!existe) {
      throw new NotFoundException("Item da biblioteca não encontrado.");
    }
  }

  /**
   * Item com o texto, mas SEM os bytes do PDF.
   *
   * O `arquivoConteudo` é excluído de propósito: as rotas que usam este método
   * devolvem metadados, e trazer 10 MB de PDF para responder o nome do arquivo
   * seria desperdício em cada edição.
   */
  private async buscarComTexto(id: number): Promise<ItemComTexto> {
    const registro = await this.prisma.bibliotecaTexto.findUnique({
      where: { id },
      // `select` explícito em vez de `omit`: o `omit` do Prisma 5 depende do
      // preview feature `omitApi`, e ligar preview feature por um detalhe de
      // consulta não se paga.
      select: { ...CAMPOS_RESUMO, texto: true, arquivoMime: true },
    });

    if (!registro) {
      throw new NotFoundException("Item da biblioteca não encontrado.");
    }

    return registro;
  }

  /** Grava o estado atual do item como uma versão do histórico. */
  private guardarVersao(
    tx: Prisma.TransactionClient,
    registro: ItemComTexto,
  ): Promise<unknown> {
    return tx.bibliotecaVersao.create({
      data: {
        itemId: registro.id,
        numero: registro.versaoAtual || 1,
        autor: registro.autor,
        classificacao: registro.classificacao,
        titulo: registro.titulo,
        tema: registro.tema,
        dataReferencia: registro.dataReferencia,
        link: registro.link,
        texto: registro.texto,
      },
    });
  }

  /**
   * Autor ou coordenação.
   *
   * O acervo é compartilhado, mas apagar é definitivo — só quem cadastrou ou a
   * coordenação decide isso. No backend Python a checagem de coordenação lia as
   * app roles do token; agora vem do perfil resolvido, porque as roles deixaram
   * de ser fonte de autorização no padrão da plataforma.
   */
  private async podeExcluir(
    autor: string | null,
    usuario: UsuarioAtualInfo,
  ): Promise<boolean> {
    const perfil = await this.perfis.resolver(usuario);
    if (this.perfis.ehCoordenacao(perfil)) return true;

    const nome = usuario.nome || usuario.email;
    return Boolean(nome && autor === nome);
  }

  private paraData(valor?: string | null): Date | null {
    if (!valor) return null;
    const data = new Date(`${valor}T00:00:00.000Z`);
    if (Number.isNaN(data.getTime())) {
      throw new BadRequestException(
        "Data de referência inválida. Use o formato AAAA-MM-DD.",
      );
    }
    return data;
  }

  private paraResumo(registro: ItemSemConteudo, temTexto: boolean): ItemResumo {
    return {
      id: registro.id,
      classificacao: registro.classificacao,
      classificacao_label:
        CLASSIFICACOES[registro.classificacao] ?? registro.classificacao,
      titulo: registro.titulo,
      tema: registro.tema,
      data_referencia: registro.dataReferencia
        ? chaveDoDia(registro.dataReferencia)
        : null,
      link: registro.link,
      arquivo_nome: registro.arquivoNome,
      arquivo_tamanho: registro.arquivoTamanho,
      tem_texto: temTexto,
      tem_arquivo: Boolean(registro.arquivoNome),
      autor: registro.autor,
      versao_atual: registro.versaoAtual || 1,
      criado_em: registro.criadoEm ? registro.criadoEm.toISOString() : null,
      atualizado_em: registro.atualizadoEm
        ? registro.atualizadoEm.toISOString()
        : null,
    };
  }

  private paraDetalhe(registro: ItemComTexto): ItemDetalhe {
    return {
      ...this.paraResumo(registro, Boolean(registro.texto)),
      texto: registro.texto,
    };
  }
}
