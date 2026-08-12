import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../../shared/prisma.service";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { AnotacaoResposta, paraResposta } from "./dto/anotacao-resposta.dto";

@Injectable()
export class AnotacoesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Nome gravado como autor da anotação.
   *
   * Mantém a mesma precedência do backend Python (nome → e-mail → "Anônimo")
   * porque é esse texto que a exclusão compara para decidir se quem pede é o
   * autor. Mudar a regra aqui tornaria anotações antigas impossíveis de excluir.
   */
  private nomeDoAutor(usuario: UsuarioAtualInfo): string {
    return usuario.nome || usuario.email || "Anônimo";
  }

  /**
   * Confirma que o item da caixa de entrada existe.
   *
   * Sem esta checagem, listar anotações de um id inexistente devolveria lista
   * vazia — indistinguível de "existe e não tem anotação".
   */
  private async exigirItem(itemId: number): Promise<void> {
    const item = await this.prisma.caixaEntrada.findUnique({
      where: { id: itemId },
      select: { id: true },
    });

    if (!item) {
      throw new NotFoundException("Item da caixa de entrada não encontrado");
    }
  }

  /** Lista as anotações do item em ordem cronológica. */
  async listar(itemId: number): Promise<AnotacaoResposta[]> {
    await this.exigirItem(itemId);

    const anotacoes = await this.prisma.anotacao.findMany({
      where: { caixaEntradaId: itemId },
      orderBy: { criadoEm: "asc" },
    });

    return anotacoes.map(paraResposta);
  }

  /** Cria uma anotação interna vinculada ao item. */
  async criar(
    itemId: number,
    texto: string,
    usuario: UsuarioAtualInfo,
  ): Promise<AnotacaoResposta> {
    await this.exigirItem(itemId);

    const anotacao = await this.prisma.anotacao.create({
      data: {
        caixaEntradaId: itemId,
        autor: this.nomeDoAutor(usuario),
        texto: texto.trim(),
      },
    });

    return paraResposta(anotacao);
  }

  /** Exclui uma anotação. Somente o autor pode excluir. */
  async excluir(
    itemId: number,
    anotacaoId: number,
    usuario: UsuarioAtualInfo,
  ): Promise<void> {
    await this.exigirItem(itemId);

    const anotacao = await this.prisma.anotacao.findUnique({
      where: { id: anotacaoId },
    });

    // Confere também o vínculo com o item: sem isso, informar o id de uma
    // anotação de outro processo excluiria a anotação errada.
    if (!anotacao || anotacao.caixaEntradaId !== itemId) {
      throw new NotFoundException("Anotação não encontrada");
    }

    if (anotacao.autor !== this.nomeDoAutor(usuario)) {
      throw new ForbiddenException(
        "Somente o autor pode excluir esta anotação",
      );
    }

    await this.prisma.anotacao.delete({ where: { id: anotacaoId } });
  }
}
