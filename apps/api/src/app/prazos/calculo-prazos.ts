/*
  Contagem de prazos e matriz de prazos do processo sancionatório.

  Regras de contagem (Lei Estadual nº 10.177/1998 e Documentação de Negócio v3.0):

  1. **Exclui-se o dia inicial e inclui-se o dia final.** Prazo de 15 dias
     iniciado em 01/08 vence em 16/08, não em 15/08.
  2. **Vencimento em dia sem expediente é prorrogado** para o primeiro dia útil
     seguinte.
  3. **Os prazos são contínuos:** sábados, domingos e feriados no meio da
     contagem contam normalmente. Só o dia do vencimento rola para frente.

  O app fazia apenas `data_inicio + dias`, sem prorrogação — vencimento em
  domingo era cobrado no domingo, e a certidão de decurso podia sair antes de o
  prazo legal ter terminado.

  O calendário de dias sem expediente vem da tabela `feriado`. Quais tipos
  entram (nacional, estadual, municipal, ponto facultativo) é ponto em aberto no
  documento de negócio; por ora todo registro conta como sem expediente.
*/
import {
  chaveDoDia,
  diferencaEmDias,
  ehFimDeSemana,
  hojeEmSaoPaulo,
  somarDias,
} from "../../shared/datas";

// ==============================================================================
// Semáforo de prazos
//
// O mesmo código de cores vale para a tela de prazos e a de cautelares, para a
// urgência ser lida de imediato nas duas.
// ==============================================================================

export const VERDE = "verde";
export const AMARELO = "amarelo";
export const VERMELHO = "vermelho";

export type CorSemaforo = typeof VERDE | typeof AMARELO | typeof VERMELHO;

/** A partir de quantos dias restantes o prazo é considerado tranquilo. */
export const DIAS_VERDE = 4;

export const ROTULOS_SEMAFORO: Record<CorSemaforo, string> = {
  [VERDE]: "No prazo",
  [AMARELO]: "Vence em breve",
  [VERMELHO]: "Vencido",
};

/**
 * Cor do prazo a partir dos dias que faltam.
 *
 * Verde com 4 dias ou mais; amarelo no dia do vencimento ou até 3 dias antes;
 * vermelho depois de vencido. Sem data de vencimento não há cor.
 */
export function semaforo(dias: number | null): CorSemaforo | null {
  if (dias === null) return null;
  if (dias < 0) return VERMELHO;
  if (dias <= DIAS_VERDE - 1) return AMARELO;
  return VERDE;
}

/** Dias até o vencimento. Negativo quando já venceu. */
export function diasRestantes(
  vencimento: Date | null,
  hoje?: Date,
): number | null {
  if (!vencimento) return null;
  return diferencaEmDias(hoje ?? hojeEmSaoPaulo(), vencimento);
}

/** Texto curto do tempo restante, como aparece na coluna da tela. */
export function rotuloRestante(dias: number | null): string {
  if (dias === null) return "—";
  // A ordem reproduz o Python: -1 dia tem texto próprio, e os demais atrasos
  // saem com o número negativo mesmo ("-3 dias").
  if (dias < 0) return dias < -1 ? `${dias} dias` : "Vencido há 1 dia";
  if (dias === 0) return "Hoje";
  if (dias === 1) return "1 dia";
  return `${dias} dias`;
}

// ==============================================================================
// Dias sem expediente e contagem
// ==============================================================================

/** Dia com expediente: não é sábado, domingo nem feriado cadastrado. */
export function ehDiaUtil(dia: Date, feriados?: ReadonlySet<string>): boolean {
  if (ehFimDeSemana(dia)) return false;
  return !feriados?.has(chaveDoDia(dia));
}

/**
 * Primeiro dia com expediente a partir de `dia` (inclusive).
 *
 * O teto de 30 tentativas evita laço infinito caso o calendário venha com um
 * intervalo absurdo cadastrado por engano.
 */
export function proximoDiaUtil(
  dia: Date,
  feriados?: ReadonlySet<string>,
): Date {
  let atual = dia;
  for (let i = 0; i < 30; i += 1) {
    if (ehDiaUtil(atual, feriados)) return atual;
    atual = somarDias(atual, 1);
  }
  return atual;
}

/**
 * Vencimento de um prazo em dias corridos, pela regra da Lei 10.177/1998.
 *
 * Exclui o dia inicial (a contagem começa no dia seguinte), inclui o dia final
 * e prorroga para o primeiro dia útil quando o final cai em dia sem expediente.
 *
 * `feriados` é recebido pronto para evitar uma consulta por prazo no cálculo em
 * lote — quem carrega o calendário é o PrazosService.
 */
export function calcularVencimento(
  dataInicio: Date,
  dias: number,
  feriados?: ReadonlySet<string>,
): Date {
  return proximoDiaUtil(somarDias(dataInicio, dias), feriados);
}

// ==============================================================================
// Matriz consolidada de prazos
//
// Parametrização única: duração, base legal, gatilho de início e o que acontece
// no vencimento. O documento de negócio pede prazos parametrizáveis para
// adequação futura a alterações normativas — por isso ficam aqui, num lugar só,
// e não espalhados pelas rotas.
// ==============================================================================

export interface TipoPrazo {
  chave: string;
  rotulo: string;
  dias: number;
  base_legal: string;
  gatilho: string;
  no_vencimento: string;
  /** Fase do processo à qual o prazo pertence, quando houver uma só. */
  fase?: string;
  /** Prazo de acompanhamento gerencial, não do rito (não gera certidão). */
  gerencial?: boolean;
}

export const MATRIZ_PRAZOS: readonly TipoPrazo[] = [
  {
    chave: "defesa_previa",
    rotulo: "Defesa prévia",
    dias: 15,
    base_legal: "Art. 63, III",
    gatilho: "Citação efetiva (visualização ou edital)",
    no_vencimento: "Certidão de decurso",
    fase: "aguardando_defesa",
  },
  {
    chave: "defesa_previa_edital",
    rotulo: "Defesa prévia (edital)",
    dias: 15,
    base_legal: "Art. 63, III",
    gatilho: "Publicação do edital",
    no_vencimento: "Certidão de decurso",
    fase: "aguardando_defesa",
  },
  {
    chave: "manifestacao_documentos",
    rotulo: "Manifestação sobre documentos da Administração",
    dias: 7,
    base_legal: "Art. 63, V",
    gatilho: "Intimação",
    no_vencimento: "Certidão de decurso",
  },
  {
    chave: "quesitos_assistente",
    rotulo: "Quesitos / assistente técnico",
    dias: 7,
    base_legal: "Art. 63",
    gatilho: "Despacho saneador",
    no_vencimento: "Preclusão",
  },
  {
    chave: "alegacoes_finais",
    rotulo: "Alegações finais",
    dias: 7,
    base_legal: "Art. 63, VII",
    gatilho: "Intimação (saneador)",
    no_vencimento: "Certidão de decurso",
    fase: "aguardando_alegacoes",
  },
  {
    chave: "decisao_instrucao",
    rotulo: "Decisão após instrução",
    dias: 20,
    base_legal: "Art. 63",
    gatilho: "Regularidade certificada",
    no_vencimento: "Alerta interno",
    fase: "julgamento",
    gerencial: true,
  },
  {
    chave: "recurso",
    rotulo: "Recurso administrativo",
    dias: 15,
    base_legal: "Art. 44",
    gatilho: "Publicação ou notificação da Decisão I",
    no_vencimento: "Trânsito administrativo",
    fase: "recurso",
  },
  {
    chave: "reconsideracao",
    rotulo: "Reconsideração da autoridade",
    dias: 7,
    base_legal: "Art. 47, VI",
    gatilho: "Interposição do recurso",
    no_vencimento: "Encaminha à instância recursal",
    fase: "recurso",
  },
  {
    chave: "julgamento_recurso",
    rotulo: "Julgamento do recurso",
    dias: 30,
    base_legal: "Art. 47, VII",
    gatilho: "Recebimento dos autos",
    no_vencimento: "Alerta interno",
    fase: "recurso",
    gerencial: true,
  },
  {
    chave: "maximo_recurso",
    rotulo: "Prazo máximo de decisão do recurso",
    dias: 120,
    base_legal: "Art. 50",
    gatilho: "Protocolo do recurso",
    no_vencimento: "Alerta de estouro",
    fase: "recurso",
    gerencial: true,
  },
  {
    chave: "sem_movimentacao",
    rotulo: "Processo sem movimentação",
    dias: 15,
    base_legal: "Gestão",
    gatilho: "Última movimentação",
    no_vencimento: "Alerta de morosidade",
    gerencial: true,
  },
  {
    chave: "encerramento_sem_conclusao",
    rotulo: "Termo de encerramento sem conclusão",
    dias: 2,
    base_legal: "Gestão",
    gatilho: "Termo de encerramento assinado",
    no_vencimento: "Alerta de pendência",
    fase: "encerramento",
    gerencial: true,
  },
];

const POR_CHAVE = new Map(MATRIZ_PRAZOS.map((t) => [t.chave, t]));

/**
 * Prazos da medida cautelar (art. 62, § único). Não entram na matriz acima
 * porque a duração é escolhida caso a caso, não fixada por tipo.
 */
export const PRAZOS_CAUTELAR: readonly number[] = [30, 45, 60, 90];

export function tipoPorChave(chave: string): TipoPrazo | undefined {
  return POR_CHAVE.get(chave);
}

export function diasDoTipo(chave: string, padrao = 15): number {
  return POR_CHAVE.get(chave)?.dias ?? padrao;
}

/**
 * Tipo de prazo correspondente à fase, para os prazos já gravados.
 *
 * `PrazoProcesso` guarda a fase (`aguardando_defesa`, `aguardando_alegacoes`,
 * `recurso`), não o tipo — este mapa traduz um no outro para a tela poder
 * mostrar rótulo e base legal.
 */
export function tipoPorFase(fase?: string | null): TipoPrazo | undefined {
  if (!fase) return undefined;
  return MATRIZ_PRAZOS.find((tipo) => tipo.fase === fase);
}

/**
 * Rótulo do prazo para exibição, com a fase como pista principal.
 *
 * Quando a fase serve a mais de um tipo (defesa normal e por edital têm a mesma
 * fase), a duração desempata; não havendo como decidir, cai no nome da fase
 * para não mostrar rótulo errado.
 */
export function rotuloDoPrazo(
  fase?: string | null,
  dias?: number | null,
): string {
  const tipo = tipoPorFase(fase);

  if (tipo && dias !== null && dias !== undefined && tipo.dias !== dias) {
    const candidato = MATRIZ_PRAZOS.find(
      (c) => c.fase === fase && c.dias === dias,
    );
    if (candidato) return candidato.rotulo;
  }

  if (tipo) return tipo.rotulo;

  const daFase = (fase ?? "").replace(/_/g, " ");
  const capitalizado = daFase
    ? daFase.charAt(0).toUpperCase() + daFase.slice(1).toLowerCase()
    : "";

  return capitalizado || "Prazo";
}
