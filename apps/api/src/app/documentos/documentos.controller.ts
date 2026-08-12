import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import { DocumentosService } from "./documentos.service";
import {
  ConteudoDocumentoResposta,
  DocumentoResposta,
  nomeArquivoSeguro,
  TipoDocumento,
  TIPO_EXTERNO,
  TIPO_INTERNO,
} from "./dto/documento.dto";

/**
 * Aceita apenas os dois valores válidos e ignora o resto.
 *
 * O frontend monta o link de download com
 * `?tipo=${documentos.find(...)?.tipo ?? ''}`, então manda `tipo=` vazio quando
 * não encontra o documento na lista. Vazio tem de virar "não sei", que faz o
 * service tentar interno e depois anexo — recusar com 400 tiraria o download de
 * um documento que existe.
 */
function normalizarTipo(valor?: string): TipoDocumento | null {
  if (valor === TIPO_INTERNO || valor === TIPO_EXTERNO) {
    return valor;
  }
  return null;
}

/** Documentos do SEI acessados pelo número. */
@Controller("documentos")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class DocumentosController {
  constructor(private readonly documentos: DocumentosService) {}

  @Get(":numeroDoc/conteudo")
  @RequirePermission("processamento:documentos:consultar")
  obterConteudo(
    @Param("numeroDoc") numeroDoc: string,
    @Query("tipo") tipo?: string,
  ): Promise<ConteudoDocumentoResposta> {
    return this.documentos.obterConteudo(numeroDoc, normalizarTipo(tipo));
  }

  /**
   * Baixa o documento como arquivo.
   *
   * Escreve na resposta em vez de devolver objeto porque precisa dos cabeçalhos
   * de download e do corpo binário — o interceptor de serialização do Nest
   * transformaria o Buffer em JSON.
   */
  @Get(":numeroDoc/download")
  @RequirePermission("processamento:documentos:consultar")
  async baixar(
    @Param("numeroDoc") numeroDoc: string,
    @Res() resposta: Response,
    @Query("tipo") tipo?: string,
  ): Promise<void> {
    const { bytes, nomeArquivo, contentType } =
      await this.documentos.obterBytes(numeroDoc, normalizarTipo(tipo));

    resposta.setHeader("Content-Type", contentType);
    resposta.setHeader("Content-Length", String(bytes.length));
    resposta.setHeader(
      "Content-Disposition",
      `attachment; filename="${nomeArquivoSeguro(nomeArquivo)}"`,
    );
    resposta.end(bytes);
  }
}

/**
 * Documentos de um item da caixa de entrada.
 *
 * Controller separado porque o caminho é outro (`/caixa-entrada/...`). O resto do
 * domínio `/caixa-entrada` segue no FastAPI, e o padrão correspondente em
 * `ROTAS_MIGRADAS` cobre só esta rota.
 */
@Controller("caixa-entrada")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class DocumentosCaixaEntradaController {
  constructor(private readonly documentos: DocumentosService) {}

  @Get(":itemId/documentos")
  @RequirePermission("processamento:documentos:consultar")
  listar(
    @Param("itemId", ParseIntPipe) itemId: number,
  ): Promise<DocumentoResposta[]> {
    return this.documentos.listarPorItemCaixaEntrada(itemId);
  }
}
