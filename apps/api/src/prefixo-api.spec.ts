/*
  Travas do prefixo /api — lado da API.

  Contraparte de backend/tests/test_prefixo_api.py e de
  apps/web/src/api/client.test.ts. Existem por causa de um defeito que apareceu
  três vezes para o usuário: apertar F5 na tela de Cautelares (e em sete outras)
  mostrava JSON cru no lugar do app, porque o endereço da tela e o da API eram o
  mesmo texto — `/cautelares` era ao mesmo tempo a tela e a lista de dados.

  A correção foi mover toda a API para `/api`. Estes testes existem para que ela
  não volte.

  A verificação é do código-fonte de propósito. Um teste de integração exigiria
  banco no ar (o PermissionsModule falha no construtor sem
  PERMISSIONS_DATABASE_URL), e o erro que se quer pegar é de declaração: alguém
  registrar rota fora do prefixo, ou escrever o padrão da ponte de migração com
  o prefixo embutido. Isso não aparece em teste de comportamento — só na leitura
  do fonte.
*/
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "@jest/globals";

import { ROTAS_MIGRADAS } from "./app/legacy/legacy-proxy.middleware";

const RAIZ_SRC = join(__dirname);

/** Lista recursivamente os arquivos .ts de src/, sem os de teste. */
function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      return fontes(caminho);
    }
    if (!nome.endsWith(".ts") || nome.endsWith(".spec.ts")) {
      return [];
    }
    return [caminho];
  });
}

const ARQUIVOS = fontes(RAIZ_SRC);
const CONTROLLERS = ARQUIVOS.filter((c) => c.endsWith(".controller.ts"));

describe("prefixo /api", () => {
  it("a varredura do fonte encontrou arquivos (senão a trava passa por vazio)", () => {
    expect(ARQUIVOS.length).toBeGreaterThan(10);
    expect(CONTROLLERS.length).toBeGreaterThan(0);
  });

  it("o main.ts declara o prefixo global /api", () => {
    const main = readFileSync(join(RAIZ_SRC, "main.ts"), "utf8");

    expect(main).toContain('setGlobalPrefix("api"');
  });

  /*
    /health precisa ficar FORA do prefixo: o healthcheck do contêiner em
    homologação consulta http://localhost:3001/health (ver
    homolog.docker-compose.yml). Se o prefixo passar a valer para ele, o
    healthcheck falha, o contêiner é marcado como unhealthy e o deploy é
    revertido — sem que nada na aplicação esteja quebrado.
  */
  it("o /health fica fora do prefixo, para o healthcheck do contêiner", () => {
    const main = readFileSync(join(RAIZ_SRC, "main.ts"), "utf8");

    expect(main).toMatch(/setGlobalPrefix\(\s*"api"\s*,\s*\{\s*exclude:\s*\[\s*"health"\s*\]/);
  });

  /*
    Controller com caminho começando em "api/" geraria /api/api/... porque o
    prefixo global já é aplicado. A tela chamaria /api/... e receberia 404.
  */
  it("nenhum controller repete o prefixo no próprio caminho", () => {
    const infratores = CONTROLLERS.filter((caminho) => {
      const texto = readFileSync(caminho, "utf8");
      return /@Controller\(\s*["'`]\/?api\//.test(texto);
    });

    expect(infratores).toEqual([]);
  });

  /*
    Os padrões de ROTAS_MIGRADAS são comparados com o caminho JÁ SEM o "/api"
    (o middleware corta o prefixo antes de testar). Escrever "/api/..." aqui
    cria um padrão que nunca casa: a rota migrada continua sendo repassada ao
    FastAPI e o código novo nunca roda. Como o FastAPI responde normalmente,
    ninguém percebe — até o Python sair do ar.
  */
  it("os padrões da ponte de migração não incluem o prefixo /api", () => {
    const comPrefixo = ROTAS_MIGRADAS.filter((rota) =>
      rota.source.includes("\\/api"),
    ).map((rota) => rota.source);

    expect(comPrefixo).toEqual([]);
  });

  it("os padrões da ponte são ancorados, para não casar por acidente", () => {
    const semAncora = ROTAS_MIGRADAS.filter(
      (rota) => !rota.source.startsWith("^") || !rota.source.endsWith("$"),
    ).map((rota) => rota.source);

    expect(semAncora).toEqual([]);
  });
});
