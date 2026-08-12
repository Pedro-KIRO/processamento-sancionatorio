import { useMemo, useState } from 'react'

import { BotaoPrioridade } from '../../components/BotaoPrioridade'
import { FiltroColuna } from '../../components/FiltroColuna'
import { Icone } from '../../components/Icone'
import { formatarData, formatarRazaoSocial, formatarTexto, mascararDocumento, montarLinkSei } from '../../lib/format'
import { alterarPrioridade } from '../processosAndamento/api'
import {
  BORDA_SEMAFORO,
  CLASSE_SEMAFORO,
  PONTO_SEMAFORO,
  TEXTO_SEMAFORO,
  type FiltrosPrazos,
  type PrazoLinha,
} from './types'

interface Props {
  prazos: PrazoLinha[]
  podePriorizar: boolean
  /** Recarrega a lista depois de priorizar, para a ordem acompanhar. */
  onAtualizar: () => void
  onAbrirProcesso: (caixaEntradaId: number) => void
  /*
    Filtros ficam na página, que é quem consulta a API; aqui só são editados.
    A tabela cuida apenas do filtro de vencimento, que é o único de coluna —
    agente regulado, tipo, situação e responsável ficam na barra acima, para não
    haver o mesmo filtro em dois lugares.
  */
  filtros: FiltrosPrazos
  onFiltrar: (mudanca: Partial<FiltrosPrazos>) => void
}

/*
  Sem `whitespace-nowrap`: rótulo comprido como "Contagem regressiva" pode
  quebrar em duas linhas no cabeçalho. Com o nowrap, ele forçava a coluna a ter a
  largura do texto inteiro, e era uma das razões da barra de rolagem lateral.
  Cabeçalho em duas linhas não incomoda; rolagem horizontal incomoda.
*/
const CLASSE_TH =
  'px-3 py-3 text-label-sm uppercase text-on-surface-variant tracking-wider bg-surface-container-low align-bottom'

const CLASSE_CAMPO_FILTRO =
  'w-full bg-white border border-outline-variant rounded px-2 py-1.5 text-[12px] text-on-surface-variant'

/** Colunas pelas quais a tabela ordena. */
type Campo =
  | 'numero_sei'
  | 'interessado'
  | 'agente_regulado'
  | 'tipo_prazo'
  | 'data_vencimento'
  | 'dias_restantes'
  | 'semaforo'
  | 'responsavel'

/* Do mais urgente para o menos urgente, para a coluna Situação ordenar por
   urgência e não pela ordem alfabética da cor. */
const URGENCIA: Record<string, number> = { vermelho: 0, amarelo: 1, verde: 2 }

function valorDe(p: PrazoLinha, campo: Campo): string | number {
  if (campo === 'dias_restantes') return p.dias_restantes ?? Number.MAX_SAFE_INTEGER
  if (campo === 'semaforo') return URGENCIA[p.semaforo ?? ''] ?? 9
  // Datas vêm em 'YYYY-MM-DD', que já ordena corretamente como texto.
  return (p[campo] ?? '').toString().toLocaleLowerCase('pt-BR')
}

interface Ordem {
  campo: Campo
  asc: boolean
}

/**
 * Cabeçalho da coluna: rótulo clicável para ordenar e, quando a coluna tem
 * filtro, o ícone de funil ao lado — mesma composição de Caixa de Entrada e
 * Processos em Andamento.
 *
 * Fica fora de `PrazosLista` de propósito: declarado dentro, seria um tipo de
 * componente novo a cada render, e o React remontaria o cabeçalho inteiro a
 * cada clique.
 */
function ColunaTabela({
  campo, rotulo, ordem, onAlternar, children,
}: {
  campo: Campo
  rotulo: string
  ordem: Ordem | null
  onAlternar: (campo: Campo) => void
  children?: React.ReactNode
}) {
  const ativa = ordem?.campo === campo
  return (
    <th
      className={CLASSE_TH}
      aria-sort={ativa ? (ordem.asc ? 'ascending' : 'descending') : 'none'}
    >
      <div className="flex items-center gap-1">
        <button
          onClick={() => onAlternar(campo)}
          className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-primary ${
            ativa ? 'text-primary' : ''
          }`}
          title={`Ordenar por ${rotulo}`}
        >
          {rotulo}
          <Icone
            nome={ativa ? (ordem.asc ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
            className={`text-[14px] ${ativa ? 'text-primary' : 'text-outline-variant'}`}
          />
        </button>
        {children}
      </div>
    </th>
  )
}

/**
 * Modo lista da tela de Controle de Prazos.
 *
 * É a visão padrão porque o trabalho diário é por prazo nominal: o analista
 * quer a fila ordenada pela urgência, não um panorama do mês.
 *
 * Nomes das colunas conforme o texto do documento de negócio — "Agente
 * regulado" e "Contagem regressiva". Antes eram "Segmento" e "Restante", que eu
 * havia tirado da figura; "Segmento" nem existe como conceito nesta tela, o dado
 * exibido sempre foi o agente regulado.
 *
 * Os filtros por coluna ficam no ícone de funil do cabeçalho, como nas outras
 * tabelas do projeto. A busca livre fica na barra acima, na primeira posição.
 *
 * A ordenação acontece no cliente, sobre a resposta que já está em memória — não
 * vale uma ida ao servidor para reordenar o que a tela inteira já tem. Sem
 * coluna escolhida, vale a ordem do backend: priorizados na frente e depois os
 * mais urgentes. Ao escolher uma coluna, a ordem passa a ser estritamente a
 * pedida — deixar os priorizados grudados no topo faria a tabela parecer
 * quebrada para quem acabou de clicar em "Vencimento". O ★ e o destaque da linha
 * continuam marcando a prioridade.
 */
export function PrazosLista({
  prazos, podePriorizar, onAtualizar, onAbrirProcesso, filtros, onFiltrar,
}: Props) {
  const [ordem, setOrdem] = useState<Ordem | null>(null)

  const ordenados = useMemo(() => {
    if (!ordem) return prazos
    const copia = [...prazos]
    copia.sort((a, b) => {
      const va = valorDe(a, ordem.campo)
      const vb = valorDe(b, ordem.campo)
      if (va === vb) return 0
      const menor = va < vb ? -1 : 1
      return ordem.asc ? menor : -menor
    })
    return copia
  }, [prazos, ordem])

  /* Três estados por coluna: crescente, decrescente e volta à ordem do backend
     (priorizados na frente, depois os mais urgentes). */
  function alternar(campo: Campo) {
    setOrdem((o) => (o?.campo === campo ? (o.asc ? { campo, asc: false } : null) : { campo, asc: true }))
  }

  return (
    /*
      Sem largura mínima na tabela: era o `min-w-[1180px]` que criava a barra de
      rolagem lateral, porque obrigava a tabela a ser mais larga que a área
      disponível mesmo quando o conteúdo caberia. As outras tabelas do projeto
      não têm largura mínima, e é por isso que mostram tudo de uma vez.

      O `overflow-auto` fica como rede de segurança para janela muito estreita —
      melhor poder rolar do que perder coluna.
    */
    <div className="overflow-auto max-h-[max(320px,calc(100vh-430px))]">
      <table className="w-full text-left border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-surface-container-low border-b border-outline-variant">
            <th className={`${CLASSE_TH} w-10 text-center`} title="Priorização da Coordenação">★</th>

            <ColunaTabela campo="numero_sei" rotulo="Processo (SEI)" ordem={ordem} onAlternar={alternar} />
            <ColunaTabela campo="interessado" rotulo="Interessado" ordem={ordem} onAlternar={alternar} />

            <ColunaTabela campo="agente_regulado" rotulo="Agente regulado" ordem={ordem} onAlternar={alternar} />
            <ColunaTabela campo="tipo_prazo" rotulo="Tipo de prazo" ordem={ordem} onAlternar={alternar} />

            {/* Uma coluna só para as duas datas, como o documento escreve
                ("Início / Vencimento | Datas do prazo"). Eram duas colunas, e
                juntá-las devolve largura sem perder informação. A ordenação é
                pelo vencimento, que é o que interessa na fila. */}
            <ColunaTabela campo="data_vencimento" rotulo="Início / Vencimento" ordem={ordem} onAlternar={alternar}>
              <FiltroColuna
                coluna="Vencimento"
                ativo={Boolean(filtros.venc_de || filtros.venc_ate)}
                onLimpar={() => onFiltrar({ venc_de: '', venc_ate: '' })}
              >
                <div className="space-y-2">
                  <label className="block">
                    <span className="text-[11px] text-on-surface-variant">De</span>
                    <input
                      type="date"
                      value={filtros.venc_de ?? ''}
                      onChange={(e) => onFiltrar({ venc_de: e.target.value })}
                      className={CLASSE_CAMPO_FILTRO}
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-on-surface-variant">Até</span>
                    <input
                      type="date"
                      value={filtros.venc_ate ?? ''}
                      onChange={(e) => onFiltrar({ venc_ate: e.target.value })}
                      className={CLASSE_CAMPO_FILTRO}
                    />
                  </label>
                </div>
              </FiltroColuna>
            </ColunaTabela>

            <ColunaTabela campo="dias_restantes" rotulo="Contagem regressiva" ordem={ordem} onAlternar={alternar} />
            <ColunaTabela campo="semaforo" rotulo="Situação" ordem={ordem} onAlternar={alternar} />
            <ColunaTabela campo="responsavel" rotulo="Responsável" ordem={ordem} onAlternar={alternar} />
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/40">
          {ordenados.map((p) => {
            const cor = p.semaforo
            const link = p.numero_sei ? montarLinkSei(p.numero_sei, p.id_procedimento) : ''
            return (
              <tr
                key={p.id}
                className={`transition-colors border-l-4 ${
                  cor ? BORDA_SEMAFORO[cor] : 'border-l-transparent'
                } ${p.prioritario ? 'bg-primary-fixed/15' : 'hover:bg-surface-container-low/50'}`}
              >
                <td className="px-2 py-3 text-center">
                  <BotaoPrioridade
                    prioritario={p.prioritario}
                    justificativa={p.prioridade_justificativa}
                    podeEditar={podePriorizar}
                    onAlterar={async (novo, motivo) => {
                      await alterarPrioridade(p.caixa_entrada_id, novo, motivo)
                      onAtualizar()
                    }}
                  />
                </td>
                {/* `whitespace-nowrap`: o número do SEI quebrava em duas linhas
                    no meio, depois da barra. É um número único, tem que ficar
                    inteiro numa linha. */}
                <td className="px-3 py-3 text-label-lg tabular-nums whitespace-nowrap">
                  {p.numero_sei ? (
                    link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                        title="Abrir no SEI"
                      >
                        {p.numero_sei}
                        <Icone nome="open_in_new" className="text-[14px] text-outline" />
                      </a>
                    ) : (
                      <span className="text-primary">{p.numero_sei}</span>
                    )
                  ) : (
                    '-'
                  )}
                </td>
                <td
                  className="px-3 py-3 text-body-md text-on-surface-variant max-w-[170px] truncate"
                  title={p.interessado ?? ''}
                >
                  {formatarRazaoSocial(p.interessado)}
                  {p.cnpj_cpf && (
                    <span className="block text-[11px] text-outline tabular-nums">
                      {mascararDocumento(p.cnpj_cpf)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className="px-2 py-0.5 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant text-[11px] font-bold">
                    {formatarTexto(p.agente_regulado)}
                  </span>
                </td>
                <td className="px-3 py-3 text-body-md text-on-surface-variant">
                  {p.tipo_prazo ?? '-'}
                  {p.base_legal && (
                    <span className="block text-[11px] text-outline">{p.base_legal}</span>
                  )}
                </td>
                <td className="px-3 py-3 text-body-md text-on-surface-variant tabular-nums whitespace-nowrap">
                  {formatarData(p.data_vencimento)}
                  <span className="block text-[11px] text-outline">
                    início {formatarData(p.data_inicio)}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span
                    className={`font-bold tabular-nums whitespace-nowrap ${cor ? TEXTO_SEMAFORO[cor] : 'text-on-surface-variant'}`}
                  >
                    {p.restante_rotulo ?? '—'}
                  </span>
                </td>
                <td className="px-3 py-3">
                  {cor && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-bold inline-flex items-center gap-1 whitespace-nowrap ${CLASSE_SEMAFORO[cor]}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${PONTO_SEMAFORO[cor]}`} />
                      {p.situacao_rotulo}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-body-md text-on-surface-variant">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate max-w-[110px]" title={p.responsavel ?? ''}>
                      {p.responsavel ?? <span className="text-outline italic">Sem atribuição</span>}
                    </span>
                    <button
                      onClick={() => onAbrirProcesso(p.caixa_entrada_id)}
                      className="p-1 rounded-full hover:bg-surface-container-high transition-colors shrink-0"
                      title="Abrir o processo no app"
                      aria-label={`Abrir processo ${p.numero_sei ?? ''}`}
                    >
                      <Icone nome="visibility" className="text-[18px] text-primary" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
