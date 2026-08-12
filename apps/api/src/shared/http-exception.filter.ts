/*
  Formata os erros HTTP no mesmo formato do FastAPI: `{ "detail": ... }`.

  POR QUE EXISTE — é uma trava de contrato, não estilo.

  O cliente HTTP do frontend lê o corpo do erro em `corpo.detail`
  (apps/web/src/api/client.ts, função `lancarErro`). O NestJS, por padrão,
  responde `{ statusCode, message, error }` — sem `detail`.

  Sem este filtro, todo erro de endpoint migrado perderia a mensagem: o
  `ApiError` cairia no texto genérico "Erro 404 ao chamar /caminho", e a tela
  mostraria isso ao usuário em vez do motivo real.

  Pior: o `DespachoModal` decide pelo campo `detail.temporario` se mostra
  "instabilidade temporária do SEI" e mantém o botão Confirmar habilitado. Com o
  corpo em outro formato, `temporario` viria `undefined`, o modal trataria uma
  falha momentânea como definitiva e o usuário perderia o trabalho já digitado.

  Nada disso apareceria como erro de rede — a requisição responde normalmente,
  só a mensagem fica errada. Por isso a formatação é centralizada aqui, e não
  endpoint a endpoint.
*/
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

@Catch()
export class FormatoErroFastApiFilter implements ExceptionFilter {
  private readonly logger = new Logger(FormatoErroFastApiFilter.name);

  catch(excecao: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (excecao instanceof HttpException) {
      const status = excecao.getStatus();
      res.status(status).json({ detail: this.corpoDoDetail(excecao) });
      return;
    }

    // Erro não previsto: registra o rastro no log e devolve mensagem genérica.
    // Nunca vaze stack trace nem detalhe interno na resposta.
    this.logger.error(
      `Erro não tratado em ${req.method} ${req.originalUrl}`,
      excecao instanceof Error ? excecao.stack : String(excecao),
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      detail: "Erro interno. Tente novamente ou acione o suporte.",
    });
  }

  /**
   * Monta o conteúdo de `detail` preservando a forma que o frontend espera.
   *
   * O cliente aceita `detail` como texto ou como objeto:
   *   `typeof d === 'string' ? { message: d } : d`
   *
   * Então texto simples vai como texto (igual ao FastAPI) e resposta
   * estruturada — como o 403 do PermissionGuard, com `motivo` — vai como objeto.
   */
  private corpoDoDetail(excecao: HttpException): unknown {
    const resposta = excecao.getResponse();

    if (typeof resposta === "string") {
      return resposta;
    }

    const corpo = resposta as Record<string, unknown>;

    /*
      Erro de validação do ValidationPipe: `message` vem como array de frases.
      O frontend leria `detail.message` e receberia um array, que renderiza
      como "[object Object]" ou lista concatenada sem sentido. Junta num texto
      só, que é o que a tela sabe exibir.
    */
    if (Array.isArray(corpo.message)) {
      return { message: corpo.message.join(" ") };
    }

    // `statusCode` e `error` são ruído do NestJS: o status já vai na resposta
    // HTTP, e o frontend não usa nenhum dos dois.
    const { statusCode: _s, error: _e, ...resto } = corpo;

    // Só `message` sobrou: manda como texto, igual ao FastAPI faz.
    if (Object.keys(resto).length === 1 && typeof resto.message === "string") {
      return resto.message;
    }

    return resto;
  }
}
