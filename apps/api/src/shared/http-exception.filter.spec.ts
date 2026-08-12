import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";

import { FormatoErroFastApiFilter } from "./http-exception.filter";

/*
  Travas do formato de erro da API.

  O cliente HTTP do frontend lê o corpo do erro em `corpo.detail`
  (apps/web/src/api/client.ts). Se o formato mudar, a tela para de mostrar o
  motivo do erro e passa a exibir "Erro 4xx ao chamar /caminho" — e o
  DespachoModal perde o campo `temporario`, que decide se o botão Confirmar
  continua habilitado depois de uma falha momentânea do SEI.

  Nada disso quebra a requisição, só a mensagem. Por isso o formato é testado.
*/
function hostFalso() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: "GET", originalUrl: "/api/teste" }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe("FormatoErroFastApiFilter", () => {
  let filtro: FormatoErroFastApiFilter;

  beforeEach(() => {
    filtro = new FormatoErroFastApiFilter();
  });

  it("mensagem simples vai como texto em detail, igual ao FastAPI", () => {
    const { host, status, json } = hostFalso();

    filtro.catch(new NotFoundException("Advogado não encontrado."), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({ detail: "Advogado não encontrado." });
  });

  it("resposta estruturada preserva os campos dentro de detail", () => {
    const { host, json } = hostFalso();

    filtro.catch(
      new ForbiddenException({
        motivo: "permissao_insuficiente",
        message: "Você não tem permissão para executar esta ação.",
        permissaoNecessaria: "processamento:usuarios:listar",
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      detail: {
        motivo: "permissao_insuficiente",
        message: "Você não tem permissão para executar esta ação.",
        permissaoNecessaria: "processamento:usuarios:listar",
      },
    });
  });

  /*
    O ValidationPipe devolve `message` como array de frases. A tela lê
    `detail.message` e mostraria um array — junta num texto só.
  */
  it("erro de validação vira uma frase só, não array", () => {
    const { host, json } = hostFalso();

    filtro.catch(
      new BadRequestException({
        statusCode: 400,
        error: "Bad Request",
        message: ["Informe um e-mail válido.", "Informe o nome."],
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      detail: { message: "Informe um e-mail válido. Informe o nome." },
    });
  });

  it("descarta statusCode e error, que o frontend não usa", () => {
    const { host, json } = hostFalso();

    filtro.catch(
      new HttpException(
        { statusCode: 409, error: "Conflict", message: "OAB já cadastrada." },
        HttpStatus.CONFLICT,
      ),
      host,
    );

    expect(json).toHaveBeenCalledWith({ detail: "OAB já cadastrada." });
  });

  /*
    Erro inesperado não pode vazar stack trace nem detalhe interno na resposta:
    é informação útil para quem sonda a API. O rastro vai só para o log.
  */
  it("erro inesperado devolve 500 genérico, sem vazar detalhe interno", () => {
    const { host, status, json } = hostFalso();

    filtro.catch(new Error("conexão recusada em 10.1.2.3:5432"), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const corpo = json.mock.calls[0][0] as { detail: string };
    expect(corpo.detail).not.toContain("10.1.2.3");
    expect(corpo.detail).toBe(
      "Erro interno. Tente novamente ou acione o suporte.",
    );
  });
});
