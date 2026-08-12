import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { chaveDoDia, hojeEmSaoPaulo } from "../../shared/datas";
import { PrismaService } from "../../shared/prisma.service";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PerfisService } from "../perfis/perfis.service";
import {
  AMARELO,
  CorSemaforo,
  diasRestantes,
  MATRIZ_PRAZOS,
  ROTULOS_SEMAFORO,
  rotuloDoPrazo,
  rotuloRestante,
  semaforo,
  tipoPorChave,
  tipoPorFase,
  VERDE,
  VERMELHO,
} from "./calculo-prazos";
import type {
  FiltrosPrazos,
  PrazoLinha,
  RespostaPrazos,
} from "./dto/prazo.dto";

/**
 * Status de prazo que continuam pedindo ação.
 *
 * `decurso` entra porque o prazo venceu e ainda há o que fazer (certidão,
 * edital) — sumir da tela esconderia justamente o caso mais urgente.
 */
const STATUS_ATIVOS = ["em_andamento", "decurso"];

/** Registro do banco com o item e o responsável já carregados. */
type PrazoComRelacoes = Prisma.PrazoProcessoGetPayload<{
  include: {
    caixaEntrada: {
      include: { responsavel: { select: { nome: true; email: true } } };
    };
  };
}>;

@Injectable()
export class PrazosService {
  private readonly logger = new Logger(PrazosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly perfis: PerfisService,
  ) {}

  /**
   * Calendário de dias sem expediente, como conjunto de chaves "AAAA-MM-DD".
   *
   * Carregado de uma vez e repassado ao cálculo, para não consultar o banco uma
   * vez por prazo quando vários vencimentos são calculados no mesmo fluxo (a
   * abertura dos prazos do recurso calcula três de uma vez).
   */
  async carregarFeriados(): Promise<Set<string>> {
    try {
      const feriados = await this.prisma.feriado.findMany({
        select: { data: true },
      });

      return new Set(feriados.map((f) => chaveDoDia(f.data)));
    } catch (erro) {
      /*
        Falha de leitura NÃO interrompe o cálculo — mesma escolha do backend
        Python. Sem o calendário a contagem apenas deixa de prorrogar o
        vencimento para dia útil, o que é bem melhor que derrubar a listagem de
        prazos inteira: a tela continua útil, com no máximo um dia de diferença
        em vencimento que caia em feriado.
      */
      this.logger.error(
        "Não foi possível carregar o calendário de feriados; a contagem segue " +
          `sem prorrogação para dia útil. Motivo: ${
            erro instanceof Error ? erro.message : erro
          }`,
      );
      return new Set<string>();
    }
  }

  /** Matriz de prazos: alimenta o filtro "Tipo de prazo" e a tela de parâmetros. */
  listarTipos() {
    return MATRIZ_PRAZOS.map((t) => ({
      chave: t.chave,
      rotulo: t.rotulo,
      dias: t.dias,
      base_legal: t.base_legal,
      gatilho: t.gatilho,
      no_vencimento: t.no_vencimento,
      fase: t.fase ?? null,
      gerencial: t.gerencial ?? false,
    }));
  }

  /** Responsáveis com processo atribuído, para o filtro da tela. */
  async listarResponsaveis(): Promise<{ id: number; nome: string }[]> {
    const usuarios = await this.prisma.usuario.findMany({
      where: { caixasResponsavel: { some: {} } },
      select: { id: true, nome: true, email: true },
    });

    return usuarios.map((u) => ({ id: u.id, nome: u.nome || u.email }));
  }

  async listar(
    filtros: FiltrosPrazos,
    usuario: UsuarioAtualInfo,
  ): Promise<RespostaPrazos> {
    const hoje = hojeEmSaoPaulo();
    const perfil = await this.perfis.resolver(usuario);

    const where: Prisma.PrazoProcessoWhereInput = {
      status: { in: STATUS_ATIVOS },
    };

    const condicoesDoItem: Prisma.CaixaEntradaWhereInput = {};

    // Analista vê só a própria unidade; coordenação vê tudo. Mesma regra da tela
    // de Processos em Andamento ("Acesso por perfil e unidade" do documento).
    if (!this.perfis.ehCoordenacao(perfil)) {
      const unidade = await this.unidadeDoUsuario(usuario);
      if (unidade) {
        condicoesDoItem.idUnidadeSei = unidade;
      }
    }

    if (filtros.agente) {
      condicoesDoItem.agenteRegulado = filtros.agente;
    }
    if (filtros.responsavel_id) {
      condicoesDoItem.responsavelId = filtros.responsavel_id;
    }
    if (filtros.priorizados) {
      condicoesDoItem.prioritario = true;
    }
    if (Object.keys(condicoesDoItem).length > 0) {
      where.caixaEntrada = condicoesDoItem;
    }

    if (filtros.tipo) {
      const alvo = tipoPorChave(filtros.tipo);
      if (alvo) {
        // A fase é o que está gravado no prazo; a duração desempata quando a
        // fase serve a mais de um tipo (defesa comum e por edital, recurso e
        // julgamento do recurso).
        if (alvo.fase) where.fase = alvo.fase;
        where.dias = alvo.dias;
      }
    }

    if (filtros.venc_de || filtros.venc_ate) {
      where.dataVencimento = {
        ...(filtros.venc_de ? { gte: new Date(`${filtros.venc_de}T00:00:00.000Z`) } : {}),
        ...(filtros.venc_ate ? { lte: new Date(`${filtros.venc_ate}T00:00:00.000Z`) } : {}),
      };
    }

    /*
      Sem LIMIT na consulta, de propósito — o backend Python também materializa
      todas as linhas antes de contar.

      É necessário porque os cartões de resumo contam o universo filtrado SEM o
      filtro de situação: eles servem de filtro rápido, então precisam continuar
      mostrando quantos itens existem em cada cor depois de o usuário clicar em
      uma delas. E a cor não está no banco — sai do semáforo, calculado a partir
      da data de vencimento. Contar no banco exigiria replicar a regra em SQL,
      com risco de divergir do módulo de cálculo.

      O volume é limitado por STATUS_ATIVOS (só prazos que ainda pedem ação) e
      pela unidade do usuário.
    */
    const registros = await this.prisma.prazoProcesso.findMany({
      where,
      include: {
        caixaEntrada: {
          include: { responsavel: { select: { nome: true, email: true } } },
        },
      },
      // Priorizados primeiro, depois o mais urgente: é a ordem de trabalho
      // pedida no documento.
      orderBy: [
        { caixaEntrada: { prioritario: "desc" } },
        { dataVencimento: "asc" },
      ],
    });

    /*
      A busca é aplicada em memória porque precisa comparar número do SEI e
      CPF/CNPJ SEM máscara, e o Prisma não expõe REPLACE encadeado no filtro.

      Filtra os REGISTROS, não as linhas já montadas: a linha guarda só um
      número (`numeroProcessoSei || numeroSei`), enquanto a busca tem de olhar os
      dois campos separadamente. Buscando pela linha, quem digitasse o número do
      relatório de fiscalização de um processo já instaurado não encontraria
      nada — a linha teria só o número do processo novo.
    */
    const filtrados = filtros.busca?.trim()
      ? registros.filter((r) => this.casaComBusca(r, filtros.busca!))
      : registros;

    let linhas = filtrados.map((r) => this.montarLinha(r, hoje));

    // Resumo ANTES do filtro de situação — ver comentário acima.
    const resumo = {
      vencidos: linhas.filter((l) => l.semaforo === VERMELHO).length,
      vence_em_3_dias: linhas.filter((l) => l.semaforo === AMARELO).length,
      no_prazo: linhas.filter((l) => l.semaforo === VERDE).length,
      priorizados: linhas.filter((l) => l.prioritario).length,
    };

    if (filtros.situacao) {
      linhas = linhas.filter((l) => l.semaforo === filtros.situacao);
    }

    const offset = filtros.offset ?? 0;
    const limite = Math.min(filtros.limit ?? 300, 1000);

    return {
      resumo,
      prazos: linhas.slice(offset, offset + limite),
      total: linhas.length,
      pode_priorizar: this.perfis.podePriorizar(perfil),
    };
  }

  /** Unidade SEI cadastrada para o usuário, quando houver. */
  private async unidadeDoUsuario(
    usuario: UsuarioAtualInfo,
  ): Promise<string | null> {
    if (!usuario.email) return null;

    const registro = await this.prisma.usuario.findFirst({
      where: { email: { equals: usuario.email, mode: "insensitive" } },
      select: { idUnidade: true },
    });

    return registro?.idUnidade ?? null;
  }

  /**
   * Remove pontuação, para casar busca digitada com ou sem máscara.
   * "0001.2026/000001-1" e "000120260000011" têm que encontrar o mesmo processo.
   */
  private semMascara(valor: string | null): string {
    return (valor ?? "").replace(/[.\-/\s]/g, "");
  }

  /**
   * Reproduz a cláusula de busca do backend Python: número do SEI do relatório,
   * número do processo, CPF/CNPJ (os três sem máscara) ou nome do interessado.
   */
  private casaComBusca(registro: PrazoComRelacoes, busca: string): boolean {
    const item = registro.caixaEntrada;
    const termo = busca.trim();
    const limpo = this.semMascara(termo);
    const texto = termo.toLowerCase();

    const porNumero =
      limpo.length > 0 &&
      (this.semMascara(item.numeroSei).includes(limpo) ||
        this.semMascara(item.numeroProcessoSei).includes(limpo) ||
        this.semMascara(item.cnpjCpf).includes(limpo));

    const porNome = (item.razaoSocial ?? "").toLowerCase().includes(texto);

    return porNumero || porNome;
  }

  private montarLinha(registro: PrazoComRelacoes, hoje: Date): PrazoLinha {
    const item = registro.caixaEntrada;
    const restantes = diasRestantes(registro.dataVencimento, hoje);
    const cor = semaforo(restantes);
    const tipo = tipoPorFase(registro.fase);
    const responsavel = item.responsavel;

    return {
      id: registro.id,
      caixa_entrada_id: item.id,
      prioritario: Boolean(item.prioritario),
      prioridade_justificativa: item.prioridadeJustificativa,
      // O número do processo sancionatório é o que importa aqui; o do relatório
      // de fiscalização entra como reserva para quem foi arquivado ou virou TAC
      // (que não criam processo novo).
      numero_sei: item.numeroProcessoSei || item.numeroSei,
      id_procedimento: item.idProcedimentoProcesso || item.idProcedimento,
      interessado: item.razaoSocial,
      cnpj_cpf: item.cnpjCpf,
      agente_regulado: item.agenteRegulado,
      fase: registro.fase,
      tipo_prazo: rotuloDoPrazo(registro.fase, registro.dias),
      base_legal: tipo?.base_legal ?? null,
      dias: registro.dias,
      data_inicio: registro.dataInicio ? chaveDoDia(registro.dataInicio) : null,
      data_vencimento: registro.dataVencimento
        ? chaveDoDia(registro.dataVencimento)
        : null,
      dias_restantes: restantes,
      restante_rotulo: rotuloRestante(restantes),
      semaforo: cor,
      situacao_rotulo: cor ? ROTULOS_SEMAFORO[cor as CorSemaforo] : null,
      responsavel: responsavel ? responsavel.nome || responsavel.email : null,
      status: registro.status,
    };
  }
}
