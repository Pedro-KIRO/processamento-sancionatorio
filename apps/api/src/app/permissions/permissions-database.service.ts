// Acesso SOMENTE LEITURA ao schema gestao_acessos_v2 (banco do Gestão de Acessos).
//
// Regras que este arquivo materializa:
//   - Nunca escrever nesse schema. Só SELECT.
//   - PERMISSIONS_DATABASE_URL é obrigatória; sem ela o módulo não inicializa.
//   - Vigência temporal sempre verificada (ativa + acesso_inicio/acesso_fim).
//   - Erro de conexão/timeout propaga para o guard, que responde 503 (fail-closed).
//
// Usa um PrismaClient próprio, separado do PrismaService do domínio, porque a
// connection string é outra. As consultas são feitas via $queryRaw parametrizado
// — o schema externo não é modelado no nosso schema.prisma, já que não somos
// donos dele e ele pode evoluir sem o nosso versionamento.
//
// ATENÇÃO — VALIDAR CONTRA O BANCO REAL:
// Os nomes de coluna abaixo seguem o que está documentado em
// .kiro/steering/permissionamento.md. As tabelas estão confirmadas; os nomes de
// COLUNA (usuario_id, perfil_id, permissao_id, identificador, ativa,
// acesso_inicio, acesso_fim, oid) ainda não foram verificados contra a DDL real
// do gestao_acessos_v2. Confirme antes de subir para homologação.
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

/** Linha de tb_usuarios usada para montar a identidade. */
interface LinhaUsuario {
  id: number;
  nome: string | null;
  email: string | null;
  oid: string | null;
}

/** Nome do perfil que concede bypass total dentro do sistema. */
const PERFIL_GESTOR_PRINCIPAL = "Gestor Principal";

@Injectable()
export class PermissionsDatabaseService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PermissionsDatabaseService.name);
  private readonly client: PrismaClient;

  constructor() {
    const url = process.env.PERMISSIONS_DATABASE_URL;

    // Fail-fast: sem banco de permissões não há como autorizar ninguém, e
    // subir a API sem isso significaria endpoints protegidos respondendo 503
    // em massa. Melhor não iniciar.
    if (!url) {
      throw new Error(
        "PERMISSIONS_DATABASE_URL não configurada. O módulo de permissões não " +
          "pode inicializar sem acesso ao banco do Gestão de Acessos.",
      );
    }

    this.client = new PrismaClient({
      datasources: { db: { url } },
      log: ["warn", "error"],
    });
  }

  async onModuleInit() {
    await this.client.$connect();
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  /**
   * Resolve a identidade oficial do usuário por Object ID do Entra (preferido)
   * ou por e-mail (fallback e caminho único em modo dev).
   *
   * Devolve null quando o usuário não existe no Gestão de Acessos — o guard
   * traduz isso em 401.
   */
  async buscarUsuario(params: {
    oid?: string | null;
    email?: string | null;
  }): Promise<LinhaUsuario | null> {
    const { oid, email } = params;

    if (!oid && !email) {
      return null;
    }

    // O oid tem precedência: é imutável, enquanto e-mail pode ser reatribuído.
    const linhas = await this.client.$queryRaw<LinhaUsuario[]>`
      SELECT id, nome, email, oid
      FROM gestao_acessos_v2.tb_usuarios
      WHERE (${oid}::text IS NOT NULL AND oid = ${oid}::text)
         OR (${email}::text IS NOT NULL AND LOWER(email) = LOWER(${email}::text))
      ORDER BY CASE WHEN oid = ${oid}::text THEN 0 ELSE 1 END
      LIMIT 1
    `;

    return linhas[0] ?? null;
  }

  /**
   * Usuário é Gestor Principal com vínculo ativo e vigente?
   * Gestor Principal tem bypass total das permissões do sistema.
   */
  async ehGestorPrincipal(usuarioId: number): Promise<boolean> {
    const linhas = await this.client.$queryRaw<{ existe: number }[]>`
      SELECT 1 AS existe
      FROM gestao_acessos_v2.tb_usuario_perfis up
      JOIN gestao_acessos_v2.tb_perfis p ON p.id = up.perfil_id
      WHERE up.usuario_id = ${usuarioId}
        AND p.nome = ${PERFIL_GESTOR_PRINCIPAL}
        AND COALESCE(up.ativa, TRUE) = TRUE
        AND (up.acesso_inicio IS NULL OR up.acesso_inicio <= NOW())
        AND (up.acesso_fim IS NULL OR up.acesso_fim >= NOW())
      LIMIT 1
    `;

    return linhas.length > 0;
  }

  /**
   * Usuário tem concessão DIRETA ativa e vigente para o identificador?
   */
  async temConcessaoDireta(
    usuarioId: number,
    identificador: string,
  ): Promise<boolean> {
    const linhas = await this.client.$queryRaw<{ existe: number }[]>`
      SELECT 1 AS existe
      FROM gestao_acessos_v2.tb_concessoes c
      JOIN gestao_acessos_v2.tb_permissoes pm ON pm.id = c.permissao_id
      WHERE c.usuario_id = ${usuarioId}
        AND pm.identificador = ${identificador}
        AND COALESCE(pm.ativa, TRUE) = TRUE
        AND COALESCE(c.ativa, TRUE) = TRUE
        AND (c.acesso_inicio IS NULL OR c.acesso_inicio <= NOW())
        AND (c.acesso_fim IS NULL OR c.acesso_fim >= NOW())
      LIMIT 1
    `;

    return linhas.length > 0;
  }

  /**
   * Usuário tem a permissão através de um perfil vinculado, ativo e vigente?
   */
  async temPermissaoPorPerfil(
    usuarioId: number,
    identificador: string,
  ): Promise<boolean> {
    const linhas = await this.client.$queryRaw<{ existe: number }[]>`
      SELECT 1 AS existe
      FROM gestao_acessos_v2.tb_usuario_perfis up
      JOIN gestao_acessos_v2.tb_perfil_permissoes pp ON pp.perfil_id = up.perfil_id
      JOIN gestao_acessos_v2.tb_permissoes pm ON pm.id = pp.permissao_id
      WHERE up.usuario_id = ${usuarioId}
        AND pm.identificador = ${identificador}
        AND COALESCE(pm.ativa, TRUE) = TRUE
        AND COALESCE(up.ativa, TRUE) = TRUE
        AND (up.acesso_inicio IS NULL OR up.acesso_inicio <= NOW())
        AND (up.acesso_fim IS NULL OR up.acesso_fim >= NOW())
      LIMIT 1
    `;

    return linhas.length > 0;
  }
}
