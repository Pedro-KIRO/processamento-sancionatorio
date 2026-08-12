import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";

import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import { SalvarUsuarioDto, UsuarioResposta } from "./dto/usuario.dto";
import { UsuariosService } from "./usuarios.service";

/**
 * Gestão de usuários e acessos do sistema.
 *
 * No backend Python o acesso era barrado por `exigir_coordenador`. Aqui quem
 * decide é o catálogo do Gestão de Acessos, via @RequirePermission — a regra
 * deixa de estar no código e passa a ser configurável sem deploy.
 */
@Controller("usuarios")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  // Declarado antes das rotas com parâmetro para o Nest não tentar casar
  // "perfis" como se fosse um id.
  @Get("perfis")
  @RequirePermission("processamento:usuarios:listar")
  listarPerfis(): { valor: string; rotulo: string }[] {
    return this.usuarios.listarPerfis();
  }

  @Get()
  @RequirePermission("processamento:usuarios:listar")
  listar(
    @Query("busca") busca?: string,
    @Query("somente_ativos", new DefaultValuePipe(true), ParseBoolPipe)
    somenteAtivos = true,
  ): Promise<UsuarioResposta[]> {
    return this.usuarios.listar(busca, somenteAtivos);
  }

  @Post()
  @RequirePermission("processamento:usuarios:criar")
  criar(@Body() dados: SalvarUsuarioDto): Promise<UsuarioResposta> {
    return this.usuarios.criar(dados);
  }

  @Put(":id")
  @RequirePermission("processamento:usuarios:editar")
  atualizar(
    @Param("id", ParseIntPipe) id: number,
    @Body() dados: SalvarUsuarioDto,
  ): Promise<UsuarioResposta> {
    return this.usuarios.atualizar(id, dados);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("processamento:usuarios:desativar")
  desativar(@Param("id", ParseIntPipe) id: number): Promise<void> {
    return this.usuarios.desativar(id);
  }
}
