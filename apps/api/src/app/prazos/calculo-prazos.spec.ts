import { describe, expect, it } from "@jest/globals";

import { chaveDoDia, ehFimDeSemana } from "../../shared/datas";
import {
  AMARELO,
  calcularVencimento,
  diasDoTipo,
  diasRestantes,
  ehDiaUtil,
  MATRIZ_PRAZOS,
  proximoDiaUtil,
  rotuloDoPrazo,
  rotuloRestante,
  semaforo,
  VERDE,
  VERMELHO,
} from "./calculo-prazos";

/** Atalho para montar data do calendário sem ambiguidade de fuso. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("cálculo de prazos", () => {
  /*
    Estes testes existem porque o app fazia só `data_inicio + dias`, sem
    prorrogação: um vencimento em domingo era cobrado no domingo, e a certidão
    de decurso podia sair antes de o prazo legal ter terminado.
  */
  describe("calcularVencimento — Lei 10.177/1998", () => {
    it("exclui o dia inicial e inclui o final: 15 dias de 01/08 vencem em 16/08", () => {
      // 16/08/2026 é domingo, então sem feriados a prorrogação leva a 17/08.
      // Para isolar a regra de contagem, começamos em 03/08 (segunda):
      // 03/08 + 15 = 18/08/2026, uma terça.
      expect(calcularVencimento(d("2026-08-03"), 15)).toEqual(d("2026-08-18"));
    });

    it("prorroga vencimento que cai no sábado para a segunda-feira", () => {
      // 2026-08-14 é sexta. +1 = sábado 15/08 -> prorroga para segunda 17/08.
      expect(calcularVencimento(d("2026-08-14"), 1)).toEqual(d("2026-08-17"));
    });

    it("prorroga vencimento que cai no domingo para a segunda-feira", () => {
      // 2026-08-14 sexta + 2 = domingo 16/08 -> segunda 17/08.
      expect(calcularVencimento(d("2026-08-14"), 2)).toEqual(d("2026-08-17"));
    });

    it("prorroga vencimento que cai em feriado cadastrado", () => {
      // 2026-09-07 (Independência) é uma segunda-feira.
      const feriados = new Set([chaveDoDia(d("2026-09-07"))]);

      // 2026-09-04 sexta + 3 = segunda 07/09, feriado -> terça 08/09.
      expect(calcularVencimento(d("2026-09-04"), 3, feriados)).toEqual(
        d("2026-09-08"),
      );
    });

    it("pula feriado emendado em fim de semana até achar dia útil", () => {
      // Sexta 04/09 e segunda 07/09 sem expediente: de quinta 03/09 + 1 = sexta,
      // que rola para sábado, domingo, segunda (feriado) e cai na terça 08/09.
      const feriados = new Set([
        chaveDoDia(d("2026-09-04")),
        chaveDoDia(d("2026-09-07")),
      ]);

      expect(calcularVencimento(d("2026-09-03"), 1, feriados)).toEqual(
        d("2026-09-08"),
      );
    });

    /*
      Prazo contínuo: fim de semana NO MEIO da contagem conta normalmente. Só o
      dia do vencimento é que rola para frente. Confundir isso com prazo em dias
      úteis alongaria todos os prazos do processo.
    */
    it("conta fim de semana no meio da contagem, sem descontar", () => {
      // Segunda 03/08 + 7 = segunda 10/08. Se descontasse o fim de semana,
      // cairia em 12/08.
      expect(calcularVencimento(d("2026-08-03"), 7)).toEqual(d("2026-08-10"));
    });
  });

  /*
    Tradução do Python: lá `weekday()` conta 0=segunda e o teste era `>= 5`.
    Em JavaScript `getUTCDay()` conta 0=domingo. Copiar o `>= 5` daria sexta e
    sábado como fim de semana, e domingo como dia útil — deslocando todos os
    vencimentos.
  */
  describe("fim de semana e dia útil", () => {
    it("reconhece sábado e domingo como fim de semana", () => {
      expect(ehFimDeSemana(d("2026-08-15"))).toBe(true); // sábado
      expect(ehFimDeSemana(d("2026-08-16"))).toBe(true); // domingo
    });

    it("não trata sexta nem segunda como fim de semana", () => {
      expect(ehFimDeSemana(d("2026-08-14"))).toBe(false); // sexta
      expect(ehFimDeSemana(d("2026-08-17"))).toBe(false); // segunda
    });

    it("feriado cadastrado não é dia útil", () => {
      const feriados = new Set([chaveDoDia(d("2026-09-07"))]);
      expect(ehDiaUtil(d("2026-09-07"), feriados)).toBe(false);
      expect(ehDiaUtil(d("2026-09-08"), feriados)).toBe(true);
    });

    it("devolve o próprio dia quando já é útil", () => {
      expect(proximoDiaUtil(d("2026-08-17"))).toEqual(d("2026-08-17"));
    });
  });

  describe("semáforo", () => {
    it("verde a partir de 4 dias restantes", () => {
      expect(semaforo(4)).toBe(VERDE);
      expect(semaforo(30)).toBe(VERDE);
    });

    it("amarelo do dia do vencimento até 3 dias antes", () => {
      expect(semaforo(3)).toBe(AMARELO);
      expect(semaforo(1)).toBe(AMARELO);
      expect(semaforo(0)).toBe(AMARELO);
    });

    it("vermelho depois de vencido", () => {
      expect(semaforo(-1)).toBe(VERMELHO);
    });

    it("sem vencimento não tem cor", () => {
      expect(semaforo(null)).toBeNull();
    });
  });

  describe("diasRestantes", () => {
    it("conta os dias que faltam", () => {
      expect(diasRestantes(d("2026-08-20"), d("2026-08-17"))).toBe(3);
    });

    it("devolve negativo quando já venceu", () => {
      expect(diasRestantes(d("2026-08-14"), d("2026-08-17"))).toBe(-3);
    });

    it("devolve zero no dia do vencimento", () => {
      expect(diasRestantes(d("2026-08-17"), d("2026-08-17"))).toBe(0);
    });

    it("sem data de vencimento devolve nulo", () => {
      expect(diasRestantes(null, d("2026-08-17"))).toBeNull();
    });
  });

  describe("rotuloRestante", () => {
    it("mostra os casos do dia a dia com o texto da tela", () => {
      expect(rotuloRestante(null)).toBe("—");
      expect(rotuloRestante(0)).toBe("Hoje");
      expect(rotuloRestante(1)).toBe("1 dia");
      expect(rotuloRestante(5)).toBe("5 dias");
      expect(rotuloRestante(-1)).toBe("Vencido há 1 dia");
      expect(rotuloRestante(-3)).toBe("-3 dias");
    });
  });

  describe("matriz de prazos", () => {
    it("tem os 12 prazos parametrizados do documento de negócio", () => {
      expect(MATRIZ_PRAZOS).toHaveLength(12);
    });

    it("devolve a duração pela chave, com padrão para chave desconhecida", () => {
      expect(diasDoTipo("defesa_previa")).toBe(15);
      expect(diasDoTipo("alegacoes_finais")).toBe(7);
      expect(diasDoTipo("sem_movimentacao")).toBe(15);
      expect(diasDoTipo("encerramento_sem_conclusao")).toBe(2);
      expect(diasDoTipo("chave-que-nao-existe", 9)).toBe(9);
    });

    /*
      Defesa prévia normal e por edital compartilham a fase `aguardando_defesa`
      e a mesma duração de 15 dias, então a fase sozinha não desempata — o
      primeiro da matriz vence. O desempate por duração só funciona quando as
      durações diferem, e é isso que este teste documenta.
    */
    it("usa a fase como pista principal do rótulo", () => {
      expect(rotuloDoPrazo("aguardando_defesa", 15)).toBe("Defesa prévia");
      expect(rotuloDoPrazo("aguardando_alegacoes", 7)).toBe("Alegações finais");
      expect(rotuloDoPrazo("recurso", 15)).toBe("Recurso administrativo");
    });

    it("desempata pela duração quando a fase serve a mais de um tipo", () => {
      // Fase "recurso" tem 15, 7, 30 e 120 dias na matriz.
      expect(rotuloDoPrazo("recurso", 7)).toBe("Reconsideração da autoridade");
      expect(rotuloDoPrazo("recurso", 30)).toBe("Julgamento do recurso");
      expect(rotuloDoPrazo("recurso", 120)).toBe(
        "Prazo máximo de decisão do recurso",
      );
    });

    it("cai no nome da fase quando não há tipo correspondente", () => {
      expect(rotuloDoPrazo("fase_inventada")).toBe("Fase inventada");
    });

    it("sem fase devolve o rótulo genérico", () => {
      expect(rotuloDoPrazo(null)).toBe("Prazo");
      expect(rotuloDoPrazo(undefined)).toBe("Prazo");
    });
  });
});
