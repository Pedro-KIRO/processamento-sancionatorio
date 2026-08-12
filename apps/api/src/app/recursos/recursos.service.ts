import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma, RecursoProcesso } from "@prisma/client";

import { chaveDoDia, hojeEmSaoPaulo } from "../../shared/datas";
import { PrismaService } from "../../shared/prisma.service";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { fasesParaRetorno } from "../fases/fases";
import { PERFIL_CONSULTORIA_JURIDICA } from "../perfis/perfis";
import { PerfisService } from "../perfis/perfis.service";
import {
  calcularVencimento,
  diasRestantes,
  MATRIZ_PRAZOS,
  semaforo,
  tipoPorChave,
} from "../prazos/calculo-prazos";
import { PrazosService } from "../prazos/prazos.service";
import {
  DecisaoIIDto,
  InterposicaoDto,
  ParecerDto,
  PrazoRecursoResposta,
  RecursoResposta,
  RESULTADO_MANTIDA,
  RESULTADO_REFORMADA,
  RESULTADO_RETORNO,
} from "./dto/recurso.dto";

/**
 * Prazos abertos quando o recurso é interposto, na ordem do rito.
 *
 * Os três correm da mesma data (a interposição): reconsideração pela própria
 * autoridade (7 dias, art. 47, VI), julgamento pela autoridade recursal (30
 * dias, art. 47, VII) e o teto de decisão (120 dias, art. 50).
 */
const PRAZOS_DO_RECURSO = [
  "reconsideracao",
  "julgamento_recurso",
  "maximo_recurso",
] as const;

const ROTULOS_RESULTADO: Record<string, string> = {
  [RESULTADO_MANTIDA]: "Decisão I mantida",
  [RESULTADO_REFORMADA]: "Decisão I reformada",
};

@Injectable()
export class RecursosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perfis: PerfisService,
    private readonly prazos: PrazosService,
  ) {}

  // ==========================================================================
  // Consulta
  // ==========================================================================

  async obter(
    itemId: number,
    usuario: UsuarioAtualInfo,
  ): Promise<RecursoResposta> {
    await this.exigirItem(itemId);
    const recurso = await this.recursoMaisRecente(itemId);
    return this.montarSaida(itemId, recurso, usuario);
  }

  // ==========================================================================
  // Interposição
  // ==========================================================================

  /**
   * Registra se houve interposição de recurso.
   *
   * "Sim" abre os prazos do trâmite recursal. "Não" significa trânsito
   * administrativo, e o processo segue para o encerramento — por isso a resposta
   * negativa também é registrada, não só a positiva: sem ela não há como
   * distinguir "não recorreu" de "ainda não foi perguntado".
   */
  async registrarInterposicao(
    itemId: number,
    dados: InterposicaoDto,
    usuario: UsuarioAtualInfo,
  ): Promise<RecursoResposta> {
    await this.exigirItem(itemId);

    const autor = this.nomeDoAutor(usuario);
    const inicio = this.dataInformada(dados.data_interposicao);
    const atual = await this.recursoMaisRecente(itemId);

    // Recurso já decidido não é reaberto: um novo só nasce depois de retorno de
    // fase, quando o processo volta a percorrer o rito.
    const criarNovo = atual === null || Boolean(atual.decisaoResultado);

    const recurso = await this.prisma.$transaction(async (tx) => {
      const registro = criarNovo
        ? await tx.recursoProcesso.create({
            data: {
              caixaEntradaId: itemId,
              interposto: dados.interposto,
              dataInterposicao: dados.interposto ? inicio : null,
              registradoPor: autor,
            },
          })
        : await tx.recursoProcesso.update({
            where: { id: atual!.id },
            data: {
              interposto: dados.interposto,
              dataInterposicao: dados.interposto ? inicio : null,
              registradoPor: autor,
            },
          });

      if (dados.interposto) {
        await tx.eventoProcesso.create({
          data: {
            caixaEntradaId: itemId,
            tipo: "recurso_interposto",
            descricao: `Recurso interposto em ${this.formatarBr(inicio)} (art. 44).`,
            autor,
          },
        });
        await this.abrirPrazosDoRecurso(tx, itemId, inicio, autor);
      } else {
        await tx.eventoProcesso.create({
          data: {
            caixaEntradaId: itemId,
            tipo: "transito_administrativo",
            descricao:
              "Sem interposição de recurso: trânsito administrativo. " +
              "O processo segue para encerramento.",
            autor,
          },
        });
      }

      return registro;
    });

    return this.montarSaida(itemId, recurso, usuario);
  }

  // ==========================================================================
  // Parecer da Consultoria Jurídica
  // ==========================================================================

  async registrarParecer(
    itemId: number,
    dados: ParecerDto,
    usuario: UsuarioAtualInfo,
  ): Promise<RecursoResposta> {
    await this.exigirItem(itemId);

    const perfil = await this.perfis.resolver(usuario);
    if (
      perfil !== PERFIL_CONSULTORIA_JURIDICA &&
      !this.perfis.ehCoordenacao(perfil)
    ) {
      throw new ForbiddenException(
        "Somente a Consultoria Jurídica pode registrar o parecer do recurso.",
      );
    }

    const atual = await this.recursoMaisRecente(itemId);
    if (!atual?.interposto) {
      throw new ConflictException(
        "Não há recurso interposto neste processo para receber parecer.",
      );
    }

    const autor = this.nomeDoAutor(usuario);
    const numeroSei = dados.numero_sei ?? null;

    const recurso = await this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.recursoProcesso.update({
        where: { id: atual.id },
        data: {
          parecerNumeroSei: numeroSei,
          parecerResumo: dados.resumo ?? null,
          parecerEm: hojeEmSaoPaulo(),
          parecerPor: autor,
        },
      });

      await tx.eventoProcesso.create({
        data: {
          caixaEntradaId: itemId,
          tipo: "parecer_juridico",
          descricao:
            "Parecer da Consultoria Jurídica registrado" +
            (numeroSei ? ` (${numeroSei})` : "") +
            ".",
          autor,
        },
      });

      return atualizado;
    });

    return this.montarSaida(itemId, recurso, usuario);
  }

  // ==========================================================================
  // Decisão II
  // ==========================================================================

  /**
   * Registra a Decisão II: mantém, reforma ou devolve o processo a uma fase.
   *
   * O parecer da Consultoria Jurídica é obrigatório — o documento diz que a
   * Decisão II "deve considerar obrigatoriamente" o parecer, então decidir antes
   * dele é recusado.
   */
  async registrarDecisaoII(
    itemId: number,
    dados: DecisaoIIDto,
    usuario: UsuarioAtualInfo,
  ): Promise<RecursoResposta> {
    const item = await this.exigirItem(itemId);

    const perfil = await this.perfis.resolver(usuario);
    if (!this.perfis.ehCoordenacao(perfil)) {
      throw new ForbiddenException(
        "A Decisão II é proferida pela Coordenação (ou Coordenador Geral).",
      );
    }

    const atual = await this.recursoMaisRecente(itemId);
    if (!atual?.interposto) {
      throw new ConflictException("Não há recurso interposto neste processo.");
    }
    if (!atual.parecerEm) {
      throw new ConflictException(
        "A Decisão II deve considerar o parecer da Consultoria Jurídica. " +
          "Registre o parecer antes de decidir.",
      );
    }

    const ehRetorno = dados.resultado === RESULTADO_RETORNO;
    const faseRetorno = dados.fase_retorno ?? null;

    if (ehRetorno) {
      // 422 para casar com o backend Python, que usa esse status nas validações
      // de negócio.
      if (!faseRetorno) {
        throw new UnprocessableEntityException(
          "Informe a fase para a qual o processo retorna.",
        );
      }
      if (!fasesParaRetorno().includes(faseRetorno)) {
        throw new UnprocessableEntityException(
          `Fase inválida para retorno: ${faseRetorno}.`,
        );
      }
    }

    const autor = this.nomeDoAutor(usuario);
    const hoje = hojeEmSaoPaulo();
    const rotulo = ehRetorno
      ? `Retorno do processo à fase ${faseRetorno}`
      : ROTULOS_RESULTADO[dados.resultado];

    const recurso = await this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.recursoProcesso.update({
        where: { id: atual.id },
        data: {
          decisaoResultado: dados.resultado,
          decisaoFaseRetorno: ehRetorno ? faseRetorno : null,
          decisaoFundamentacao: dados.fundamentacao ?? null,
          decisaoEm: hoje,
          decisaoPor: autor,
        },
      });

      // Prazos do recurso deixam de correr quando a decisão sai.
      await tx.prazoProcesso.updateMany({
        where: {
          caixaEntradaId: itemId,
          fase: "recurso",
          status: "em_andamento",
        },
        data: { status: "respondido", dataResposta: hoje },
      });

      await tx.eventoProcesso.create({
        data: {
          caixaEntradaId: itemId,
          tipo: "decisao_proferida",
          descricao:
            `Decisão II: ${rotulo}.` +
            (atualizado.decisaoFundamentacao
              ? ` ${atualizado.decisaoFundamentacao}`
              : ""),
          autor,
        },
      });

      if (ehRetorno && faseRetorno) {
        // Fecha a fase aberta e reabre na fase indicada: o processo reentra no
        // fluxo ali, em vez de seguir para o encerramento.
        const aberta = await tx.faseProcessoAndamento.findFirst({
          where: { caixaEntradaId: itemId, dataSaida: null },
          orderBy: { dataEntrada: "desc" },
          select: { id: true },
        });

        if (aberta) {
          await tx.faseProcessoAndamento.update({
            where: { id: aberta.id },
            data: { dataSaida: new Date() },
          });
        }

        await tx.faseProcessoAndamento.create({
          data: {
            caixaEntradaId: itemId,
            fase: faseRetorno,
            autor,
            observacao: "Retorno determinado pela Decisão II",
          },
        });

        await tx.eventoProcesso.create({
          data: {
            caixaEntradaId: itemId,
            tipo: "fase_avancada",
            descricao: `Processo retornou à fase ${faseRetorno} por determinação da Decisão II.`,
            autor,
          },
        });
      }

      // Notificação para a unidade acompanhar o desfecho.
      await tx.notificacao.create({
        data: {
          caixaEntradaId: itemId,
          tipo: "decisao_ii",
          titulo: "Decisão II proferida",
          descricao:
            `Processo ${item.numeroProcessoSei || item.numeroSei || itemId}: ` +
            `${rotulo}.`,
        },
      });

      return atualizado;
    });

    return this.montarSaida(itemId, recurso, usuario);
  }

  // ==========================================================================
  // Apoio
  // ==========================================================================

  private async exigirItem(itemId: number) {
    const item = await this.prisma.caixaEntrada.findUnique({
      where: { id: itemId },
      select: { id: true, numeroSei: true, numeroProcessoSei: true },
    });

    if (!item) {
      throw new NotFoundException("Item da caixa de entrada não encontrado");
    }

    return item;
  }

  /**
   * Recurso mais recente do processo.
   *
   * Pode haver mais de um: depois de um retorno de fase determinado pela Decisão
   * II, o processo percorre o rito de novo e pode chegar a um segundo recurso.
   * O `id` desempata dentro do mesmo instante de criação.
   */
  private recursoMaisRecente(itemId: number): Promise<RecursoProcesso | null> {
    return this.prisma.recursoProcesso.findFirst({
      where: { caixaEntradaId: itemId },
      orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    });
  }

  private nomeDoAutor(usuario: UsuarioAtualInfo): string {
    return usuario.nome || usuario.email || "Sistema";
  }

  /** Data informada pela tela, ou hoje. */
  private dataInformada(valor?: string | null): Date {
    if (!valor) return hojeEmSaoPaulo();
    const data = new Date(`${valor}T00:00:00.000Z`);
    return Number.isNaN(data.getTime()) ? hojeEmSaoPaulo() : data;
  }

  private formatarBr(data: Date): string {
    const dia = String(data.getUTCDate()).padStart(2, "0");
    const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
    return `${dia}/${mes}/${data.getUTCFullYear()}`;
  }

  /**
   * Abre reconsideração (7d), julgamento (30d) e prazo máximo (120d).
   *
   * Não duplica: se um prazo com aquela duração já existe na fase de recurso,
   * é porque a interposição já foi registrada antes. Sem essa checagem, salvar
   * duas vezes criaria prazos repetidos e o painel mostraria seis linhas.
   */
  private async abrirPrazosDoRecurso(
    tx: Prisma.TransactionClient,
    itemId: number,
    inicio: Date,
    autor: string,
  ): Promise<void> {
    const existentes = await tx.prazoProcesso.findMany({
      where: { caixaEntradaId: itemId, fase: "recurso" },
      select: { dias: true },
    });

    const jaAbertos = new Set(existentes.map((p) => p.dias));
    const feriados = await this.prazos.carregarFeriados();

    for (const chave of PRAZOS_DO_RECURSO) {
      const tipo = tipoPorChave(chave);
      if (!tipo || jaAbertos.has(tipo.dias)) continue;

      await tx.prazoProcesso.create({
        data: {
          caixaEntradaId: itemId,
          fase: "recurso",
          dias: tipo.dias,
          dataInicio: inicio,
          dataVencimento: calcularVencimento(inicio, tipo.dias, feriados),
          status: "em_andamento",
          registradoSei: false,
        },
      });
    }

    await tx.eventoProcesso.create({
      data: {
        caixaEntradaId: itemId,
        tipo: "prazo_definido",
        descricao:
          "Prazos do recurso abertos: reconsideração (7 dias, art. 47, VI), " +
          "julgamento (30 dias, art. 47, VII) e prazo máximo de decisão " +
          "(120 dias, art. 50).",
        autor,
      },
    });
  }

  /** Prazos gravados da fase de recurso, casados com a matriz. */
  private async prazosDoRecurso(
    itemId: number,
  ): Promise<PrazoRecursoResposta[]> {
    const hoje = hojeEmSaoPaulo();

    const gravados = await this.prisma.prazoProcesso.findMany({
      where: { caixaEntradaId: itemId, fase: "recurso" },
    });

    return gravados
      .map((prazo) => {
        // A duração é o que identifica o tipo dentro da fase de recurso, que
        // tem quatro prazos distintos na matriz.
        const tipo = MATRIZ_PRAZOS.find(
          (t) => t.fase === "recurso" && t.dias === prazo.dias,
        );
        const restantes = diasRestantes(prazo.dataVencimento, hoje);

        return {
          chave: tipo?.chave ?? "recurso",
          rotulo: tipo?.rotulo ?? "Prazo do recurso",
          dias: prazo.dias,
          base_legal: tipo?.base_legal ?? "Art. 44",
          data_vencimento: prazo.dataVencimento
            ? chaveDoDia(prazo.dataVencimento)
            : null,
          dias_restantes: restantes,
          semaforo: semaforo(restantes),
        };
      })
      .sort((a, b) => a.dias - b.dias);
  }

  private async montarSaida(
    itemId: number,
    recurso: RecursoProcesso | null,
    usuario: UsuarioAtualInfo,
  ): Promise<RecursoResposta> {
    const perfil = await this.perfis.resolver(usuario);
    const coordenacao = this.perfis.ehCoordenacao(perfil);

    return {
      caixa_entrada_id: itemId,
      existe: recurso !== null,
      interposto: recurso?.interposto ?? null,
      data_interposicao: recurso?.dataInterposicao
        ? chaveDoDia(recurso.dataInterposicao)
        : null,
      registrado_por: recurso?.registradoPor ?? null,

      parecer_numero_sei: recurso?.parecerNumeroSei ?? null,
      parecer_em: recurso?.parecerEm ? chaveDoDia(recurso.parecerEm) : null,
      parecer_por: recurso?.parecerPor ?? null,
      parecer_resumo: recurso?.parecerResumo ?? null,

      decisao_resultado: recurso?.decisaoResultado ?? null,
      decisao_fase_retorno: recurso?.decisaoFaseRetorno ?? null,
      decisao_fundamentacao: recurso?.decisaoFundamentacao ?? null,
      decisao_em: recurso?.decisaoEm ? chaveDoDia(recurso.decisaoEm) : null,
      decisao_por: recurso?.decisaoPor ?? null,

      prazos: await this.prazosDoRecurso(itemId),
      fases_disponiveis: fasesParaRetorno(),

      // Registrar a interposição é ato de instrução: qualquer perfil da unidade
      // faz. Emitir parecer é da Consultoria Jurídica; decidir, da Coordenação.
      pode_registrar_interposicao: true,
      pode_emitir_parecer: perfil === PERFIL_CONSULTORIA_JURIDICA || coordenacao,
      pode_decidir: coordenacao,
    };
  }
}
