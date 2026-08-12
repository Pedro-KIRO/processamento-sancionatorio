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
import { AuditoriaService } from "./auditoria.service";
import type { RespostaAuditoria } from "./dto/auditoria.dto";

/**
 * Consulta da trilha de auditoria.
 *
 * Acesso restrito: é registro de quem fez o quê, e serve ao controle interno,
 * não ao trabalho do dia. No backend Python a barreira era `exigir_coordenador`;
 * aqui é a permissão `processamento:auditoria:consultar`, que a Coordenação
 * concede a quem precisar sem depender de mudança no código.
 */
@Controller("auditoria")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class AuditoriaController {
  constructor(private readonly auditoria: AuditoriaService) {}

  @Get()
  @RequirePermission("processamento:auditoria:consultar")
  consultar(
    @Query("usuario") usuario?: string,
    @Query("entidade") entidade?: string,
    @Query("registro_id") registroId?: string,
    @Query("de") de?: string,
    @Query("ate") ate?: string,
    @Query("limit", new DefaultValuePipe(200), ParseIntPipe) limit = 200,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset = 0,
  ): Promise<RespostaAuditoria> {
    return this.auditoria.consultar({
      usuario,
      entidade,
      // Filtro vazio chega como string vazia; o ParseIntPipe responderia 400.
      registro_id: registroId ? Number(registroId) || undefined : undefined,
      de,
      ate,
      limit,
      offset,
    });
  }
}
