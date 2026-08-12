import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../shared/prisma.service";
import { serializar, serializarData, type ValorCelula } from "./csv";

/** Uma exportação: as colunas na ordem e as linhas já serializadas. */
export interface Exportacao {
  campos: readonly string[];
  linhas: Record<string, ValorCelula>[];
  arquivo: string;
}

/**
 * Situações de triagem que representam processo já encaminhado.
 *
 * `pendente` fica de fora: item ainda em triagem não é processo, e incluí-lo
 * infla as contagens do BI com trabalho que talvez nem gere processo.
 */
const TRIAGEM_ENCAMINHADA = ["instaurado", "arquivado", "tac"];

/**
 * Exportações para BI (Power BI e análise externa).
 *
 * SEM PAGINAÇÃO de propósito: o consumidor é uma carga de dados, não uma tela.
 * Paginar obrigaria o BI a percorrer páginas e arriscaria carga parcial, que é
 * pior que carga demorada.
 */
@Injectable()
export class ExportacaoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Processos já encaminhados, com os campos usados nos relatórios. */
  async processos(): Promise<Exportacao> {
    const itens = await this.prisma.caixaEntrada.findMany({
      where: { statusTriagem: { in: TRIAGEM_ENCAMINHADA } },
      select: {
        id: true,
        numeroSei: true,
        numeroProcessoSei: true,
        razaoSocial: true,
        cnpjCpf: true,
        agenteRegulado: true,
        segmento: true,
        tipoDocumento: true,
        statusTriagem: true,
        dataRecebimento: true,
        dataInstauracao: true,
        idUnidadeSei: true,
      },
    });

    return {
      campos: [
        "id",
        "numero_sei",
        "numero_processo_sei",
        "razao_social",
        "cnpj_cpf",
        "agente_regulado",
        "segmento",
        "tipo_documento",
        "status_triagem",
        "data_recebimento",
        "data_instauracao",
        "id_unidade_sei",
      ],
      arquivo: "processos.csv",
      linhas: itens.map((i) => ({
        id: serializar(i.id),
        numero_sei: serializar(i.numeroSei),
        numero_processo_sei: serializar(i.numeroProcessoSei),
        razao_social: serializar(i.razaoSocial),
        cnpj_cpf: serializar(i.cnpjCpf),
        agente_regulado: serializar(i.agenteRegulado),
        segmento: serializar(i.segmento),
        tipo_documento: serializar(i.tipoDocumento),
        status_triagem: serializar(i.statusTriagem),
        data_recebimento: serializarData(i.dataRecebimento),
        data_instauracao: serializarData(i.dataInstauracao),
        id_unidade_sei: serializar(i.idUnidadeSei),
      })),
    };
  }

  /** Eventos de processo — rastreabilidade completa. */
  async eventos(): Promise<Exportacao> {
    const eventos = await this.prisma.eventoProcesso.findMany({
      orderBy: { criadoEm: "desc" },
      select: {
        id: true,
        caixaEntradaId: true,
        tipo: true,
        descricao: true,
        autor: true,
        criadoEm: true,
      },
    });

    return {
      campos: [
        "id",
        "caixa_entrada_id",
        "tipo",
        "descricao",
        "autor",
        "criado_em",
      ],
      arquivo: "eventos.csv",
      linhas: eventos.map((e) => ({
        id: serializar(e.id),
        caixa_entrada_id: serializar(e.caixaEntradaId),
        tipo: serializar(e.tipo),
        descricao: serializar(e.descricao),
        autor: serializar(e.autor),
        criado_em: serializar(e.criadoEm),
      })),
    };
  }

  /** Histórico de fases de todos os processos. */
  async fases(): Promise<Exportacao> {
    const fases = await this.prisma.faseProcessoAndamento.findMany({
      orderBy: { dataEntrada: "desc" },
      select: {
        id: true,
        caixaEntradaId: true,
        fase: true,
        dataEntrada: true,
        dataSaida: true,
        autor: true,
        observacao: true,
      },
    });

    return {
      campos: [
        "id",
        "caixa_entrada_id",
        "fase",
        "data_entrada",
        "data_saida",
        "autor",
        "observacao",
      ],
      arquivo: "fases.csv",
      linhas: fases.map((f) => ({
        id: serializar(f.id),
        caixa_entrada_id: serializar(f.caixaEntradaId),
        fase: serializar(f.fase),
        // data_entrada e data_saida guardam hora, então vão pelo serializar
        // completo — a duração da fase depende dela.
        data_entrada: serializar(f.dataEntrada),
        data_saida: serializar(f.dataSaida),
        autor: serializar(f.autor),
        observacao: serializar(f.observacao),
      })),
    };
  }

  /** Todos os prazos, para análise de cumprimento. */
  async prazos(): Promise<Exportacao> {
    const prazos = await this.prisma.prazoProcesso.findMany({
      orderBy: { criadoEm: "desc" },
      select: {
        id: true,
        caixaEntradaId: true,
        fase: true,
        dias: true,
        dataInicio: true,
        dataVencimento: true,
        reiniciado: true,
        status: true,
        dataResposta: true,
        registradoSei: true,
      },
    });

    return {
      campos: [
        "id",
        "caixa_entrada_id",
        "fase",
        "dias",
        "data_inicio",
        "data_vencimento",
        "reiniciado",
        "status",
        "data_resposta",
        "registrado_sei",
      ],
      arquivo: "prazos.csv",
      linhas: prazos.map((p) => ({
        id: serializar(p.id),
        caixa_entrada_id: serializar(p.caixaEntradaId),
        fase: serializar(p.fase),
        dias: serializar(p.dias),
        data_inicio: serializarData(p.dataInicio),
        data_vencimento: serializarData(p.dataVencimento),
        reiniciado: serializar(p.reiniciado),
        status: serializar(p.status),
        data_resposta: serializarData(p.dataResposta),
        registrado_sei: serializar(p.registradoSei),
      })),
    };
  }
}
