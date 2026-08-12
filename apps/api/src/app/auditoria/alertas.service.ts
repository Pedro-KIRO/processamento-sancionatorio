import { Injectable } from "@nestjs/common";

import { hojeEmSaoPaulo, somarDias } from "../../shared/datas";
import { PrismaService } from "../../shared/prisma.service";
import { diasDoTipo, DIAS_VERDE } from "../prazos/calculo-prazos";
import type { Alerta, Severidade } from "./dto/auditoria.dto";

/** Dias sem movimentação que caracterizam morosidade (regra de gestão). */
const DIAS_SEM_MOVIMENTACAO = diasDoTipo("sem_movimentacao", 15);

/** Dias que o termo de encerramento pode ficar assinado sem conclusão. */
const DIAS_ENCERRAMENTO = diasDoTipo("encerramento_sem_conclusao", 2);

/** Teto da amostra de ids devolvida em cada alerta. */
const LIMITE_AMOSTRA = 50;

/**
 * Os oito alertas internos das regras transversais (Documentação de Negócio v3.0).
 *
 * São calculados na hora, não gravados: o que importa é a pendência de agora, e
 * um alerta gravado viraria mentira no instante seguinte ao usuário resolver o
 * caso.
 *
 * São de acompanhamento gerencial — apontam pendência, não disparam ação
 * automática.
 */
@Injectable()
export class AlertasService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<Alerta[]> {
    const hoje = hojeEmSaoPaulo();
    const agora = new Date();

    const [
      vencidos,
      proximos,
      parados,
      cautelares,
      recursos,
      aguardandoAssinatura,
      encerrando,
    ] = await Promise.all([
      this.prazosVencidos(hoje),
      this.prazosAVencer(hoje),
      this.processosParados(agora),
      this.cautelaresVigentes(),
      this.recursosPendentes(),
      this.certidoesAguardandoAssinatura(),
      this.encerramentoSemConclusao(agora),
    ]);

    const vencendoCautelar: number[] = [];
    const vencidasCautelar: number[] = [];
    const limiteProximo = somarDias(hoje, DIAS_VERDE - 1);

    for (const c of cautelares) {
      if (!c.caixaEntradaId || !c.dataFim) continue;
      if (c.dataFim < hoje) {
        vencidasCautelar.push(c.caixaEntradaId);
      } else if (c.dataFim <= limiteProximo) {
        vencendoCautelar.push(c.caixaEntradaId);
      }
    }

    return [
      this.montar(
        "prazos_vencidos",
        "Prazos vencidos",
        "alta",
        "Prazos em andamento cujo vencimento já passou.",
        vencidos,
      ),
      this.montar(
        "prazos_a_vencer",
        `Prazos vencendo em até ${DIAS_VERDE - 1} dias`,
        "media",
        "Prazos no dia do vencimento ou a até 3 dias dele.",
        proximos,
      ),
      this.montar(
        "sem_movimentacao",
        `Processos sem movimentação há mais de ${DIAS_SEM_MOVIMENTACAO} dias`,
        "alta",
        "Alerta de morosidade para o controle interno.",
        parados,
      ),
      this.montar(
        "cautelares_vencendo",
        "Cautelares vencendo",
        "media",
        "Medidas cautelares a vencer em até 3 dias, que exigem renovação ou revogação.",
        vencendoCautelar,
      ),
      this.montar(
        "cautelares_vencidas",
        "Cautelares vencidas sem renovação",
        "alta",
        "O agente segue bloqueado sem medida vigente que sustente o bloqueio.",
        vencidasCautelar,
      ),
      this.montar(
        "recursos_pendentes",
        "Recursos pendentes de decisão",
        "media",
        "Recursos interpostos aguardando parecer jurídico ou Decisão II.",
        recursos,
      ),
      this.montar(
        "aguardando_assinatura",
        "Documentos aguardando assinatura",
        "media",
        "Certidões de bloqueio ou desbloqueio criadas e ainda não assinadas no SEI.",
        aguardandoAssinatura,
      ),
      this.montar(
        "encerramento_sem_conclusao",
        `Encerramento assinado há mais de ${DIAS_ENCERRAMENTO} dias sem conclusão`,
        "media",
        "O termo de encerramento foi assinado, mas o processo não foi concluído no SEI.",
        encerrando,
      ),
    ];
  }

  /**
   * Monta o alerta, removendo ids repetidos e preservando a ordem.
   *
   * `total` conta os ids DISTINTOS, não o tamanho da amostra: um processo com
   * três prazos vencidos é um processo pendente, não três.
   */
  private montar(
    chave: string,
    rotulo: string,
    severidade: Severidade,
    descricao: string,
    ids: number[],
  ): Alerta {
    const distintos = [...new Set(ids)];

    return {
      chave,
      rotulo,
      total: distintos.length,
      severidade,
      descricao,
      itens: distintos.slice(0, LIMITE_AMOSTRA),
    };
  }

  /*
    NOTA SOBRE OS "JOINS" DO BACKEND PYTHON

    Lá toda consulta de alerta juntava com `caixa_entrada`, e o comentário
    explicava o motivo: a automação de limpeza remove itens que saíram do filtro
    da caixa e deixava prazos e cautelares órfãos para trás — sem o join, o
    alerta apontava vencidos de processos que já não existiam no app, um falso
    alarme que ninguém conseguia resolver.

    No PostgreSQL com o schema do Prisma isso deixou de ser possível: as chaves
    estrangeiras são declaradas e o banco recusa filho sem pai. O SQLite do
    ambiente antigo não impunha a restrição, e era daí que vinham os órfãos.

    Por isso as consultas abaixo não têm o join — a integridade agora é do banco.
    Se algum dia a restrição for afrouxada, o join tem de voltar.
  */

  /** 1 — prazos em andamento cujo vencimento já passou. */
  private async prazosVencidos(hoje: Date): Promise<number[]> {
    const linhas = await this.prisma.prazoProcesso.findMany({
      // Só "em_andamento": "decurso" é prazo já tratado, e apontá-lo aqui
      // repetiria como pendência algo que a equipe já resolveu.
      where: { status: "em_andamento", dataVencimento: { lt: hoje } },
      select: { caixaEntradaId: true },
    });

    return linhas.map((l) => l.caixaEntradaId);
  }

  /** 2 — prazos no dia do vencimento ou até 3 dias dele. */
  private async prazosAVencer(hoje: Date): Promise<number[]> {
    const linhas = await this.prisma.prazoProcesso.findMany({
      where: {
        status: "em_andamento",
        dataVencimento: { gte: hoje, lte: somarDias(hoje, DIAS_VERDE - 1) },
      },
      select: { caixaEntradaId: true },
    });

    return linhas.map((l) => l.caixaEntradaId);
  }

  /** 3 — processos instaurados sem evento recente (morosidade). */
  private async processosParados(agora: Date): Promise<number[]> {
    const corte = somarDias(agora, -DIAS_SEM_MOVIMENTACAO);

    const linhas = await this.prisma.caixaEntrada.findMany({
      where: {
        statusTriagem: "instaurado",
        // "nenhum evento a partir do corte" é o mesmo que o NOT IN do Python.
        eventos: { none: { criadoEm: { gte: corte } } },
      },
      select: { id: true },
    });

    return linhas.map((l) => l.id);
  }

  /** 4 e 5 — cautelares que ainda sustentam bloqueio. */
  private async cautelaresVigentes(): Promise<
    { caixaEntradaId: number | null; dataFim: Date | null }[]
  > {
    return this.prisma.cautelar.findMany({
      // Renovada e revogada saem: a primeira foi substituída por outra, a
      // segunda encerrou o bloqueio.
      where: {
        OR: [
          { situacao: null },
          { situacao: { notIn: ["renovada", "revogada"] } },
        ],
      },
      select: { caixaEntradaId: true, dataFim: true },
    });
  }

  /** 6 — recursos interpostos ainda sem Decisão II. */
  private async recursosPendentes(): Promise<number[]> {
    const linhas = await this.prisma.recursoProcesso.findMany({
      where: { interposto: true, decisaoResultado: null },
      select: { caixaEntradaId: true },
    });

    return linhas.map((l) => l.caixaEntradaId);
  }

  /** 7 — certidões criadas e ainda não assinadas no SEI. */
  private async certidoesAguardandoAssinatura(): Promise<number[]> {
    const linhas = await this.prisma.cautelar.findMany({
      where: { pendenteAssinatura: true, caixaEntradaId: { not: null } },
      select: { caixaEntradaId: true },
    });

    return linhas
      .map((l) => l.caixaEntradaId)
      .filter((id): id is number => id !== null);
  }

  /** 8 — fase de encerramento aberta há mais tempo que o tolerado. */
  private async encerramentoSemConclusao(agora: Date): Promise<number[]> {
    const corte = somarDias(agora, -DIAS_ENCERRAMENTO);

    const linhas = await this.prisma.faseProcessoAndamento.findMany({
      where: {
        fase: "encerramento",
        // dataSaida nula = fase ainda aberta.
        dataSaida: null,
        dataEntrada: { lte: corte },
      },
      select: { caixaEntradaId: true },
    });

    return linhas.map((l) => l.caixaEntradaId);
  }
}
