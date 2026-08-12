import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { PrismaService } from "../../shared/prisma.service";
import { PERFIS, Perfil } from "../perfis/perfis";
import {
  paraResposta,
  SalvarUsuarioDto,
  UsuarioResposta,
} from "./dto/usuario.dto";

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  /** Perfis aceitos, na ordem hierárquica, para o seletor da tela. */
  listarPerfis(): { valor: string; rotulo: string }[] {
    return (Object.keys(PERFIS) as Perfil[]).map((valor) => ({
      valor,
      rotulo: PERFIS[valor],
    }));
  }

  async listar(
    busca: string | undefined,
    somenteAtivos: boolean,
  ): Promise<UsuarioResposta[]> {
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        ...(somenteAtivos ? { ativo: true } : {}),
        ...(busca?.trim()
          ? {
              OR: [
                { email: { contains: busca.trim(), mode: "insensitive" } },
                { nome: { contains: busca.trim(), mode: "insensitive" } },
              ],
            }
          : {}),
      },
      // `nome` antes de `email`, como no Python. Quem não tem nome vai para o
      // fim: no PostgreSQL, NULL ordena depois por padrão em ASC.
      orderBy: [{ nome: "asc" }, { email: "asc" }],
    });

    return usuarios.map(paraResposta);
  }

  async criar(dados: SalvarUsuarioDto): Promise<UsuarioResposta> {
    const email = dados.email.trim().toLowerCase();

    const existente = await this.prisma.usuario.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existente) {
      throw new ConflictException(`Email ${email} já está cadastrado.`);
    }

    const novo = await this.prisma.usuario.create({
      data: {
        email,
        ...this.camposEditaveis(dados),
      },
    });

    return paraResposta(novo);
  }

  async atualizar(
    id: number,
    dados: SalvarUsuarioDto,
  ): Promise<UsuarioResposta> {
    const registro = await this.prisma.usuario.findUnique({ where: { id } });
    if (!registro) {
      throw new NotFoundException("Usuário não encontrado.");
    }

    const email = dados.email.trim().toLowerCase();

    // Só checa conflito se o e-mail mudou: sem isso, salvar o próprio registro
    // sem alterar o e-mail acusaria conflito com ele mesmo.
    if (email !== registro.email) {
      const conflito = await this.prisma.usuario.findUnique({
        where: { email },
        select: { id: true },
      });

      if (conflito) {
        throw new ConflictException(
          `Email ${email} já está cadastrado para outro usuário.`,
        );
      }
    }

    const atualizado = await this.prisma.usuario.update({
      where: { id },
      data: {
        email,
        ...this.camposEditaveis(dados),
      },
    });

    return paraResposta(atualizado);
  }

  /**
   * Desativa o usuário — não exclui.
   *
   * Excluir romperia os vínculos de responsável por processo
   * (`caixa_entrada.responsavel_id`) e apagaria o histórico de quem conduziu o
   * processo, que é registro de interesse do controle interno.
   */
  async desativar(id: number): Promise<void> {
    const registro = await this.prisma.usuario.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!registro) {
      throw new NotFoundException("Usuário não encontrado.");
    }

    await this.prisma.usuario.update({
      where: { id },
      data: { ativo: false },
    });
  }

  /**
   * Normaliza os campos editáveis: texto vazio virou null, como no Python.
   * Sem isso o banco guardaria "" e a tela mostraria campo em branco que não é
   * o mesmo que "não informado".
   */
  private camposEditaveis(dados: SalvarUsuarioDto) {
    return {
      nome: dados.nome?.trim() || null,
      perfil: dados.perfil?.trim().toLowerCase() || null,
      idUnidade: dados.id_unidade?.trim() || null,
      ativo: dados.ativo ?? true,
    };
  }
}
