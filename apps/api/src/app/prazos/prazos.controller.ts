import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseBoolPipe,
  ParseIntPipe,
  Query,
  UseGuards,
} from "@nestjs/common";

import { UsuarioAtual } from "../auth/usuario-atual.decorator";
import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import type { RespostaPrazos } from "./dto/prazo.dto";
import { PrazosService } from "./prazos.service";

/**
 * Tela de Controle de Prazos.
 *
 * Os três modos de visualização (lista, calendário do mês e semana) consomem o
 * MESMO endpoint; a diferença é a janela pedida em `venc_de`/`venc_ate` — o
 * calendário busca o mês inteiro de uma vez, em vez de um dia por requisição.
 */
@Controller("prazos")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class PrazosController {
  constructor(private readonly prazos: PrazosService) {}

  // Caminhos fixos antes de qualquer rota com parâmetro.
  @Get("tipos")
  @RequirePermission("processamento:prazos:listar")
  listarTipos() {
    return this.prazos.listarTipos();
  }

  @Get("responsaveis")
  @RequirePermission("processamento:prazos:listar")
  listarResponsaveis(): Promise<{ id: number; nome: string }[]> {
    return this.prazos.listarResponsaveis();
  }

  @Get()
  @RequirePermission("processamento:prazos:listar")
  listar(
    @UsuarioAtual() usuario: UsuarioAtualInfo,
    @Query("busca") busca?: string,
    @Query("agente") agente?: string,
    @Query("tipo") tipo?: string,
    @Query("situacao") situacao?: string,
    @Query("responsavel_id") responsavelId?: string,
    @Query("priorizados", new DefaultValuePipe(false), ParseBoolPipe)
    priorizados = false,
    @Query("venc_de") vencDe?: string,
    @Query("venc_ate") vencAte?: string,
    @Query("limit", new DefaultValuePipe(300), ParseIntPipe) limit = 300,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset = 0,
  ): Promise<RespostaPrazos> {
    return this.prazos.listar(
      {
        busca,
        agente,
        tipo,
        situacao,
        // O front manda `responsavel_id` vazio quando o filtro está em "todos";
        // ParseIntPipe recusaria a string vazia com 400, então a conversão é
        // feita aqui e valor inválido é simplesmente ignorado.
        responsavel_id: responsavelId ? Number(responsavelId) || undefined : undefined,
        priorizados,
        venc_de: vencDe,
        venc_ate: vencAte,
        limit,
        offset,
      },
      usuario,
    );
  }
}
