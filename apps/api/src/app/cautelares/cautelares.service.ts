import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import {
  chaveDoDia,
  diferencaEmDias,
  hojeEmSaoPaulo,
  somarDias,
} from "../../shared/datas";
import { PrismaService } from "../../shared/prisma.service";
import type { UsuarioAtualInfo } from "../auth/usuario-atual.types";
import { PerfisService } from "../perfis/perfis.service";
import {
  calcularVencimento,
  diasRestantes,
  DIAS_VERDE,
  PRAZOS_CAUTELAR,
  semaforo,
} from "../prazos/calculo-prazos";
import { PrazosService } from "../prazos/prazos.service";
import {
  CautelarResposta,
  CriarCautelarDto,
  RenovarCautelarDto,
  ResumoCautelares,
} from "./dto/cautelar.dto";

/** Situações em que a medida ainda produz efeito (agente bloqueado). */
const SITUACOES_ATIVAS = ["vigente", "vencendo", "vencida"];

/** Situações que encerram o efeito da medida. */
const SITUACOES_ENCERRADAS = ["renovada", "revogada"];

/** Cautelar com os vínculos que a resposta precisa. */
type CautelarComRelacoes = Prisma.CautelarGetPayload<{
  include: {
    caixaEntrada: true;
    processo: true;
    agente: true;
  };
}>;

const INCLUDE_RELACOES = {
  caixaEntrada: true,
  processo: true,
  agente: true,
} as const;

/**
 * Painel de medidas cautelares.
 *
 * Competência: Coordenadoria Geral de Gestão de Agentes e Atividades Reguladas.
 * Fundamento: art. 62, parágrafo único, da Lei Estadual nº 10.177/1998.
 *
 * Tela de acompanhamento prioritário: os agentes com cautelar estão bloqueados
 * e impedidos de operar. Se apresentam defesa, é preciso analisar de imediato se
 * a medida se mantém ou é revogada — a demora aqui recai sobre o agente.
 *
 * ATENÇÃO: aplicar, renovar e revogar são de competência EXCLUSIVA do
 * Coordenador Geral, e isso é verificado por perfil, não por permissão
 * configurável — é competência legal, não configuração de acesso.
 */
@Injectable()
export class CautelaresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly perfis: PerfisService,
    private readonly prazos: PrazosService,
  ) {}

  // ==========================================================================
  // Consulta
  // ==========================================================================

  /** Cartões do painel: vigentes, vencendo, vencidas, ⚑ defesa e fila. */
  async resumo(): Promise<ResumoCautelares> {
    const hoje = hojeEmSaoPaulo();

    const cautelares = await this.prisma.cautelar.findMany({
      select: {
        caixaEntradaId: true,
        situacao: true,
        dataFim: true,
        aprovacao: true,
      },
    });

    const comDefesa = await this.idsComDefesa(
      cautelares
        .map((c) => c.caixaEntradaId)
        .filter((id): id is number => id !== null),
    );

    const resumo: ResumoCautelares = {
      vigentes: 0,
      vencendo: 0,
      vencidas: 0,
      defesa_apresentada: 0,
      aguardando_aprovacao: 0,
    };

    for (const c of cautelares) {
      const situacao = this.situacao(c.situacao, c.dataFim, hoje);

      if (situacao === "vigente") resumo.vigentes += 1;
      else if (situacao === "vencendo") resumo.vencendo += 1;
      else if (situacao === "vencida") resumo.vencidas += 1;

      const ativa = SITUACOES_ATIVAS.includes(situacao);

      if (ativa && c.caixaEntradaId && comDefesa.has(c.caixaEntradaId)) {
        resumo.defesa_apresentada += 1;
      }
      // `aprovacao` nula conta como pendente: registro antigo, criado antes de
      // a fila de concordância existir, também espera decisão.
      if ((c.aprovacao ?? "pendente") === "pendente" && ativa) {
        resumo.aguardando_aprovacao += 1;
      }
    }

    return resumo;
  }

  /**
   * Lista as cautelares, com as que exigem revisão no topo.
   *
   * A ordem segue a urgência operacional descrita no documento: defesa
   * apresentada primeiro — o agente está impedido de trabalhar e há decisão
   * pendente —, depois pelo vencimento mais próximo.
   */
  async listar(filtros: {
    situacao?: string;
    unidade?: string;
    aprovacao?: string;
    somente_com_defesa?: boolean;
  }): Promise<CautelarResposta[]> {
    const hoje = hojeEmSaoPaulo();
    const where: Prisma.CautelarWhereInput = {};

    if (filtros.unidade) {
      where.unidadeResponsavel = {
        contains: filtros.unidade,
        mode: "insensitive",
      };
    }

    if (filtros.aprovacao === "pendente") {
      // Nulo conta como pendente: registro criado antes de a fila de
      // concordância existir também espera decisão. Filtrar só por
      // aprovacao = "pendente" esconderia esses da fila do Coordenador.
      where.OR = [{ aprovacao: null }, { aprovacao: "pendente" }];
    } else if (filtros.aprovacao) {
      where.aprovacao = filtros.aprovacao;
    }

    const cautelares = await this.prisma.cautelar.findMany({
      where,
      include: INCLUDE_RELACOES,
      orderBy: { dataFim: "asc" },
    });

    const comDefesa = await this.idsComDefesa(
      cautelares
        .map((c) => c.caixaEntradaId)
        .filter((id): id is number => id !== null),
    );

    let resultado = cautelares.map((c) =>
      this.paraResposta(
        c,
        c.caixaEntradaId ? comDefesa.has(c.caixaEntradaId) : false,
        hoje,
      ),
    );

    // Situação e "defesa apresentada" são computados, por isso os dois filtros
    // são aplicados em memória — não existem como coluna para filtrar no banco.
    if (filtros.situacao) {
      resultado = resultado.filter((r) => r.situacao === filtros.situacao);
    }
    if (filtros.somente_com_defesa) {
      resultado = resultado.filter((r) => r.defesa_apresentada);
    }

    // Defesa apresentada primeiro; depois vencimento mais próximo. Cautelar sem
    // data de fim vai para o fim da fila, não para o começo.
    return resultado.sort((a, b) => {
      if (a.defesa_apresentada !== b.defesa_apresentada) {
        return a.defesa_apresentada ? -1 : 1;
      }
      const fimA = a.data_fim ?? "9999-12-31";
      const fimB = b.data_fim ?? "9999-12-31";
      return fimA.localeCompare(fimB);
    });
  }

  async obter(id: number): Promise<CautelarResposta> {
    const cautelar = await this.carregar(id);
    const comDefesa = cautelar.caixaEntradaId
      ? (await this.idsComDefesa([cautelar.caixaEntradaId])).has(
          cautelar.caixaEntradaId,
        )
      : false;

    return this.paraResposta(cautelar, comDefesa);
  }

  // ==========================================================================
  // Aplicação, concordância e recusa
  // ==========================================================================

  /**
   * Aplica a medida e a coloca na fila do Coordenador Geral.
   *
   * Nasce com `aprovacao = pendente`: quem instaura INDICA a medida, mas a
   * aplicação é de competência do Coordenador Geral.
   */
  async criar(
    dados: CriarCautelarDto,
    usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    this.exigirPrazoValido(dados.prazo_dias);

    if (!dados.processo_id && !dados.caixa_entrada_id) {
      throw new UnprocessableEntityException(
        "Informe 'caixa_entrada_id' ou 'processo_id'.",
      );
    }

    let agenteId = dados.agente_id ?? null;

    if (dados.processo_id) {
      const processo = await this.prisma.processo.findUnique({
        where: { id: dados.processo_id },
        select: { agenteId: true },
      });
      if (!processo) {
        throw new NotFoundException("Processo não encontrado.");
      }
      agenteId = agenteId ?? processo.agenteId;
    }

    if (dados.caixa_entrada_id) {
      const item = await this.prisma.caixaEntrada.findUnique({
        where: { id: dados.caixa_entrada_id },
        select: { id: true },
      });
      if (!item) {
        throw new NotFoundException("Item da caixa de entrada não encontrado.");
      }
    }

    const inicio = this.paraData(dados.data_inicio);
    const feriados = await this.prazos.carregarFeriados();
    const autor = this.nomeDoAutor(usuario);

    const criada = await this.prisma.$transaction(async (tx) => {
      const cautelar = await tx.cautelar.create({
        data: {
          processoId: dados.processo_id ?? null,
          caixaEntradaId: dados.caixa_entrada_id ?? null,
          agenteId,
          tipo: dados.tipo,
          dataInicio: inicio,
          dataFim: calcularVencimento(inicio, dados.prazo_dias, feriados),
          prazoDias: dados.prazo_dias,
          situacao: "vigente",
          fundamentacao: dados.fundamentacao ?? null,
          unidadeResponsavel: dados.unidade_responsavel ?? null,
          aprovacao: "pendente",
        },
        include: INCLUDE_RELACOES,
      });

      await this.registrarEvento(
        tx,
        cautelar.caixaEntradaId,
        "cautelar_aplicada",
        `Medida cautelar de ${dados.prazo_dias} dias indicada, aguardando ` +
          "concordância do Coordenador Geral.",
        autor,
      );

      return cautelar;
    });

    return this.paraResposta(criada, false);
  }

  /** Coordenador Geral concorda: o documento segue para assinatura. */
  async aprovar(
    id: number,
    usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    await this.exigirCoordenadorGeral(
      usuario,
      "A concordância com a medida cautelar é de competência exclusiva do " +
        "Coordenador Geral (art. 62, parágrafo único, da Lei 10.177/1998).",
    );

    await this.carregar(id);
    const autor = this.nomeDoAutor(usuario);

    const atualizada = await this.prisma.$transaction(async (tx) => {
      const cautelar = await tx.cautelar.update({
        where: { id },
        data: {
          aprovacao: "aprovada",
          aprovadaPor: autor,
          aprovadaEm: new Date(),
          motivoRecusa: null,
          // A certidão de bloqueio nasce pendente de assinatura no SEI.
          pendenteAssinatura: true,
        },
        include: INCLUDE_RELACOES,
      });

      await this.registrarEvento(
        tx,
        cautelar.caixaEntradaId,
        "cautelar_aprovada",
        "Coordenador Geral concordou com a medida cautelar; documento segue " +
          "para assinatura.",
        autor,
      );

      return cautelar;
    });

    return this.paraResposta(atualizada, false);
  }

  /**
   * Coordenador Geral recusa: o processo volta à caixa de entrada.
   *
   * O item volta para triagem marcado como `cautelar_recusada`, para o analista
   * reeditar o texto-padrão da instauração removendo a parte da cautelar,
   * aproveitando os dados de qualificação já preenchidos.
   */
  async recusar(
    id: number,
    motivo: string,
    usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    await this.exigirCoordenadorGeral(
      usuario,
      "A recusa da medida cautelar é de competência exclusiva do Coordenador Geral.",
    );

    await this.carregar(id);
    const autor = this.nomeDoAutor(usuario);

    const atualizada = await this.prisma.$transaction(async (tx) => {
      const cautelar = await tx.cautelar.update({
        where: { id },
        data: {
          aprovacao: "recusada",
          aprovadaPor: autor,
          aprovadaEm: new Date(),
          motivoRecusa: motivo,
          situacao: "revogada",
          pendenteAssinatura: false,
        },
        include: INCLUDE_RELACOES,
      });

      if (cautelar.caixaEntradaId) {
        await tx.caixaEntrada.update({
          where: { id: cautelar.caixaEntradaId },
          data: { statusTriagem: "cautelar_recusada" },
        });

        await this.registrarEvento(
          tx,
          cautelar.caixaEntradaId,
          "cautelar_recusada",
          `Coordenador Geral recusou a medida cautelar: ${motivo}. ` +
            "Processo devolvido à caixa de entrada para reedição do termo sem a cautelar.",
          autor,
        );
      }

      return cautelar;
    });

    return this.paraResposta(atualizada, false);
  }

  // ==========================================================================
  // Renovação e revogação
  // ==========================================================================

  /**
   * Renova a cautelar criando outra, com referência à anterior.
   *
   * A original fica como `renovada` e a nova começa no dia seguinte ao
   * vencimento — ou hoje, se o vencimento já passou, para não criar medida com
   * início retroativo.
   */
  async renovar(
    id: number,
    dados: RenovarCautelarDto,
    usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    await this.exigirCoordenadorGeral(
      usuario,
      "A renovação da medida cautelar é de competência exclusiva do Coordenador Geral.",
    );
    this.exigirPrazoValido(dados.prazo_dias);

    const original = await this.carregar(id);
    if (original.dataRevogacao) {
      throw new ConflictException("Cautelar revogada não pode ser renovada.");
    }

    const hoje = hojeEmSaoPaulo();
    const aposVencimento = original.dataFim
      ? somarDias(original.dataFim, 1)
      : hoje;
    const inicio = aposVencimento > hoje ? aposVencimento : hoje;

    const feriados = await this.prazos.carregarFeriados();
    const autor = this.nomeDoAutor(usuario);

    const nova = await this.prisma.$transaction(async (tx) => {
      await tx.cautelar.update({
        where: { id },
        data: { situacao: "renovada" },
      });

      const criada = await tx.cautelar.create({
        data: {
          processoId: original.processoId,
          caixaEntradaId: original.caixaEntradaId,
          agenteId: original.agenteId,
          tipo: original.tipo,
          dataInicio: inicio,
          dataFim: calcularVencimento(inicio, dados.prazo_dias, feriados),
          prazoDias: dados.prazo_dias,
          situacao: "vigente",
          fundamentacao: original.fundamentacao,
          unidadeResponsavel: original.unidadeResponsavel,
          renovadaDeId: original.id,
          // Renovação parte de medida já concordada: não volta para a fila.
          aprovacao: "aprovada",
          aprovadaPor: autor,
          aprovadaEm: new Date(),
        },
        include: INCLUDE_RELACOES,
      });

      const vencimento = criada.dataFim
        ? this.formatarBr(criada.dataFim)
        : "-";

      await this.registrarEvento(
        tx,
        criada.caixaEntradaId,
        "cautelar_renovada",
        `Medida cautelar renovada por ${dados.prazo_dias} dias ` +
          `(vence em ${vencimento}).`,
        autor,
      );

      return criada;
    });

    return this.paraResposta(nova, false);
  }

  /**
   * Revoga a medida: o agente volta a operar e cabe certidão de desbloqueio.
   *
   * Caminho típico depois de o agente bloqueado apresentar defesa, quando a
   * revisão conclui que a medida não se sustenta.
   */
  async revogar(
    id: number,
    motivo: string,
    usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    await this.exigirCoordenadorGeral(
      usuario,
      "A revogação da medida cautelar é de competência exclusiva do Coordenador Geral.",
    );

    const cautelar = await this.carregar(id);
    if (cautelar.dataRevogacao) {
      throw new ConflictException("Esta cautelar já foi revogada.");
    }

    const autor = this.nomeDoAutor(usuario);

    const atualizada = await this.prisma.$transaction(async (tx) => {
      const registro = await tx.cautelar.update({
        where: { id },
        data: {
          situacao: "revogada",
          dataRevogacao: hojeEmSaoPaulo(),
          revogadaPor: autor,
          motivoRevogacao: motivo,
          // A certidão de desbloqueio entra na fila de assinatura, como a de
          // bloqueio.
          pendenteAssinatura: true,
        },
        include: INCLUDE_RELACOES,
      });

      await this.registrarEvento(
        tx,
        registro.caixaEntradaId,
        "cautelar_revogada",
        `Medida cautelar revogada: ${motivo}. Pendente certidão de desbloqueio.`,
        autor,
      );

      return registro;
    });

    return this.paraResposta(atualizada, false);
  }

  // ==========================================================================
  // Certidões e assinatura
  // ==========================================================================

  /**
   * Junta a certidão de bloqueio, com evidência de tela do sistema legado.
   *
   * A evidência é obrigatória: a certidão atesta que o bloqueio foi efetivado no
   * sistema legado, e sem a tela não há como comprovar.
   *
   * PENDENTE DE INTEGRAÇÃO, igual ao backend Python: a inclusão do documento no
   * SEI depende do cliente que ainda não foi portado, então o número fica
   * marcado como pendente. O arquivo enviado NÃO é guardado — o mesmo
   * comportamento de antes, e um ponto a resolver junto com a integração.
   */
  async juntarCertidao(
    id: number,
    nomeArquivo: string,
    usuario: UsuarioAtualInfo,
  ): Promise<void> {
    await this.carregar(id);
    const autor = this.nomeDoAutor(usuario);

    await this.prisma.$transaction(async (tx) => {
      await tx.cautelar.update({
        where: { id },
        data: {
          numeroSeiCertidao: `PENDENTE_SEI_${id}`,
          pendenteAssinatura: true,
        },
      });

      const cautelar = await tx.cautelar.findUnique({
        where: { id },
        select: { caixaEntradaId: true },
      });

      await this.registrarEvento(
        tx,
        cautelar?.caixaEntradaId ?? null,
        "certidao_bloqueio",
        `Certidão de bloqueio juntada com evidência (${nomeArquivo}).`,
        autor,
      );
    });
  }

  /** Junta a certidão de desbloqueio, exigida quando a medida é revogada. */
  async juntarCertidaoDesbloqueio(
    id: number,
    nomeArquivo: string,
    usuario: UsuarioAtualInfo,
  ): Promise<void> {
    const cautelar = await this.carregar(id);

    if (!cautelar.dataRevogacao) {
      throw new ConflictException(
        "A certidão de desbloqueio só cabe depois da revogação da medida.",
      );
    }

    const autor = this.nomeDoAutor(usuario);

    await this.prisma.$transaction(async (tx) => {
      await tx.cautelar.update({
        where: { id },
        data: {
          numeroSeiCertidaoDesbloqueio: `PENDENTE_SEI_DESB_${id}`,
          pendenteAssinatura: true,
        },
      });

      await this.registrarEvento(
        tx,
        cautelar.caixaEntradaId,
        "certidao_desbloqueio",
        `Certidão de desbloqueio juntada com evidência (${nomeArquivo}).`,
        autor,
      );
    });
  }

  /**
   * Baixa a marca de "pendente de assinatura" depois de assinar no SEI.
   *
   * A assinatura acontece no SEI, e o app não consegue detectá-la sozinho sem
   * consultar o bloco; este endpoint permite fechar a pendência pela tela.
   */
  async marcarAssinaturaConcluida(
    id: number,
    usuario: UsuarioAtualInfo,
  ): Promise<CautelarResposta> {
    await this.carregar(id);
    const autor = this.nomeDoAutor(usuario);

    const atualizada = await this.prisma.$transaction(async (tx) => {
      const registro = await tx.cautelar.update({
        where: { id },
        data: { pendenteAssinatura: false },
        include: INCLUDE_RELACOES,
      });

      await this.registrarEvento(
        tx,
        registro.caixaEntradaId,
        "cautelar_assinada",
        "Documento da cautelar assinado no SEI.",
        autor,
      );

      return registro;
    });

    return this.paraResposta(atualizada, false);
  }

  // ==========================================================================
  // Apoio
  // ==========================================================================

  private async carregar(id: number): Promise<CautelarComRelacoes> {
    const cautelar = await this.prisma.cautelar.findUnique({
      where: { id },
      include: INCLUDE_RELACOES,
    });

    if (!cautelar) {
      throw new NotFoundException("Cautelar não encontrada.");
    }

    return cautelar;
  }

  private exigirPrazoValido(dias: number): void {
    if (!PRAZOS_CAUTELAR.includes(dias)) {
      throw new UnprocessableEntityException(
        `Prazo inválido. Permitidos: ${PRAZOS_CAUTELAR.join(", ")} dias.`,
      );
    }
  }

  private async exigirCoordenadorGeral(
    usuario: UsuarioAtualInfo,
    mensagem: string,
  ): Promise<void> {
    const perfil = await this.perfis.resolver(usuario);
    if (!this.perfis.ehCoordenadorGeral(perfil)) {
      throw new ForbiddenException(mensagem);
    }
  }

  private nomeDoAutor(usuario: UsuarioAtualInfo): string {
    return usuario.nome || usuario.email || "Sistema";
  }

  private paraData(valor: string): Date {
    const data = new Date(`${valor}T00:00:00.000Z`);
    if (Number.isNaN(data.getTime())) {
      throw new UnprocessableEntityException(
        "Data de início inválida. Use o formato AAAA-MM-DD.",
      );
    }
    return data;
  }

  private formatarBr(data: Date): string {
    const dia = String(data.getUTCDate()).padStart(2, "0");
    const mes = String(data.getUTCMonth() + 1).padStart(2, "0");
    return `${dia}/${mes}/${data.getUTCFullYear()}`;
  }

  /**
   * Situação computada: vigente, vencendo (≤3 dias), vencida, renovada, revogada.
   *
   * O limiar de "vencendo" era 7 dias e passou a 3, para casar com o semáforo de
   * prazos — o documento manda usar o mesmo código de cores nas duas telas.
   */
  private situacao(
    gravada: string | null,
    dataFim: Date | null,
    hoje: Date,
  ): string {
    if (gravada && SITUACOES_ENCERRADAS.includes(gravada)) {
      return gravada;
    }
    if (!dataFim) return "vigente";
    if (dataFim < hoje) return "vencida";
    if (diferencaEmDias(hoje, dataFim) <= DIAS_VERDE - 1) return "vencendo";
    return "vigente";
  }

  /**
   * Quais processos com cautelar já tiveram defesa juntada.
   *
   * Dois sinais, porque a defesa pode ser detectada pela automação — que fecha o
   * prazo como respondido — ou registrada como evento pela verificação em tempo
   * real. Olhar só um dos dois deixaria passar metade dos casos, e este é o
   * alerta mais urgente da tela: agente bloqueado que apresentou defesa.
   */
  private async idsComDefesa(idsCaixa: number[]): Promise<Set<number>> {
    if (idsCaixa.length === 0) return new Set();

    const [porPrazo, porEvento] = await Promise.all([
      this.prisma.prazoProcesso.findMany({
        where: {
          caixaEntradaId: { in: idsCaixa },
          fase: "aguardando_defesa",
          status: "respondido",
        },
        select: { caixaEntradaId: true },
      }),
      this.prisma.eventoProcesso.findMany({
        where: {
          caixaEntradaId: { in: idsCaixa },
          tipo: { in: ["defesa_juntada", "defesa_intempestiva"] },
        },
        select: { caixaEntradaId: true },
      }),
    ]);

    return new Set([
      ...porPrazo.map((p) => p.caixaEntradaId),
      ...porEvento.map((e) => e.caixaEntradaId),
    ]);
  }

  /**
   * Estado do bloqueio para a coluna da tela.
   *
   * `revisar` cobre os dois casos que pedem decisão: defesa apresentada por
   * agente bloqueado e cautelar vencida sem renovação. Nos dois, mostrar o
   * bloqueio como "ativo" esconderia uma pendência.
   */
  private statusBloqueio(
    dataRevogacao: Date | null,
    situacao: string,
    comDefesa: boolean,
  ): string {
    if (situacao === "revogada" || dataRevogacao) return "revogado";
    if (comDefesa || situacao === "vencida") return "revisar";
    return "ativo";
  }

  private registrarEvento(
    tx: Prisma.TransactionClient,
    caixaEntradaId: number | null,
    tipo: string,
    descricao: string,
    autor: string,
  ): Promise<unknown> {
    // Cautelar da base migrada pode não ter vínculo com a caixa de entrada; sem
    // ele não há processo onde registrar o evento.
    if (!caixaEntradaId) return Promise.resolve();

    return tx.eventoProcesso.create({
      data: { caixaEntradaId, tipo, descricao, autor },
    });
  }

  private paraResposta(
    c: CautelarComRelacoes,
    comDefesa: boolean,
    hoje?: Date,
  ): CautelarResposta {
    const referencia = hoje ?? hojeEmSaoPaulo();
    const situacao = this.situacao(c.situacao, c.dataFim, referencia);
    const restantes = diasRestantes(c.dataFim, referencia);
    const item = c.caixaEntrada;

    return {
      id: c.id,
      processo_id: c.processoId,
      caixa_entrada_id: c.caixaEntradaId,
      agente_id: c.agenteId,
      tipo: c.tipo,
      data_inicio: c.dataInicio ? chaveDoDia(c.dataInicio) : null,
      data_fim: c.dataFim ? chaveDoDia(c.dataFim) : null,
      prazo_dias: c.prazoDias,
      situacao,
      fundamentacao: c.fundamentacao,
      unidade_responsavel: c.unidadeResponsavel,
      numero_sei_certidao: c.numeroSeiCertidao,
      renovada_de_id: c.renovadaDeId,
      criado_em: c.criadoEm ? c.criadoEm.toISOString() : null,

      aprovacao: c.aprovacao,
      aprovada_por: c.aprovadaPor,
      motivo_recusa: c.motivoRecusa,
      pendente_assinatura: Boolean(c.pendenteAssinatura),
      link_bloco_sei: c.linkBlocoSei,

      data_revogacao: c.dataRevogacao ? chaveDoDia(c.dataRevogacao) : null,
      revogada_por: c.revogadaPor,
      motivo_revogacao: c.motivoRevogacao,
      numero_sei_certidao_desbloqueio: c.numeroSeiCertidaoDesbloqueio,

      dias_restantes: restantes,
      // Sem semáforo quando a medida já não produz efeito: cor em cautelar
      // revogada sugeriria urgência onde não há.
      semaforo: SITUACOES_ATIVAS.includes(situacao) ? semaforo(restantes) : null,
      status_bloqueio: this.statusBloqueio(c.dataRevogacao, situacao, comDefesa),
      defesa_apresentada: comDefesa,

      /*
        O item da caixa de entrada é a fonte PREFERIDA: é o que o fluxo real do
        app preenche. A tabela `processo`/`agente_regulado` cobre a base migrada
        do SharePoint, onde a caixa de entrada não existe.
      */
      numero_sei_processo: item
        ? item.numeroProcessoSei || item.numeroSei
        : (c.processo?.numeroSei ?? null),
      razao_social: item ? item.razaoSocial : (c.agente?.razaoSocial ?? null),
      cnpj_cpf: item ? item.cnpjCpf : (c.agente?.cnpjCpf ?? null),
      agente_regulado: item
        ? item.agenteRegulado
        : (c.agente?.segmento ?? null),
      prioritario: item ? Boolean(item.prioritario) : false,
    };
  }
}
