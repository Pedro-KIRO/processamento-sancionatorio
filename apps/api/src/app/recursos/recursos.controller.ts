import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from "@nestjs/common";

import { UsuarioAtual } from "../auth/usuario-atual.decorator";
import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import {
  DecisaoIIDto,
  InterposicaoDto,
  ParecerDto,
  RecursoResposta,
} from "./dto/recurso.dto";
import { RecursosService } from "./recursos.service";

/**
 * Painel de recurso e Decisão II.
 *
 * Fica sob `/processos-andamento/:itemId/recurso` porque recurso não existe
 * solto — é uma etapa do processo. O restante do domínio de processos em
 * andamento ainda está no backend Python, e a ponte de migração distingue as
 * duas coisas por padrão de rota (ver ROTAS_MIGRADAS).
 *
 * Sobre as permissões: o `@RequirePermission` garante que a pessoa participa do
 * trâmite recursal. A competência de cada ato — parecer é da Consultoria
 * Jurídica, Decisão II é da Coordenação — é verificada no service, porque deriva
 * do perfil e não de permissão configurável: trocar quem profere a Decisão II
 * seria mudança de competência legal, não de configuração de acesso.
 */
@Controller("processos-andamento/:itemId/recurso")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class RecursosController {
  constructor(private readonly recursos: RecursosService) {}

  @Get()
  @RequirePermission("processamento:recursos:consultar")
  obter(
    @Param("itemId", ParseIntPipe) itemId: number,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<RecursoResposta> {
    return this.recursos.obter(itemId, usuario);
  }

  @Post("interposicao")
  @RequirePermission("processamento:recursos:registrar-interposicao")
  registrarInterposicao(
    @Param("itemId", ParseIntPipe) itemId: number,
    @Body() dados: InterposicaoDto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<RecursoResposta> {
    return this.recursos.registrarInterposicao(itemId, dados, usuario);
  }

  @Post("parecer")
  @RequirePermission("processamento:recursos:emitir-parecer")
  registrarParecer(
    @Param("itemId", ParseIntPipe) itemId: number,
    @Body() dados: ParecerDto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<RecursoResposta> {
    return this.recursos.registrarParecer(itemId, dados, usuario);
  }

  @Post("decisao-ii")
  @RequirePermission("processamento:recursos:decidir")
  registrarDecisaoII(
    @Param("itemId", ParseIntPipe) itemId: number,
    @Body() dados: DecisaoIIDto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<RecursoResposta> {
    return this.recursos.registrarDecisaoII(itemId, dados, usuario);
  }
}
