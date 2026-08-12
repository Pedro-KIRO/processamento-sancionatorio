import type { Anotacao } from "@prisma/client";

/**
 * Formato de saída das anotações — em **snake_case**.
 *
 * Por que mapear à mão em vez de devolver o objeto do Prisma direto:
 *
 * O frontend consome `caixa_entrada_id` e `criado_em` (ver o tipo `Anotacao` em
 * apps/web/src/features/analise/types.ts), porque foi escrito contra o FastAPI,
 * que serializa os nomes das colunas. O Prisma devolve camelCase
 * (`caixaEntradaId`, `criadoEm`).
 *
 * Durante a migração os dois backends atendem o mesmo `/api` através da ponte,
 * então precisam responder no MESMO formato: se um endpoint migrado devolvesse
 * camelCase, a tela quebraria só naquele pedaço — e o sintoma seria campo vazio
 * na interface, não erro de rede.
 *
 * Trocar tudo para camelCase é uma mudança de contrato que vale a pena, mas é
 * decisão separada e envolve as 82 telas de uma vez. Enquanto isso, a conversão
 * fica explícita aqui, num lugar só por domínio.
 */
export interface AnotacaoResposta {
  id: number;
  caixa_entrada_id: number;
  autor: string | null;
  texto: string;
  criado_em: string;
}

export function paraResposta(anotacao: Anotacao): AnotacaoResposta {
  return {
    id: anotacao.id,
    caixa_entrada_id: anotacao.caixaEntradaId,
    autor: anotacao.autor,
    texto: anotacao.texto,
    criado_em: anotacao.criadoEm.toISOString(),
  };
}
