import { Injectable, Logger } from "@nestjs/common";

/**
 * Configuração de conexão com o SEI, lida das variáveis de ambiente.
 *
 * Não valida no construtor de propósito: o app tem domínios que não tocam o SEI
 * (biblioteca, usuários, auditoria) e precisa subir sem as credenciais em
 * ambiente de desenvolvimento. Quem exige a configuração é `exigirConfigurado()`,
 * chamado na primeira requisição ao SEI — assim a falta de credencial vira erro
 * claro no endpoint que precisava dela, e não uma API que não inicia.
 */
@Injectable()
export class SeiConfigService {
  private readonly logger = new Logger(SeiConfigService.name);

  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly apiBase: string;
  readonly siglaSistema: string;
  readonly identificacaoServico: string;
  readonly traceId: string;

  constructor() {
    this.tokenUrl = process.env.SEI_TOKEN_URL?.trim() ?? "";
    this.clientId = process.env.SEI_CLIENT_ID?.trim() ?? "";
    this.clientSecret = process.env.SEI_CLIENT_SECRET?.trim() ?? "";
    // Sem barra no fim: os caminhos são montados com "/" na frente, e a barra
    // dupla faz o SEI responder 404.
    this.apiBase = (process.env.SEI_API_BASE?.trim() ?? "").replace(/\/+$/, "");
    this.siglaSistema = process.env.SEI_SIGLA_SISTEMA?.trim() ?? "";
    this.identificacaoServico =
      process.env.SEI_IDENTIFICACAO_SERVICO?.trim() ?? "";
    this.traceId = process.env.SEI_TRACE_ID?.trim() ?? "";

    if (!this.configurado) {
      this.logger.warn(
        "Integração com o SEI não configurada. Endpoints que dependem do SEI " +
          "vão responder erro claro até que SEI_CLIENT_ID, SEI_CLIENT_SECRET, " +
          "SEI_TOKEN_URL e SEI_API_BASE sejam preenchidos.",
      );
    }
  }

  get configurado(): boolean {
    return Boolean(
      this.tokenUrl && this.clientId && this.clientSecret && this.apiBase,
    );
  }

  /**
   * Host do SEI para cada API, derivado de `SEI_API_BASE`.
   *
   * O SEI publica três hosts com o mesmo padrão de nome, mudando só o trecho do
   * meio: `sei-processos`, `sei-documentos` e `sei-parametros`. Configurar um só
   * e derivar os outros evita três variáveis de ambiente que precisariam ser
   * mantidas em sincronia — e apontar uma delas para o ambiente errado, como
   * homologação com produção, é o tipo de erro que passa desapercebido até
   * alguém consultar um documento que "não existe".
   *
   * Se algum dia os hosts deixarem de seguir o padrão, aqui é o lugar de
   * introduzir variáveis próprias.
   */
  baseDa(api: "processos" | "documentos" | "parametros"): string {
    if (api === "processos") return this.apiBase;

    return this.apiBase.replace("sei-processos", `sei-${api}`);
  }

  /**
   * Garante que a integração está configurada.
   *
   * A mensagem lista o que falta em vez de dizer só "não configurado": quem
   * recebe o erro precisa saber qual variável preencher.
   */
  exigirConfigurado(): void {
    if (this.configurado) return;

    const faltando: string[] = [];
    if (!this.tokenUrl) faltando.push("SEI_TOKEN_URL");
    if (!this.clientId) faltando.push("SEI_CLIENT_ID");
    if (!this.clientSecret) faltando.push("SEI_CLIENT_SECRET");
    if (!this.apiBase) faltando.push("SEI_API_BASE");

    throw new Error(
      `Integração com o SEI não configurada. Falta preencher no .env: ${faltando.join(", ")}.`,
    );
  }
}
