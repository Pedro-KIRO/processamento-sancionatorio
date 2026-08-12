import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
import { AnotacoesService } from "./anotacoes.service";
import type { AnotacaoResposta } from "./dto/anotacao-resposta.dto";
import { CriarAnotacaoDto } from "./dto/criar-anotacao.dto";

/**
 * Anotações internas de um item da caixa de entrada.
 *
 * A rota é aninhada em `/caixa-entrada/:itemId` porque anotação não existe
 * solta — sempre pertence a um item. O prefixo global `/api` é aplicado no
 * main.ts.
 *
 * Ordem dos guards importa: identidade primeiro, permissão depois.
 */
@Controller("caixa-entrada/:itemId/anotacoes")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class AnotacoesController {
  constructor(private readonly anotacoes: AnotacoesService) {}

  @Get()
  @RequirePermission("processamento:anotacoes:listar")
  listar(
    @Param("itemId", ParseIntPipe) itemId: number,
  ): Promise<AnotacaoResposta[]> {
    return this.anotacoes.listar(itemId);
  }

  @Post()
  @RequirePermission("processamento:anotacoes:criar")
  criar(
    @Param("itemId", ParseIntPipe) itemId: number,
    @Body() dados: CriarAnotacaoDto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<AnotacaoResposta> {
    return this.anotacoes.criar(itemId, dados.texto, usuario);
  }

  // 204 explícito: o padrão do NestJS para DELETE é 200, e a tela trata a
  // resposta como sem corpo (apiDelete devolve void).
  @Delete(":anotacaoId")
  @HttpCode(204)
  @RequirePermission("processamento:anotacoes:excluir")
  excluir(
    @Param("itemId", ParseIntPipe) itemId: number,
    @Param("anotacaoId", ParseIntPipe) anotacaoId: number,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<void> {
    return this.anotacoes.excluir(itemId, anotacaoId, usuario);
  }
}
