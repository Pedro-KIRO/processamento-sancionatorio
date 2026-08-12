import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Post,
  Query,
  UnprocessableEntityException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { UsuarioAtual } from "../auth/usuario-atual.decorator";
import { UsuarioAtualGuard } from "../auth/usuario-atual.guard";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PermissionGuard } from "../permissions/permission.guard";
import { RequirePermission } from "../permissions/require-permission.decorator";
import { CautelaresService } from "./cautelares.service";
import {
  CautelarResposta,
  CriarCautelarDto,
  RecusarCautelarDto,
  RenovarCautelarDto,
  RespostaCertidao,
  ResumoCautelares,
  RevogarCautelarDto,
} from "./dto/cautelar.dto";

/** Formatos aceitos como evidência da certidão. */
const EXTENSOES_PERMITIDAS = [".pdf", ".png", ".jpg", ".jpeg", ".tiff"];

/** Arquivo recebido no multipart. Tipado aqui para não depender de @types/multer. */
interface ArquivoEnviado {
  originalname?: string;
}

/**
 * Painel de medidas cautelares.
 *
 * As ações de competência exclusiva do Coordenador Geral (aplicar, concordar,
 * recusar, renovar, revogar) têm a competência verificada no service, por
 * perfil. A permissão do endpoint garante o acesso à tela; a competência legal
 * não é configurável.
 */
@Controller("cautelares")
@UseGuards(UsuarioAtualGuard, PermissionGuard)
export class CautelaresController {
  constructor(private readonly cautelares: CautelaresService) {}

  // "resumo" antes de ":id", senão o Nest tenta interpretá-lo como um id e o
  // ParseIntPipe responde 422.
  @Get("resumo")
  @RequirePermission("processamento:cautelares:listar")
  resumo(): Promise<ResumoCautelares> {
    return this.cautelares.resumo();
  }

  @Get()
  @RequirePermission("processamento:cautelares:listar")
  listar(
    @Query("situacao") situacao?: string,
    @Query("unidade") unidade?: string,
    @Query("aprovacao") aprovacao?: string,
    @Query("somente_com_defesa", new DefaultValuePipe(false), ParseBoolPipe)
    somenteComDefesa = false,
  ): Promise<CautelarResposta[]> {
    return this.cautelares.listar({
      situacao,
      unidade,
      aprovacao,
      somente_com_defesa: somenteComDefesa,
    });
  }

  @Get(":id")
  @RequirePermission("processamento:cautelares:listar")
  obter(@Param("id", ParseIntPipe) id: number): Promise<CautelarResposta> {
    return this.cautelares.obter(id);
  }

  @Post()
  @RequirePermission("processamento:cautelares:aplicar")
  criar(
    @Body() dados: CriarCautelarDto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    return this.cautelares.criar(dados, usuario);
  }

  // 200, e não o 201 padrão do Nest: são mudanças de estado de um registro que
  // já existe, e é o que o backend Python responde.
  @Post(":id/aprovar")
  @HttpCode(200)
  @RequirePermission("processamento:cautelares:decidir")
  aprovar(
    @Param("id", ParseIntPipe) id: number,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    return this.cautelares.aprovar(id, usuario);
  }

  @Post(":id/recusar")
  @HttpCode(200)
  @RequirePermission("processamento:cautelares:decidir")
  recusar(
    @Param("id", ParseIntPipe) id: number,
    @Body() dados: RecusarCautelarDto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    return this.cautelares.recusar(id, dados.motivo, usuario);
  }

  // 201: a renovação CRIA uma nova cautelar.
  @Post(":id/renovar")
  @RequirePermission("processamento:cautelares:decidir")
  renovar(
    @Param("id", ParseIntPipe) id: number,
    @Body() dados: RenovarCautelarDto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    return this.cautelares.renovar(id, dados, usuario);
  }

  @Post(":id/revogar")
  @HttpCode(200)
  @RequirePermission("processamento:cautelares:decidir")
  revogar(
    @Param("id", ParseIntPipe) id: number,
    @Body() dados: RevogarCautelarDto,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    return this.cautelares.revogar(id, dados.motivo, usuario);
  }

  @Post(":id/certidao")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("arquivo"))
  @RequirePermission("processamento:cautelares:juntar-certidao")
  async juntarCertidao(
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile() arquivo: ArquivoEnviado,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<RespostaCertidao> {
    const nome = this.validarEvidencia(arquivo);
    await this.cautelares.juntarCertidao(id, nome, usuario);

    return {
      sucesso: true,
      mensagem: "Certidão de bloqueio recebida. Inclusão no SEI será processada.",
      cautelar_id: id,
    };
  }

  @Post(":id/certidao-desbloqueio")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("arquivo"))
  @RequirePermission("processamento:cautelares:juntar-certidao")
  async juntarCertidaoDesbloqueio(
    @Param("id", ParseIntPipe) id: number,
    @UploadedFile() arquivo: ArquivoEnviado,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<RespostaCertidao> {
    const nome = this.validarEvidencia(arquivo);
    await this.cautelares.juntarCertidaoDesbloqueio(id, nome, usuario);

    return {
      sucesso: true,
      mensagem:
        "Certidão de desbloqueio recebida. Inclusão no SEI será processada.",
      cautelar_id: id,
    };
  }

  @Post(":id/assinatura-concluida")
  @HttpCode(200)
  @RequirePermission("processamento:cautelares:decidir")
  marcarAssinaturaConcluida(
    @Param("id", ParseIntPipe) id: number,
    @UsuarioAtual() usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    return this.cautelares.marcarAssinaturaConcluida(id, usuario);
  }

  /**
   * Valida a evidência e devolve o nome do arquivo.
   *
   * A evidência é obrigatória porque a certidão atesta que o bloqueio foi
   * efetivado no sistema legado — sem a tela não há como comprovar.
   */
  private validarEvidencia(arquivo: ArquivoEnviado | undefined): string {
    const nome = arquivo?.originalname;

    if (!nome) {
      throw new UnprocessableEntityException("Arquivo obrigatório.");
    }

    const ponto = nome.lastIndexOf(".");
    const extensao = ponto >= 0 ? nome.slice(ponto).toLowerCase() : "";

    if (!EXTENSOES_PERMITIDAS.includes(extensao)) {
      throw new UnprocessableEntityException(
        `Formato não permitido. Use: ${EXTENSOES_PERMITIDAS.join(", ")}`,
      );
    }

    return nome;
  }
}
