import { Icone } from './Icone'
import {
  camposPreenchiveis,
  instrucoesDoModelo,
  listaDeValores,
  totalPendentes,
  type Marcador,
  type ValorCampo,
} from '../lib/malaDireta'

/**
 * Formulário das lacunas do modelo, exibido antes do editor do documento.
 *
 * Antes, as lacunas chegavam cruas no editor e o analista precisava caçar cada
 * `[NOME DA EMPRESA]` no meio do texto.
 *
 * A tela é deliberadamente seca: um campo por lacuna, sem texto explicativo em
 * volta. Campo livre tem um "+" para acrescentar valores — vários sócios,
 * vários vistoriadores, várias irregularidades —, porque a quantidade vem do
 * caso e não do modelo. Não bloqueia o envio: lacuna em branco continua
 * marcada no documento, para o analista resolver no editor.
 */
export function MalaDiretaForm({
  marcadores,
  valores,
  onChange,
}: {
  marcadores: Marcador[]
  valores: Record<string, ValorCampo>
  onChange: (id: string, valor: ValorCampo) => void
}) {
  const campos = camposPreenchiveis(marcadores)
  const instrucoes = instrucoesDoModelo(marcadores)
  const pendentes = totalPendentes(marcadores, valores)

  if (campos.length === 0 && instrucoes.length === 0) return null

  return (
    <div className="space-y-4">
      {campos.length > 0 && (
        <>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h4 className="text-label-lg text-primary">Dados do documento</h4>
            <p className="text-label-sm text-on-surface-variant">
              {pendentes === 0 ? 'Tudo preenchido' : `${pendentes} em branco`}
            </p>
          </div>

          {/* Colunas com preenchimento vertical: os itens se encaixam sem
              espaço vazio, como ladrilhos. CSS columns faz isso nativamente —
              cada item vai para onde cabe, sem deixar buraco quando o vizinho
              é mais alto. */}
          <div className="columns-1 md:columns-2 gap-x-4" style={{ columnFill: 'balance' }}>
            {campos.flatMap((marcador) =>
              marcador.multivalor
                ? renderMultivalor(marcador, valores[marcador.id], (v) => onChange(marcador.id, v))
                : [<CampoSimples
                    key={marcador.id}
                    marcador={marcador}
                    valor={valores[marcador.id]}
                    onChange={(v) => onChange(marcador.id, v)}
                  />]
            )}
          </div>
        </>
      )}

      {instrucoes.length > 0 && (
        <details className="text-label-sm text-on-surface-variant">
          <summary className="cursor-pointer hover:text-primary">
            {instrucoes.length === 1
              ? '1 observação do modelo'
              : `${instrucoes.length} observações do modelo`}
          </summary>
          {/* Não são lacunas de valor: são recados de quem redigiu o modelo
              ("excluir este parágrafo se..."), resolvidos no editor. */}
          <ul className="mt-1 space-y-0.5 pl-4">
            {instrucoes.map((m) => (
              <li key={m.id} className="text-[11px] list-disc">{m.rotulo}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** Rótulo do campo: primeira palavra maiúscula, restante minúscula. */
function rotuloCurto(marcador: Marcador): string {
  const bruto = marcador.rotulo.trim()
  const limpo = bruto.replace(/^(inserir|indicar|informar)\s+(o|a|os|as|no|na)?\s*/i, '')
  const texto = limpo || bruto
  const curto = texto.length > 48 ? `${texto.slice(0, 48)}...` : texto
  // Sentence case: primeira letra maiúscula, restante minúscula.
  return curto.charAt(0).toUpperCase() + curto.slice(1).toLowerCase()
}

const CLASSE_CAMPO =
  'w-full bg-white border border-outline-variant rounded-lg px-3 py-1.5 text-body-md ' +
  'text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container/40'

/** Campo simples: uma célula da grade (rótulo + input/select). */
function CampoSimples({
  marcador,
  valor,
  onChange,
}: {
  marcador: Marcador
  valor: ValorCampo | undefined
  onChange: (valor: ValorCampo) => void
}) {
  const id = `marcador-${marcador.id}`
  const atual = typeof valor === 'string' ? valor : (Array.isArray(valor) ? valor[0] ?? '' : '')

  return (
    <div className="flex flex-col gap-1 min-w-0 mb-3 break-inside-avoid">
      <label
        htmlFor={id}
        className="text-label-sm text-on-surface-variant truncate"
        title={marcador.contexto ?? marcador.rotulo}
      >
        {rotuloCurto(marcador)}
      </label>

      {marcador.tipo === 'escolha' ? (
        <select
          id={id}
          className={CLASSE_CAMPO}
          value={atual}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Escolha...</option>
          {marcador.opcoes.map((opcao) => (
            <option key={opcao} value={opcao}>{opcao}</option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type="text"
          className={CLASSE_CAMPO}
          value={atual}
          onChange={(e) => onChange(e.target.value)}
          placeholder={marcador.tipo === 'data' ? 'dd/mm/aaaa' : ''}
        />
      )}
    </div>
  )
}

/**
 * Campo multivalor: cada input é um item direto da grade de 2 colunas.
 * O primeiro input tem o rótulo em cima e o "Acrescentar" embaixo.
 * Os adicionados são itens normais da grade — preenchem esquerda/direita.
 */
function renderMultivalor(
  marcador: Marcador,
  valor: ValorCampo | undefined,
  onChange: (valor: ValorCampo) => void,
): JSX.Element[] {
  const lista = listaDeValores(valor)
  const id = `marcador-${marcador.id}`

  function trocar(posicao: number, texto: string) {
    const nova = [...lista]
    nova[posicao] = texto
    onChange(nova)
  }

  function remover(posicao: number) {
    onChange(lista.filter((_, i) => i !== posicao))
  }

  return lista.map((atual, posicao) => (
    <div key={`${marcador.id}-${posicao}`} className="flex flex-col gap-1 min-w-0 mb-3 break-inside-avoid">
      {/* Rótulo só no primeiro */}
      {posicao === 0 && (
        <label
          htmlFor={id}
          className="text-label-sm text-on-surface-variant truncate"
          title={marcador.contexto ?? marcador.rotulo}
        >
          {rotuloCurto(marcador)}
        </label>
      )}

      <div className="flex items-center gap-1">
        <textarea
          id={posicao === 0 ? id : undefined}
          rows={1}
          className={`${CLASSE_CAMPO} resize-none overflow-hidden`}
          value={atual}
          onChange={(e) => {
            trocar(posicao, e.target.value)
            // Auto-resize: cresce com o conteúdo, encolhe ao apagar.
            e.target.style.height = 'auto'
            e.target.style.height = `${e.target.scrollHeight}px`
          }}
          onInput={(e) => {
            const el = e.target as HTMLTextAreaElement
            el.style.height = 'auto'
            el.style.height = `${el.scrollHeight}px`
          }}
          placeholder=""
          aria-label={posicao === 0
            ? rotuloCurto(marcador)
            : `${rotuloCurto(marcador)} — valor ${posicao + 1}`}
        />
        {lista.length > 1 && (
          <button
            type="button"
            onClick={() => remover(posicao)}
            className="shrink-0 p-1 text-outline hover:text-error rounded"
            aria-label={`Remover valor ${posicao + 1} de ${rotuloCurto(marcador)}`}
            title="Remover"
          >
            <Icone nome="close" className="text-[16px]" />
          </button>
        )}
      </div>

      {/* "Acrescentar" embaixo do último input */}
      {posicao === lista.length - 1 && (
        <button
          type="button"
          onClick={() => onChange([...lista, ''])}
          className="self-start text-[11px] text-primary hover:underline inline-flex items-center gap-0.5"
        >
          <Icone nome="add" className="text-[14px]" />
          Acrescentar
        </button>
      )}
    </div>
  ))
}
