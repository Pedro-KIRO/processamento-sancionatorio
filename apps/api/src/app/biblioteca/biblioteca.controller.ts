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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";

import { UsuarioAtual } from "../auth/usuario-atual.decorator";
import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import { BibliotecaService } from "./biblioteca.service";
import {
  AtualizarItemDto,
  ItemDetalhe,
  ItemResumo,
  TAMANHO_MAXIMO_ARQUIVO,
  VersaoResposta,
} from "./dto/biblioteca.dto";

/** Arquivo recebido no multipart, tipado sem depender de @types/multer. */
interface ArquivoEnviado {
  originalname?: string;
  mimetype?: string;
  buffer?: Buffer;
}

/**
 * Teto do multer, com folga sobre o limite de negócio.
 *
 * O limite real (10 MB) é conferido no service, para a mensagem sair em
 * português e no formato que a tela espera. Este teto aqui é só rede de
 * segurança contra upload absurdo: sem ele, um arquivo de 2 GB seria carregado
 * inteiro na memória antes de qualquer verificação.
 */
const TETO_MULTER = TAMANHO_MAXIMO_ARQUIVO * 2;

/**
 * Biblioteca: acervo de referência da área.
 *
 * ORDEM DOS MÉTODOS IMPORTA: `classificacoes` e `temas` vêm ANTES de `:id`,
 * senão o Nest tenta interpretá-los como id e o ParseIntPipe recusa a
 * requisição.
 */
@Controller("biblioteca")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class BibliotecaController {
  constructor(private readonly biblioteca: BibliotecaService) {}

  @Get("classificacoes")
  @RequirePermission("processamento:biblioteca:consultar")
  listarClassificacoes(): { valor: string; label: string }[] {
    return this.biblioteca.listarClassificacoes();
  }

  @Get("temas")
  @RequirePermission("processamento:biblioteca:consultar")
  listarTemas(@Query("classificacao") classificacao?: string): Promise<string[]> {
    return this.biblioteca.listarTemas(classificacao);
  }

  @Get()
  @RequirePermission("processamento:biblioteca:consultar")
  listar(
    @Query("classificacao") classificacao?: string,
    @Query("tema") tema?: string,
    @Query("busca") busca?: string,
    @Query("limit", new DefaultValuePipe(200), ParseIntPipe) limit = 200,
  ): Promise<ItemResumo[]> {
    return this.biblioteca.listar({ classificacao, tema, busca, limit });
  }

  // Rotas de sub-recurso antes de ":id" puro, para não competirem.
  @Get(":id/versoes")
  @RequirePermission("processamento:biblioteca:consultar")
  listarVersoes(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<VersaoResposta[]> {
    return this.biblioteca.listarVersoes(id);
  }

  @Get(":id/arquivo")
  @RequirePermission("processamento:biblioteca:consultar")
  async baixarArquivo(
    @Param("id", ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const { nome, mime, conteudo } = await this.biblioteca.baixarArquivo(id);

    // `inline` e não `attachment`: a tela exibe o PDF num visualizador, e
    // `attachment` forçaria download a cada abertura.
    res
      .status(200)
      .set({
        "Content-Type": mime,
        "Content-Disposition": `inline; filename="${nome}"`,
        "Content-Length": String(conteudo.length),
      })
      .end(conteudo);
  }

  @Get(":id")
  @RequirePermission("processamento:biblioteca:consultar")
  obter(@Param("id", ParseIntPipe) id: number): Promise<ItemDetalhe> {
    return this.biblioteca.obter(id);
  }

  /**
   * Cadastra um item. É multipart para o PDF entrar junto dos demais campos.
   *
   * Os campos chegam como texto de formulário, por isso não há DTO com
   * class-validator aqui: o `multipart/form-data` não carrega tipo, e tudo
   * viria como string. A validação fica no service, compartilhada com a edição.
   */
  @Post()
  @UseInterceptors(
    FileInterceptor("arquivo", { limits: { fileSize: TETO_MULTER } }),
  )
  @RequirePermission("processamento:biblioteca:cadastrar")
  criar(
    @Body()
    corpo: {
      classificacao: string;
      titulo: string;
      tema?: string;
      data_referencia?: string;
      link?: string;
      texto?: string;
    },
    @UploadedFile() arquivo: ArquivoEnviado | undefined,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<ItemDetalhe> {
    const pdf = arquivo?.originalname
      ? this.biblioteca.validarPdf(arquivo)
      : null;

    return this.biblioteca.criar(corpo, pdf, usuario);
  }

  @Put(":id")
  @RequirePermission("processamento:biblioteca:cadastrar")
  atualizar(
    @Param("id", ParseIntPipe) id: number,
    @Body() dados: AtualizarItemDto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<ItemDetalhe> {
    return this.biblioteca.atualizar(id, dados, usuario);
  }

  @Post(":id/versoes/:numero/restaurar")
  @HttpCode(200)
  @RequirePermission("processamento:biblioteca:cadastrar")
  restaurarVersao(
    @Param("id", ParseIntPipe) id: number,
    @Param("numero", ParseIntPipe) numero: number,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<ItemDetalhe> {
    return this.biblioteca.restaurarVersao(id, numero, usuario);
  }

  @Post(":id/arquivo")
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor("arquivo", { limits: { fileSize: TETO_MULTER } }),
  )
  @RequirePermission("processamento:biblioteca:cadastrar")
  enviarArquivo(
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile() arquivo: ArquivoEnviado,
  ): Promise<ItemDetalhe> {
    return this.biblioteca.enviarArquivo(id, this.biblioteca.validarPdf(arquivo));
  }

  @Delete(":id/arquivo")
  @HttpCode(200)
  @RequirePermission("processamento:biblioteca:cadastrar")
  removerArquivo(
    @Param("id", ParseIntPipe) id: number,
  ): Promise<ItemDetalhe> {
    return this.biblioteca.removerArquivo(id);
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("processamento:biblioteca:excluir")
  excluir(
    @Param("id", ParseIntPipe) id: number,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<void> {
    return this.biblioteca.excluir(id, usuario);
  }
}
