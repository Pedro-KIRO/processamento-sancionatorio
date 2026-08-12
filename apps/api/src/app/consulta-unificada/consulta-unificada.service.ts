import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { chaveDoDia } from "../../shared/datas";
import { PrismaService } from "../../shared/prisma.service";
import { FASES_PROCESSO } from "../fases/fases";
import {
  FiltrosConsulta,
  FONTE_FISCALIZACAO,
  FONTE_PROCESSAMENTO,
  LinhaConsulta,
  RespostaConsultaUnificada,
} from "./dto/consulta-unificada.dto";

/**
 * Colunas pelas quais a tela permite ordenar.
 *
 * A chave é o que vem na query string; o valor é a expressão SQL que ordena de
 * fato. É uma LISTA FECHADA de propósito — o nome da coluna entra na SQL sem
 * parametrização (não dá para parametrizar identificador), então aceitar valor
 * livre do cliente aqui seria injeção. Chave desconhecida cai em `criacao`.
 */
const COLUNAS_ORDENAVEIS: Record<string, string> = {
  criacao: "data_criacao_sei",
  ultima_acao: "data_ultima_acao",
  razao_social: "LOWER(razao_social)",
  /*
    Ordena pelo número SEM máscara: com pontuação, "140.001..." e "140.01..."
    saem fora de ordem, porque a comparação é caractere a caractere.
  */
  numero_sei: "numero_limpo",
  cnpj_cpf: "REPLACE(REPLACE(REPLACE(cnpj_cpf, '.', ''), '/', ''), '-', '')",
  agente: "LOWER(agente_regulado)",
  situacao: "LOWER(situacao)",
  fase: "fase_atual",
};

/** Linha crua vinda do SQL. */
interface LinhaCrua {
  id: number;
  tipo: string;
  numero_sei: string | null;
  id_procedimento: string | null;
  razao_social: string | null;
  cnpj_cpf: string | null;
  agente_regulado: string | null;
  municipio: string | null;
  ano: string | null;
  situacao: string | null;
  fase_atual: string | null;
  data_criacao_sei: Date | null;
  data_ultima_acao: Date | null;
  caixa_entrada_id: number | null;
}

/**
 * Tela "Consulta Unificada" — somente leitura.
 *
 * Os dados saem da tabela `consulta_unificada`, alimentada pela automação de
 * sincronização. Nada é consultado no SEI nem no SharePoint durante a
 * requisição: as datas exigidas pela tela vêm dos andamentos do SEI, uma chamada
 * por linha, e a lista tem cerca de 20 mil registros — buscá-las ao vivo
 * tornaria a tela inutilizável.
 *
 * POR QUE ESTE SERVICE USA SQL EM VEZ DO QUERY BUILDER
 *
 * A ordenação da tela precisa de `LOWER()` e de remoção de máscara com
 * `REPLACE` encadeado, e o `orderBy` do Prisma não expressa nenhum dos dois.
 * Como a paginação é feita no banco (a tabela é grande), ordenar em memória não
 * é alternativa: só a página estaria ordenada, e a ordem mudaria de página para
 * página.
 *
 * Todos os valores vão parametrizados via `Prisma.sql`. O único trecho
 * interpolado é o nome da coluna de ordenação, tirado da lista fechada acima.
 */
@Injectable()
export class ConsultaUnificadaService {
  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // Listagem
  // ==========================================================================

  async listar(
    filtros: FiltrosConsulta,
  ): Promise<RespostaConsultaUnificada> {
    const limite = Math.min(filtros.limit ?? 100, 200);
    const offset = Math.max(filtros.offset ?? 0, 0);

    const where = this.montarWhere(filtros);
    const ordenacao = this.montarOrdenacao(filtros.ordenar_por, filtros.ordem);

    const [contagem, linhas] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ total: bigint }[]>`
        SELECT COUNT(*)::bigint AS total
        FROM processamento.consulta_unificada
        ${where}
      `,
      this.prisma.$queryRaw<LinhaCrua[]>`
        SELECT id, tipo, numero_sei, id_procedimento, razao_social, cnpj_cpf,
               agente_regulado, municipio, ano, situacao, fase_atual,
               data_criacao_sei, data_ultima_acao, caixa_entrada_id
        FROM processamento.consulta_unificada
        ${where}
        ${ordenacao}
        LIMIT ${limite} OFFSET ${offset}
      `,
    ]);

    return {
      // COUNT devolve bigint no PostgreSQL, e bigint não sobrevive ao
      // JSON.stringify — sem a conversão, a resposta quebra com
      // "Do not know how to serialize a BigInt".
      total: Number(contagem[0]?.total ?? 0),
      limit: limite,
      offset,
      linhas: linhas.map((l) => this.paraLinha(l)),
    };
  }

  // ==========================================================================
  // Filtros da tela
  // ==========================================================================

  /** Agentes regulados distintos presentes na consulta. */
  async listarAgentes(tipo?: string, fonte?: string): Promise<string[]> {
    const where = this.montarWhere({ tipo, fonte }, [
      Prisma.sql`agente_regulado IS NOT NULL`,
    ]);

    const linhas = await this.prisma.$queryRaw<{ valor: string }[]>`
      SELECT DISTINCT agente_regulado AS valor
      FROM processamento.consulta_unificada
      ${where}
      ORDER BY valor
    `;

    return linhas.map((l) => l.valor).filter(Boolean);
  }

  /**
   * Situações distintas presentes na consulta.
   *
   * Respeita `tipo` e `fonte` para não oferecer opção impossível: filtrando só
   * relatórios, "Processo instaurado" não aparece, porque essa situação só
   * existe em linha de processo — e um filtro que devolve zero resultado sempre
   * parece defeito.
   */
  async listarSituacoes(tipo?: string, fonte?: string): Promise<string[]> {
    const where = this.montarWhere({ tipo, fonte }, [
      Prisma.sql`situacao IS NOT NULL`,
    ]);

    const linhas = await this.prisma.$queryRaw<{ valor: string }[]>`
      SELECT DISTINCT situacao AS valor
      FROM processamento.consulta_unificada
      ${where}
      ORDER BY valor
    `;

    return linhas.map((l) => l.valor).filter(Boolean);
  }

  /**
   * Fases presentes na consulta, na ORDEM OFICIAL do processo.
   *
   * Só linha de processo tem fase. A ordem vem de FASES_PROCESSO para o filtro
   * seguir a sequência do rito, e não a ordem alfabética — que colocaria
   * "aguardando_defesa" antes de "instauracao".
   */
  async listarFases(tipo?: string, fonte?: string): Promise<string[]> {
    const where = this.montarWhere({ tipo, fonte }, [
      Prisma.sql`fase_atual IS NOT NULL`,
    ]);

    const linhas = await this.prisma.$queryRaw<{ valor: string }[]>`
      SELECT DISTINCT fase_atual AS valor
      FROM processamento.consulta_unificada
      ${where}
    `;

    const presentes = new Set(linhas.map((l) => l.valor).filter(Boolean));
    const oficiais = FASES_PROCESSO.filter((f) => presentes.has(f));

    // Fase gravada fora da lista oficial (não deveria acontecer) vai para o fim
    // em vez de desaparecer do filtro — sumir esconderia registro do usuário.
    const forasteiras = [...presentes]
      .filter((f) => !(FASES_PROCESSO as readonly string[]).includes(f))
      .sort();

    return [...oficiais, ...forasteiras];
  }

  // ==========================================================================
  // Apoio
  // ==========================================================================

  private soDigitos(texto: string): string {
    return texto.replace(/\D/g, "");
  }

  /**
   * Condições de `tipo` e `fonte`, compartilhadas pela lista e pelos filtros.
   * O vínculo com a caixa de entrada é o que distingue a fonte.
   */
  private condicoesDeRecorte(
    tipo?: string,
    fonte?: string,
  ): Prisma.Sql[] {
    const condicoes: Prisma.Sql[] = [];

    if (tipo) {
      condicoes.push(Prisma.sql`tipo = ${tipo}`);
    }
    if (fonte === FONTE_FISCALIZACAO) {
      condicoes.push(Prisma.sql`caixa_entrada_id IS NULL`);
    } else if (fonte === FONTE_PROCESSAMENTO) {
      condicoes.push(Prisma.sql`caixa_entrada_id IS NOT NULL`);
    }

    return condicoes;
  }

  private montarWhere(
    filtros: FiltrosConsulta,
    extras: Prisma.Sql[] = [],
  ): Prisma.Sql {
    const condicoes: Prisma.Sql[] = [
      ...extras,
      ...this.condicoesDeRecorte(filtros.tipo, filtros.fonte),
    ];

    if (filtros.busca?.trim()) {
      const termo = filtros.busca.trim();
      const digitos = this.soDigitos(termo);
      const alvoTexto = `%${termo.toLowerCase()}%`;

      const alternativas: Prisma.Sql[] = [
        Prisma.sql`LOWER(razao_social) LIKE ${alvoTexto}`,
      ];

      // Só busca por número quando há dígito no termo: sem isso, buscar por
      // nome faria a comparação numérica com string vazia casar com tudo.
      if (digitos) {
        const alvoNumero = `%${digitos}%`;
        alternativas.push(Prisma.sql`numero_limpo LIKE ${alvoNumero}`);
        alternativas.push(
          Prisma.sql`REPLACE(REPLACE(REPLACE(cnpj_cpf, '.', ''), '/', ''), '-', '') LIKE ${alvoNumero}`,
        );
      }

      condicoes.push(
        Prisma.sql`(${Prisma.join(alternativas, " OR ")})`,
      );
    }

    if (filtros.agente) {
      condicoes.push(Prisma.sql`agente_regulado = ${filtros.agente}`);
    }
    if (filtros.situacao) {
      condicoes.push(Prisma.sql`situacao = ${filtros.situacao}`);
    }
    if (filtros.fase) {
      condicoes.push(Prisma.sql`fase_atual = ${filtros.fase}`);
    }
    if (filtros.ano) {
      condicoes.push(Prisma.sql`ano = ${filtros.ano}`);
    }

    this.adicionarIntervalo(
      condicoes,
      "data_criacao_sei",
      filtros.criacao_de,
      filtros.criacao_ate,
    );
    this.adicionarIntervalo(
      condicoes,
      "data_ultima_acao",
      filtros.acao_de,
      filtros.acao_ate,
    );

    if (condicoes.length === 0) {
      return Prisma.empty;
    }

    return Prisma.sql`WHERE ${Prisma.join(condicoes, " AND ")}`;
  }

  private adicionarIntervalo(
    condicoes: Prisma.Sql[],
    coluna: "data_criacao_sei" | "data_ultima_acao",
    de?: string,
    ate?: string,
  ): void {
    // O nome da coluna vem de um tipo literal, não do cliente — os dois únicos
    // valores possíveis estão na assinatura.
    const campo =
      coluna === "data_criacao_sei"
        ? Prisma.sql`data_criacao_sei`
        : Prisma.sql`data_ultima_acao`;

    if (de) {
      condicoes.push(Prisma.sql`${campo} >= ${new Date(`${de}T00:00:00.000Z`)}`);
    }
    if (ate) {
      condicoes.push(Prisma.sql`${campo} <= ${new Date(`${ate}T00:00:00.000Z`)}`);
    }
  }

  /**
   * Cláusula de ordenação, sempre com os vazios no FIM.
   *
   * Nulo não pode ser tratado como "o menor": linha sem data de criação
   * apareceria como a mais antiga, e linha sem fase, antes de todas as fases.
   * `NULLS LAST` resolve nas duas direções.
   *
   * O `id` no fim é desempate estável — sem ele, linhas com o mesmo valor na
   * coluna ordenada podem trocar de posição entre páginas, e a paginação repete
   * ou perde registro.
   */
  private montarOrdenacao(ordenarPor?: string, ordem?: string): Prisma.Sql {
    const coluna =
      COLUNAS_ORDENAVEIS[ordenarPor ?? ""] ?? COLUNAS_ORDENAVEIS.criacao;
    const direcao = (ordem ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

    return Prisma.raw(`ORDER BY ${coluna} ${direcao} NULLS LAST, id ASC`);
  }

  private paraLinha(linha: LinhaCrua): LinhaConsulta {
    return {
      id: linha.id,
      tipo: linha.tipo,
      // Propriedade calculada: no modelo Python é `ConsultaUnificada.fonte`.
      fonte: linha.caixa_entrada_id ? FONTE_PROCESSAMENTO : FONTE_FISCALIZACAO,
      numero_sei: linha.numero_sei,
      id_procedimento: linha.id_procedimento,
      razao_social: linha.razao_social,
      cnpj_cpf: linha.cnpj_cpf,
      agente_regulado: linha.agente_regulado,
      municipio: linha.municipio,
      ano: linha.ano,
      situacao: linha.situacao,
      fase_atual: linha.fase_atual,
      data_criacao_sei: linha.data_criacao_sei
        ? chaveDoDia(linha.data_criacao_sei)
        : null,
      data_ultima_acao: linha.data_ultima_acao
        ? chaveDoDia(linha.data_ultima_acao)
        : null,
      caixa_entrada_id: linha.caixa_entrada_id,
    };
  }
}
