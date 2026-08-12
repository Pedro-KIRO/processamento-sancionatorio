import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../shared/prisma.service";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PermissionsDatabaseService } from "../permissions/permissions-database.service";
import {
  ehPerfilValido,
  Perfil,
  PERFIL_ANALISTA,
  PERFIL_COORDENADOR_GERAL,
  PERFIS_CHEFIA,
  PERFIS_COORDENACAO,
} from "./perfis";

/**
 * Resolve o perfil de exibição do usuário.
 *
 * O backend Python resolvia por três caminhos: app role do token do Entra, lista
 * COORDENADORES do .env e a coluna `perfil` da tabela `usuario`. Os dois
 * primeiros saem na migração — no padrão da plataforma, quem manda em acesso é o
 * Gestão de Acessos, e app role no token deixa de ser fonte de autorização.
 *
 * O que fica:
 *   1. Gestor Principal no Gestão de Acessos → coordenador_geral
 *   2. coluna `perfil` da tabela `usuario` local (se ativa e válida)
 *   3. analista — menor privilégio
 *
 * O passo 1 substitui o "em desenvolvimento mostra tudo" do Python, que ligava a
 * exibição ao modo de autenticação. Amarrar no Gestor Principal é melhor por
 * dois motivos: deriva de dado real, e vale igual em homologação — quem tem
 * bypass total no guard tem que ver todos os botões, senão a tela esconde ação
 * que a pessoa pode executar.
 */
@Injectable()
export class PerfisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissoesDb: PermissionsDatabaseService,
  ) {}

  async resolver(usuario: UsuarioAtualInfo): Promise<Perfil> {
    if (await this.permissoesDb.ehGestorPrincipal(usuario.id)) {
      return PERFIL_COORDENADOR_GERAL;
    }

    const email = usuario.email?.trim();
    if (!email) {
      return PERFIL_ANALISTA;
    }

    const registro = await this.prisma.usuario.findFirst({
      // `mode: "insensitive"` reproduz o ilike do Python: o e-mail do Entra
      // pode vir com caixa diferente da gravada no cadastro.
      where: { email: { equals: email, mode: "insensitive" }, ativo: true },
      select: { perfil: true },
    });

    const gravado = registro?.perfil?.trim().toLowerCase();
    if (gravado && ehPerfilValido(gravado)) {
      return gravado;
    }

    return PERFIL_ANALISTA;
  }

  /** Coordenador ou Coordenador Geral. */
  ehCoordenacao(perfil: Perfil): boolean {
    return PERFIS_COORDENACAO.has(perfil);
  }

  /** Só o Coordenador Geral aplica, renova e revoga medida cautelar. */
  ehCoordenadorGeral(perfil: Perfil): boolean {
    return perfil === PERFIL_COORDENADOR_GERAL;
  }

  /**
   * Quem pode marcar processo como prioritário para a equipe (★).
   *
   * O documento de negócio é ambíguo: nas regras transversais a priorização é
   * "exclusiva da Coordenação", mas a descrição da coluna ★ da tela de prazos
   * diz "coordenadores e chefes de divisão e serviço". Seguimos a segunda, mais
   * específica quanto a quem — negar à chefia travaria o trabalho dela.
   * **Ponto a confirmar com a área.**
   */
  podePriorizar(perfil: Perfil): boolean {
    return PERFIS_COORDENACAO.has(perfil) || PERFIS_CHEFIA.has(perfil);
  }

  /**
   * Atribuir e redistribuir processos e prazos entre a equipe: chefia para cima.
   * O analista continua podendo atribuir a si próprio — isso é verificado em
   * quem chama, comparando o destino com o próprio usuário.
   */
  podeRedistribuir(perfil: Perfil): boolean {
    return PERFIS_COORDENACAO.has(perfil) || PERFIS_CHEFIA.has(perfil);
  }
}
