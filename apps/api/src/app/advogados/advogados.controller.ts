import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";

import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import { AdvogadosService } from "./advogados.service";
import {
  AdvogadoResposta,
  BuscaOabResposta,
  SalvarAdvogadoDto,
  VincularAdvogadoDto,
} from "./dto/advogado.dto";

/**
 * Advogados e procuradores que representam os interessados nos processos.
 *
 * ORDEM DOS MÉTODOS IMPORTA: as rotas de caminho fixo ("buscar-oab",
 * "vincular", "processo/...") vêm ANTES das que têm parâmetro. O Nest casa na
 * ordem de declaração — com ":id" antes, "buscar-oab" seria interpretado como um
 * id, o ParseIntPipe recusaria e a busca por OAB responderia 400.
 */
@Controller("advogados")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class AdvogadosController {
  constructor(private readonly advogados: AdvogadosService) {}

  @Get("buscar-oab")
  @RequirePermission("processamento:advogados:listar")
  buscarPorOab(@Query("oab") oab: string): Promise<BuscaOabResposta> {
    return this.advogados.buscarPorOab(oab ?? "");
  }

  @Get("processo/:caixaEntradaId")
  @RequirePermission("processamento:advogados:listar")
  listarPorProcesso(
    @Param("caixaEntradaId", ParseIntPipe) caixaEntradaId: number,
  ): Promise<AdvogadoResposta[]> {
    return this.advogados.listarPorProcesso(caixaEntradaId);
  }

  @Delete("processo/:caixaEntradaId/:advogadoId")
  @HttpCode(204)
  @RequirePermission("processamento:advogados:vincular")
  desvincular(
    @Param("caixaEntradaId", ParseIntPipe) caixaEntradaId: number,
    @Param("advogadoId", ParseIntPipe) advogadoId: number,
  ): Promise<void> {
    return this.advogados.desvincular(caixaEntradaId, advogadoId);
  }

  @Post("vincular")
  @RequirePermission("processamento:advogados:vincular")
  vincular(@Body() dados: VincularAdvogadoDto): Promise<AdvogadoResposta> {
    return this.advogados.vincular(dados);
  }

  @Get()
  @RequirePermission("processamento:advogados:listar")
  listar(
    @Query("busca") busca?: string,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limite = 50,
  ): Promise<AdvogadoResposta[]> {
    // Teto de 200, como no Python: sem limite, uma busca vazia arrastaria a
    // tabela inteira para a tela.
    return this.advogados.listar(busca, Math.min(limite, 200));
  }

  @Post()
  @RequirePermission("processamento:advogados:criar")
  criar(@Body() dados: SalvarAdvogadoDto): Promise<AdvogadoResposta> {
    return this.advogados.criar(dados);
  }

  @Put(":id")
  @RequirePermission("processamento:advogados:editar")
  atualizar(
    @Param("id", ParseIntPipe) id: number,
    @Body() dados: SalvarAdvogadoDto,
  ): Promise<AdvogadoResposta> {
    return this.advogados.atualizar(id, dados);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("processamento:advogados:excluir")
  excluir(@Param("id", ParseIntPipe) id: number): Promise<void> {
    return this.advogados.excluir(id);
  }
}
