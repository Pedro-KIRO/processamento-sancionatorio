import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from "@nestjs/common";

import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import { BuscaService } from "./busca.service";
import type { RespostaBusca } from "./dto/busca-resposta.dto";

/**
 * Pesquisa global do cabeçalho — somente leitura.
 *
 * Chamada a cada 300 ms de digitação por `PesquisaGlobal.tsx`, então responde
 * com no máximo algumas dezenas de linhas e nunca consulta o SEI.
 */
@Controller("busca")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class BuscaController {
  constructor(private readonly busca: BuscaService) {}

  @Get()
  @RequirePermission("processamento:busca:consultar")
  buscar(
    @Query("termo", new DefaultValuePipe("")) termo = "",
    @Query("limit", new DefaultValuePipe(10), ParseIntPipe) limit = 10,
  ): Promise<RespostaBusca> {
    return this.busca.buscar(termo, limit);
  }
}
