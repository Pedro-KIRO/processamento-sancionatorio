// PONTE TEMPORÁRIA DE MIGRAÇÃO — remover quando o backend Python sair do ar.
//
// Por que existe: o frontend fala com um endereço só (`/api` → porta 3001), mas
// os 125 endpoints estão sendo portados do FastAPI para o NestJS em lotes. Sem
// esta ponte, cada domínio migrado exigiria mexer no proxy do Vite e no nginx,
// e qualquer esquecimento apareceria como "a tela não abre".
//
// Como funciona: um caminho sob /api só é repassado ao FastAPI se ainda NÃO
// estiver na lista de domínios migrados. Migrar um domínio = registrar o módulo
// no AppModule e acrescentar o prefixo em PREFIXOS_MIGRADOS.
//
// Quando PREFIXOS_MIGRADOS cobrir todos os domínios, este arquivo, o
// LegacyModule e a variável LEGACY_API_URL devem ser apagados.
import { Injectable, Logger, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import {
  createProxyMiddleware,
  type RequestHandler,
} from "http-proxy-middleware";

/**
 * Rotas (relativas a /api) já atendidas pelo NestJS.
 *
 * São expressões regulares, não prefixos. Prefixo não serve porque um domínio
 * migra em partes: as anotações vivem em `/caixa-entrada/{id}/anotacoes`, e um
 * prefixo `/caixa-entrada` marcaria como migrado TODO o domínio da caixa de
 * entrada — os endpoints ainda no Python deixariam de ser repassados e
 * responderiam 404.
 *
 * Ancore sempre com ^ e $. Lista vazia = tudo vai para o FastAPI, que é o
 * comportamento anterior à migração.
 */
export const ROTAS_MIGRADAS: readonly RegExp[] = [
  // Anotações internas de um item da caixa de entrada.
  /^\/caixa-entrada\/\d+\/anotacoes(\/\d+)?$/,
  // Usuário autenticado (perfil e permissões de exibição da tela).
  /^\/me$/,
  // Gestão de usuários e acessos.
  /^\/usuarios(\/perfis|\/\d+)?$/,
  // Advogados e procuradores, incluindo os vínculos com processo.
  /^\/advogados$/,
  /^\/advogados\/buscar-oab$/,
  /^\/advogados\/vincular$/,
  /^\/advogados\/\d+$/,
  /^\/advogados\/processo\/\d+(\/\d+)?$/,
  // Controle de prazos (lista, calendário e semana usam o mesmo endpoint).
  /^\/prazos$/,
  /^\/prazos\/tipos$/,
  /^\/prazos\/responsaveis$/,
  // Trilha de auditoria e alertas internos da tela inicial.
  /^\/auditoria$/,
  /^\/alertas$/,
  /*
    Painel de recurso e Decisão II.

    Repare que os padrões terminam em /recurso e derivados: o RESTO do domínio
    /processos-andamento continua no Python. Um padrão largo como
    /^\/processos-andamento\/\d+/ engoliria os 23 endpoints ainda não portados,
    que passariam a responder 404.
  */
  /^\/processos-andamento\/\d+\/recurso$/,
  /^\/processos-andamento\/\d+\/recurso\/interposicao$/,
  /^\/processos-andamento\/\d+\/recurso\/parecer$/,
  /^\/processos-andamento\/\d+\/recurso\/decisao-ii$/,
  // Consulta Unificada (somente leitura) e os filtros da tela.
  /^\/consulta-unificada$/,
  /^\/consulta-unificada\/(agentes|situacoes|fases)$/,
  // Exportação para BI (JSON ou CSV).
  /^\/exportacao\/(processos|eventos|fases|prazos)$/,
  // Painel de medidas cautelares.
  /^\/cautelares$/,
  /^\/cautelares\/resumo$/,
  /^\/cautelares\/\d+$/,
  /^\/cautelares\/\d+\/(aprovar|recusar|renovar|revogar|assinatura-concluida)$/,
  /^\/cautelares\/\d+\/certidao(-desbloqueio)?$/,
  // Biblioteca: acervo de referência, com PDF anexado e versionamento.
  /^\/biblioteca$/,
  /^\/biblioteca\/(classificacoes|temas)$/,
  /^\/biblioteca\/\d+$/,
  /^\/biblioteca\/\d+\/arquivo$/,
  /^\/biblioteca\/\d+\/versoes$/,
  /^\/biblioteca\/\d+\/versoes\/\d+\/restaurar$/,
  // Pesquisa global do cabeçalho.
  /^\/busca$/,
  /*
    Documentos do SEI: listagem, leitura e download.

    Repare no que NÃO está aqui: `/caixa-entrada/\d+/documentos/download-todos`
    e `/processos-andamento/\d+/documentos/download-todos` continuam no Python,
    porque geram ZIP e PDF unificado. Por isso o primeiro padrão termina em `$` —
    sem a âncora, ele engoliria o download-todos e o ZIP passaria a responder 404.
  */
  /^\/caixa-entrada\/\d+\/documentos$/,
  /^\/documentos\/[^/]+\/conteudo$/,
  /^\/documentos\/[^/]+\/download$/,
];

@Injectable()
export class LegacyProxyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(LegacyProxyMiddleware.name);
  private readonly proxy: RequestHandler;

  constructor() {
    // 8080 é a porta que o uvicorn usa no dia a dia (ver scripts/dev-start.sh).
    const alvo = process.env.LEGACY_API_URL ?? "http://localhost:8080";

    this.logger.log(
      `Ponte de migração ativa: caminhos /api não migrados vão para ${alvo}. ` +
        `Rotas já no NestJS: ${ROTAS_MIGRADAS.length}.`,
    );

    this.proxy = createProxyMiddleware({
      target: alvo,
      changeOrigin: true,
      // O FastAPI também expõe as rotas sob /api, então o caminho é preservado.
      pathRewrite: undefined,
      // Repassa o corpo da requisição sem bufferizar duas vezes.
      on: {
        error: (erro, _req, res) => {
          this.logger.error(`Falha ao repassar para o backend legado: ${erro.message}`);
          const resposta = res as Response;
          if (!resposta.headersSent) {
            resposta.status(502).json({
              message:
                "Backend legado indisponível. Verifique se o FastAPI está no ar.",
            });
          }
        },
      },
    });
  }

  use(req: Request, res: Response, next: NextFunction) {
    /*
      Usa originalUrl, NÃO req.path.

      O middleware é montado em "*", e o Express remove do req.path o trecho que
      casou com o ponto de montagem, guardando-o em req.baseUrl. Como o curinga
      casa o caminho inteiro, req.path virava "/" em toda requisição: a
      comparação com "/api" nunca dava certo, nada era repassado e o FastAPI
      parecia não existir. O sintoma era 404 — resposta plausível de API, que
      parece rota inexistente e não ponte inoperante.

      originalUrl preserva o caminho como chegou, então não depende de onde o
      middleware foi montado.
    */
    const caminhoCompleto = req.originalUrl.split("?")[0];

    // Só caminhos de API interessam. /health e qualquer coisa fora de /api
    // seguem para o Nest — inclusive porque o healthcheck do contêiner consulta
    // /health e não pode depender do FastAPI estar no ar.
    if (!caminhoCompleto.startsWith("/api")) {
      return next();
    }

    const caminho = caminhoCompleto.slice("/api".length);

    if (ROTAS_MIGRADAS.some((rota) => rota.test(caminho))) {
      return next();
    }

    this.logger.debug(`Repassando ao FastAPI: ${req.method} ${caminhoCompleto}`);
    return this.proxy(req, res, next);
  }
}
