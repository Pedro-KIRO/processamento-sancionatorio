// Módulo raiz da aplicação.
//
// Ordem de composição:
//   ConfigModule    → variáveis de ambiente (lê o .env da raiz do monorepo)
//   PrismaModule    → acesso ao banco do domínio
//   PermissionsModule → banco de permissões + PermissionGuard (global)
//   AuthModule      → resolução de identidade + UsuarioAtualGuard
//   <domínio>Module → módulos de negócio, adicionados conforme a migração avança
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { SeiModule } from "../integrations/sei/sei.module";
import { PrismaModule } from "../shared/prisma.module";
import { AdvogadosModule } from "./advogados/advogados.module";
import { AnotacoesModule } from "./anotacoes/anotacoes.module";
import { AuditoriaModule } from "./auditoria/auditoria.module";
import { AuthModule } from "./auth/auth.module";
import { BibliotecaModule } from "./biblioteca/biblioteca.module";
import { BuscaModule } from "./busca/busca.module";
import { CautelaresModule } from "./cautelares/cautelares.module";
import { ConsultaUnificadaModule } from "./consulta-unificada/consulta-unificada.module";
import { DocumentosModule } from "./documentos/documentos.module";
import { ExportacaoModule } from "./exportacao/exportacao.module";
import { LegacyModule } from "./legacy/legacy.module";
import { MeModule } from "./me/me.module";
import { PerfisModule } from "./perfis/perfis.module";
import { PermissionsModule } from "./permissions/permissions.module";
import { PrazosModule } from "./prazos/prazos.module";
import { RecursosModule } from "./recursos/recursos.module";
import { UsuariosModule } from "./usuarios/usuarios.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // O .env fica na raiz do monorepo, não dentro de apps/api.
      envFilePath: ["../../.env", ".env"],
    }),
    PrismaModule,
    PermissionsModule,
    AuthModule,
    // Perfis de exibição. Vem antes dos domínios porque vários dependem dele.
    PerfisModule,
    // Integração com o SEI: global, usada por oito domínios.
    SeiModule,
    // Módulos de domínio. Ao registrar um módulo aqui, acrescente também as
    // rotas dele em ROTAS_MIGRADAS (legacy-proxy.middleware.ts) — sem isso a
    // ponte continua repassando ao FastAPI e o código novo nunca é chamado.
    // Lista completa prevista em .kiro/steering/dominio.md.
    AnotacoesModule,
    MeModule,
    UsuariosModule,
    AdvogadosModule,
    PrazosModule,
    AuditoriaModule,
    RecursosModule,
    ConsultaUnificadaModule,
    ExportacaoModule,
    CautelaresModule,
    BibliotecaModule,
    BuscaModule,
    DocumentosModule,

    // LegacyModule vem por ÚLTIMO: ele repassa ao FastAPI tudo que ainda não
    // foi portado. Remover quando a migração terminar.
    LegacyModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
