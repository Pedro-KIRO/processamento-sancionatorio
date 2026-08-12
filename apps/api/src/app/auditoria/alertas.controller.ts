import { Controller, Get, UseGuards } from "@nestjs/common";

import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import { AlertasService } from "./alertas.service";
import type { Alerta } from "./dto/auditoria.dto";

/**
 * Alertas internos exibidos no topo da tela inicial.
 *
 * Controller separado do de auditoria porque o caminho é `/alertas`, não
 * `/auditoria/alertas` — no backend Python os dois moram no mesmo arquivo, mas
 * em routers sem prefixo comum. Manter o caminho é obrigatório: o
 * `AlertasInternos.tsx` chama `/alertas`.
 *
 * SEM @RequirePermission, de propósito: os alertas aparecem para qualquer pessoa
 * autenticada, e a lista já é filtrada na tela para mostrar só o que tem
 * pendência. Exigir permissão esconderia a pendência de quem precisa agir sobre
 * ela. A restrição fica nas telas de destino, cada uma com a sua permissão.
 */
@Controller("alertas")
@UseGuards(UsuarioAtualGuard)
export class AlertasController {
  constructor(private readonly alertas: AlertasService) {}

  @Get()
  listar(): Promise<Alerta[]> {
    return this.alertas.listar();
  }
}
