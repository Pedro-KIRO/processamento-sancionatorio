import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";

import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import { montarCsv } from "./csv";
import { ExportacaoService, type Exportacao } from "./exportacao.service";

/**
 * Exportação de dados para BI (Power BI e análise externa).
 *
 * Cada rota responde em JSON por padrão, ou CSV com `?formato=csv`. Como o tipo
 * da resposta muda conforme o parâmetro, o `Response` é manipulado direto — não
 * há como declarar dois formatos com o serializador padrão do NestJS.
 */
@Controller("exportacao")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class ExportacaoController {
  constructor(private readonly exportacao: ExportacaoService) {}

  @Get("processos")
  @RequirePermission("processamento:exportacao:baixar")
  async processos(
    @Res() res: Response,
    @Query("formato") formato?: string,
  ): Promise<void> {
    this.responder(res, await this.exportacao.processos(), formato);
  }

  @Get("eventos")
  @RequirePermission("processamento:exportacao:baixar")
  async eventos(
    @Res() res: Response,
    @Query("formato") formato?: string,
  ): Promise<void> {
    this.responder(res, await this.exportacao.eventos(), formato);
  }

  @Get("fases")
  @RequirePermission("processamento:exportacao:baixar")
  async fases(
    @Res() res: Response,
    @Query("formato") formato?: string,
  ): Promise<void> {
    this.responder(res, await this.exportacao.fases(), formato);
  }

  @Get("prazos")
  @RequirePermission("processamento:exportacao:baixar")
  async prazos(
    @Res() res: Response,
    @Query("formato") formato?: string,
  ): Promise<void> {
    this.responder(res, await this.exportacao.prazos(), formato);
  }

  /**
   * Escreve a resposta no formato pedido.
   *
   * O `charset=utf-8` no Content-Type não é enfeite: sem ele o Excel abre o CSV
   * em Latin-1 e "Autoescola São Paulo" chega como "AutoescolaÂ SÃ£o Paulo".
   */
  private responder(
    res: Response,
    dados: Exportacao,
    formato?: string,
  ): void {
    if (formato === "csv") {
      res
        .status(200)
        .set({
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${dados.arquivo}"`,
        })
        .send(montarCsv(dados.campos, dados.linhas));
      return;
    }

    res.status(200).json(dados.linhas);
  }
}
