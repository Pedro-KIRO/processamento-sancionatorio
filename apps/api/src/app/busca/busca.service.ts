import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../shared/prisma.service";
import {
  classificar,
  LinhaBusca,
  RespostaBusca,
  semMascara,
  soDigitos,
} from "./dto/busca-resposta.dto";

/** Abaixo disto a pesquisa não roda: um caractere casaria com quase tudo. */
const MINIMO_CARACTERES = 2;

/** Teto de sugestões, mesmo se o cliente pedir mais. */
const LIMITE_MAXIMO = 50;

/**
 * Pesquisa global do cabeçalho.
 *
 * Procura relatórios e processos por número SEI, CNPJ/CPF ou razão social,
 * devolvendo os candidatos já classificados para o frontend sugerir e navegar
 * para a tela correta.
 *
 * POR QUE ESTE SERVICE USA SQL EM VEZ DO QUERY BUILDER
 *
 * A busca por número precisa ignorar a máscara nos DOIS lados: o usuário digita
 * `140.001/2024` ou `1400012024`, e a coluna guarda o valor com pontuação. Isso
 * exige aplicar uma função à coluna dentro do `WHERE`, e o `where` do Prisma só
 * compara coluna com valor — não sabe expressar `TRANSLATE(numero_sei, ...)`.
 *
 * A alternativa sem SQL seria trazer as linhas e filtrar em memória, o que numa
 * tabela de milhares de registros significa varrer tudo a cada tecla digitada
 * (o frontend consulta a cada 300 ms de digitação).
 *
 * Todos os valores vão parametrizados por `Prisma.sql`; nenhum trecho da
 * consulta é montado por concatenação de entrada do cliente.
 */
@Injectable()
export class BuscaService {
  constructor(private readonly prisma: PrismaService) {}

  async buscar(termoBruto: string, limite: number): Promise<RespostaBusca> {
    const termo = (termoBruto ?? "").trim();

    if (termo.length < MINIMO_CARACTERES) {
      return { termo, total: 0, resultados: [] };
    }

    const limiteEfetivo = Math.min(Math.max(limite, 1), LIMITE_MAXIMO);
    const termoSemMascara = semMascara(termo);
    const digitos = soDigitos(termo);

    const alternativas: Prisma.Sql[] = [
      Prisma.sql`LOWER(razao_social) LIKE ${`%${termo.toLowerCase()}%`}`,
    ];

    if (termoSemMascara) {
      const alvo = `%${termoSemMascara}%`;
      alternativas.push(Prisma.sql`${this.limpo("numero_sei")} LIKE ${alvo}`);
      alternativas.push(
        Prisma.sql`${this.limpo("numero_processo_sei")} LIKE ${alvo}`,
      );
    }

    /*
      Só compara documento quando o termo tem dígito. Sem esta guarda, pesquisar
      por nome compararia a coluna com '%%', que casa com qualquer valor não
      nulo — e a pesquisa por razão social devolveria a tabela inteira.
    */
    if (digitos) {
      alternativas.push(
        Prisma.sql`${this.limpo("cnpj_cpf")} LIKE ${`%${digitos}%`}`,
      );
    }

    const linhas = await this.prisma.$queryRaw<LinhaBusca[]>`
      SELECT id, numero_sei, numero_processo_sei, id_procedimento,
             id_procedimento_processo, razao_social, cnpj_cpf,
             agente_regulado, status_triagem
      FROM processamento.caixa_entrada
      WHERE ${Prisma.join(alternativas, " OR ")}
      ${this.ordenacao()}
      LIMIT ${limiteEfetivo}
    `;

    const resultados = linhas.map((linha) =>
      classificar(linha, termoSemMascara),
    );

    return { termo, total: resultados.length, resultados };
  }

  /**
   * Expressão da coluna sem a pontuação de máscara.
   *
   * `TRANSLATE(col, './- ', '')` descarta os quatro caracteres de uma vez:
   * quando o segundo conjunto é menor que o primeiro, o PostgreSQL remove os
   * caracteres sem correspondente. Equivale aos quatro `REPLACE` encadeados que
   * o FastAPI montava para funcionar também em SQLite, e aqui não há essa
   * restrição.
   *
   * O nome da coluna vem do tipo literal da assinatura, não do cliente — os
   * três valores possíveis estão declarados abaixo.
   */
  private limpo(
    coluna: "numero_sei" | "numero_processo_sei" | "cnpj_cpf",
  ): Prisma.Sql {
    return Prisma.raw(`TRANSLATE(${coluna}, './- ', '')`);
  }

  /**
   * Mais recentes primeiro, com os sem data no FIM.
   *
   * `NULLS LAST` não é enfeite: no SQLite, que é o banco em produção hoje, NULL
   * conta como o menor valor e `DESC` já o joga para o fim. No PostgreSQL o
   * padrão de `DESC` é `NULLS FIRST`, então a mesma SQL traria os itens sem data
   * de recebimento na frente — eles ocupariam as primeiras sugestões e
   * empurrariam as correspondências reais para fora do limite de 10.
   *
   * O `id` é desempate estável. O FastAPI não tinha nenhum, então itens com a
   * mesma data podiam trocar de posição entre duas consultas idênticas e mudar
   * qual deles caía dentro do limite.
   */
  private ordenacao(): Prisma.Sql {
    return Prisma.raw("ORDER BY data_recebimento DESC NULLS LAST, id DESC");
  }
}
