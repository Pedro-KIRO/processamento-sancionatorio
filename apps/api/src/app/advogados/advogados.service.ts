import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../../shared/prisma.service";
import {
  AdvogadoResposta,
  BuscaOabResposta,
  paraResposta,
  SalvarAdvogadoDto,
  VincularAdvogadoDto,
} from "./dto/advogado.dto";

@Injectable()
export class AdvogadosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A OAB é sempre normalizada em maiúsculas.
   *
   * É a chave de deduplicação: sem normalizar, "sp123456" e "SP123456" criariam
   * dois cadastros para o mesmo advogado, e a busca por OAB deixaria de achar o
   * que já existe.
   */
  private normalizarOab(oab: string): string {
    return oab.trim().toUpperCase();
  }

  async listar(
    busca: string | undefined,
    limite: number,
  ): Promise<AdvogadoResposta[]> {
    const termo = busca?.trim();

    const advogados = await this.prisma.advogado.findMany({
      where: termo
        ? {
            OR: [
              { nome: { contains: termo, mode: "insensitive" } },
              { oab: { contains: termo, mode: "insensitive" } },
              { email: { contains: termo, mode: "insensitive" } },
            ],
          }
        : {},
      orderBy: { nome: "asc" },
      take: limite,
    });

    return advogados.map(paraResposta);
  }

  /**
   * Busca por OAB exata. Usada pela tela antes de cadastrar, para oferecer o
   * vínculo com o registro existente em vez de criar duplicado.
   */
  async buscarPorOab(oab: string): Promise<BuscaOabResposta> {
    const registro = await this.prisma.advogado.findUnique({
      where: { oab: this.normalizarOab(oab) },
    });

    return registro
      ? { encontrado: true, advogado: paraResposta(registro) }
      : { encontrado: false, advogado: null };
  }

  /**
   * Cria o advogado. Se a OAB já existir, devolve o existente em vez de falhar.
   *
   * O comportamento idempotente é proposital e vem do backend Python: o
   * analista cadastra a partir de uma petição, sem saber se o advogado já está
   * no sistema. Recusar com 409 obrigaria a repetir o trabalho pela busca; nome
   * e e-mail informados aproveitam para corrigir o cadastro.
   */
  async criar(dados: SalvarAdvogadoDto): Promise<AdvogadoResposta> {
    const oab = this.normalizarOab(dados.oab);
    const nome = dados.nome.trim();
    const email = dados.email?.trim() || null;

    const existente = await this.prisma.advogado.findUnique({ where: { oab } });

    if (existente) {
      const correcoes: { nome?: string; email?: string | null } = {};

      if (nome && nome !== existente.nome) {
        correcoes.nome = nome;
      }
      // Compara com "" para tratar null igual a vazio, como no Python: assim
      // informar e-mail em cadastro que não tinha preenche o campo.
      if (dados.email !== undefined && email !== (existente.email || null)) {
        correcoes.email = email;
      }

      if (Object.keys(correcoes).length === 0) {
        return paraResposta(existente);
      }

      const atualizado = await this.prisma.advogado.update({
        where: { id: existente.id },
        data: correcoes,
      });

      return paraResposta(atualizado);
    }

    const novo = await this.prisma.advogado.create({
      data: { nome, oab, email },
    });

    return paraResposta(novo);
  }

  async atualizar(
    id: number,
    dados: SalvarAdvogadoDto,
  ): Promise<AdvogadoResposta> {
    const registro = await this.prisma.advogado.findUnique({ where: { id } });
    if (!registro) {
      throw new NotFoundException("Advogado não encontrado.");
    }

    const oab = this.normalizarOab(dados.oab);

    if (oab !== registro.oab) {
      const conflito = await this.prisma.advogado.findUnique({
        where: { oab },
        select: { nome: true },
      });

      if (conflito) {
        throw new ConflictException(
          `OAB ${oab} já está cadastrada para ${conflito.nome}.`,
        );
      }
    }

    const atualizado = await this.prisma.advogado.update({
      where: { id },
      data: {
        nome: dados.nome.trim(),
        oab,
        email: dados.email?.trim() || null,
      },
    });

    return paraResposta(atualizado);
  }

  /** Exclui o advogado e seus vínculos com processos. */
  async excluir(id: number): Promise<void> {
    const registro = await this.prisma.advogado.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!registro) {
      throw new NotFoundException("Advogado não encontrado.");
    }

    // Transação: o vínculo tem chave estrangeira para o advogado, então apagar
    // o advogado sem apagar os vínculos primeiro falha por integridade. Em duas
    // operações soltas, uma falha no meio deixaria vínculo órfão.
    await this.prisma.$transaction([
      this.prisma.advogadoProcesso.deleteMany({ where: { advogadoId: id } }),
      this.prisma.advogado.delete({ where: { id } }),
    ]);
  }

  /** Vincula um advogado a um processo. Não duplica vínculo existente. */
  async vincular(dados: VincularAdvogadoDto): Promise<AdvogadoResposta> {
    const advogado = await this.prisma.advogado.findUnique({
      where: { id: dados.advogado_id },
    });

    if (!advogado) {
      throw new NotFoundException("Advogado não encontrado.");
    }

    const item = await this.prisma.caixaEntrada.findUnique({
      where: { id: dados.caixa_entrada_id },
      select: { id: true },
    });

    if (!item) {
      throw new NotFoundException("Processo não encontrado.");
    }

    const existente = await this.prisma.advogadoProcesso.findFirst({
      where: {
        advogadoId: dados.advogado_id,
        caixaEntradaId: dados.caixa_entrada_id,
      },
      select: { id: true },
    });

    if (!existente) {
      await this.prisma.advogadoProcesso.create({
        data: {
          advogadoId: dados.advogado_id,
          caixaEntradaId: dados.caixa_entrada_id,
        },
      });
    }

    return paraResposta(advogado);
  }

  /** Advogados vinculados a um processo. */
  async listarPorProcesso(
    caixaEntradaId: number,
  ): Promise<AdvogadoResposta[]> {
    const advogados = await this.prisma.advogado.findMany({
      where: { processos: { some: { caixaEntradaId } } },
      orderBy: { nome: "asc" },
    });

    return advogados.map(paraResposta);
  }

  /** Remove o vínculo entre advogado e processo. */
  async desvincular(
    caixaEntradaId: number,
    advogadoId: number,
  ): Promise<void> {
    const vinculo = await this.prisma.advogadoProcesso.findFirst({
      where: { advogadoId, caixaEntradaId },
      select: { id: true },
    });

    if (!vinculo) {
      throw new NotFoundException("Vínculo não encontrado.");
    }

    await this.prisma.advogadoProcesso.delete({ where: { id: vinculo.id } });
  }
}
