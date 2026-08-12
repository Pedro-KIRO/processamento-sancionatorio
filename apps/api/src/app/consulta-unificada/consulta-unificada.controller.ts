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
import { ConsultaUnificadaService } from "./consulta-unificada.service";
import type { RespostaConsultaUnificada } from "./dto/consulta-unificada.dto";

/**
 * Tela "Consulta Unificada" — somente leitura.
 *
 * Nenhuma ação é disparada daqui, por isso só há verbos GET e uma única
 * permissão. As rotas de filtro (`agentes`, `situacoes`, `fases`) vêm ANTES da
 * listagem para o Nest não tentar casá-las como parâmetro.
 */
@Controller("consulta-unificada")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class ConsultaUnificadaController {
  constructor(private readonly consulta: ConsultaUnificadaService) {}

  @Get("agentes")
  @RequirePermission("processamento:consulta-unificada:consultar")
  listarAgentes(
    @Query("tipo") tipo?: string,
    @Query("fonte") fonte?: string,
  ): Promise<string[]> {
    return this.consulta.listarAgentes(tipo, fonte);
  }

  @Get("situacoes")
  @RequirePermission("processamento:consulta-unificada:consultar")
  listarSituacoes(
    @Query("tipo") tipo?: string,
    @Query("fonte") fonte?: string,
  ): Promise<string[]> {
    return this.consulta.listarSituacoes(tipo, fonte);
  }

  @Get("fases")
  @RequirePermission("processamento:consulta-unificada:consultar")
  listarFases(
    @Query("tipo") tipo?: string,
    @Query("fonte") fonte?: string,
  ): Promise<string[]> {
    return this.consulta.listarFases(tipo, fonte);
  }

  @Get()
  @RequirePermission("processamento:consulta-unificada:consultar")
  listar(
    @Query("busca") busca?: string,
    @Query("tipo") tipo?: string,
    @Query("fonte") fonte?: string,
    @Query("agente") agente?: string,
    @Query("situacao") situacao?: string,
    @Query("fase") fase?: string,
    @Query("ano") ano?: string,
    @Query("criacao_de") criacaoDe?: string,
    @Query("criacao_ate") criacaoAte?: string,
    @Query("acao_de") acaoDe?: string,
    @Query("acao_ate") acaoAte?: string,
    @Query("ordenar_por", new DefaultValuePipe("criacao")) ordenarPor = "criacao",
    @Query("ordem", new DefaultValuePipe("desc")) ordem = "desc",
    @Query("limit", new DefaultValuePipe(100), ParseIntPipe) limit = 100,
    @Query("offset", new DefaultValuePipe(0), ParseIntPipe) offset = 0,
  ): Promise<RespostaConsultaUnificada> {
    return this.consulta.listar({
      busca,
      tipo,
      fonte,
      agente,
      situacao,
      fase,
      ano,
      criacao_de: criacaoDe,
      criacao_ate: criacaoAte,
      acao_de: acaoDe,
      acao_ate: acaoAte,
      ordenar_por: ordenarPor,
      ordem,
      limit,
      offset,
    });
  }
}
