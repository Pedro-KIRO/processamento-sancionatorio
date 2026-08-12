/*
  Escreve a trilha de auditoria de toda requisição que altera dados.

  POR QUE MIDDLEWARE, E NÃO CHAMADA EM CADA ENDPOINT

  Exigência da Documentação de Negócio v3.0: registrar usuário, data, horário,
  operação e documento afetado. Feito de forma centralizada, endpoint novo entra
  na trilha sem ninguém precisar lembrar — que é justamente o tipo de coisa que
  se esquece.

  POR QUE A GRAVAÇÃO ACONTECE NO FIM DA RESPOSTA

  O backend Python registrava ANTES do endpoint, de propósito: para auditoria,
  uma tentativa recusada por falta de permissão importa tanto quanto uma
  concluída. Só que ali o `status_http` ficava sempre nulo, porque a resposta
  ainda não existia.

  Aqui a decisão é tomada na entrada, mas a linha é escrita no evento `finish`
  da resposta. Isso preserva o comportamento importante — tentativa negada
  também é registrada, porque `finish` dispara mesmo em 403 — e ainda grava o
  status real. De quebra, escrever depois de a resposta ter sido enviada
  significa que o banco de auditoria nunca atrasa o usuário.

  Ler `req.usuario` no `finish` também é o que permite saber QUEM tentou: nesse
  momento o UsuarioAtualGuard já rodou. Um middleware que gravasse na entrada
  veria a identidade ainda não resolvida.

  FALHA AO AUDITAR NUNCA DERRUBA A REQUISIÇÃO. A ação do usuário já aconteceu;
  abortar aqui daria erro numa operação concluída, o que é pior que perder uma
  linha de log.
*/
import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { PrismaService } from "../../shared/prisma.service";
import {
  deveAuditar,
  entidadeDoCaminho,
  idDoCaminho,
} from "./trilha";

@Injectable()
export class AuditoriaMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AuditoriaMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // originalUrl porque o middleware é montado em "*" e o Express esvazia o
    // req.path nesse caso (o mesmo detalhe que já mordeu a ponte de migração).
    const caminho = req.originalUrl.split("?")[0];
    const metodo = req.method.toUpperCase();

    if (!deveAuditar(metodo, caminho)) {
      return next();
    }

    res.on("finish", () => {
      // `void` explícito: ninguém espera esta promessa, e não deve — a resposta
      // já foi enviada.
      void this.gravar(req, res, metodo, caminho);
    });

    return next();
  }

  private async gravar(
    req: Request,
    res: Response,
    metodo: string,
    caminho: string,
  ): Promise<void> {
    try {
      // Em modo dev a identidade pode não ter sido resolvida (endpoint sem
      // guard); o e-mail candidato serve de melhor esforço para não perder o
      // autor.
      const usuario = req.usuario?.email ?? req.devUserEmail ?? null;

      await this.prisma.auditoria.create({
        data: {
          usuario,
          operacao: `${metodo} ${caminho}`.slice(0, 255),
          metodo,
          caminho: caminho.slice(0, 500),
          entidade: entidadeDoCaminho(caminho),
          registroId: idDoCaminho(caminho),
          statusHttp: res.statusCode,
        },
      });
    } catch (erro) {
      this.logger.error(
        `Falha ao gravar na trilha de auditoria (${metodo} ${caminho}): ` +
          `${erro instanceof Error ? erro.message : erro}`,
      );
    }
  }
}
