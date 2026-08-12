import { useEffect, useState } from 'react'
import { Icone } from '../../components/Icone'
import { alterarAtribuicao, obterAtribuicao, type Atribuicao } from './api'
import { listarUsuarios, type Usuario } from '../usuarios/api'

interface Props {
  itemId: string
}

/**
 * Caixa de atribuição de responsável pelo processo.
 *
 * Mostra quem está responsável. Se o usuário é coordenador ou chefe de
 * divisão, permite editar (trocar o responsável via select de usuários ativos).
 */
export function CaixaAtribuicao({ itemId }: Props) {
  const [atribuicao, setAtribuicao] = useState<Atribuicao | null>(null)
  const [editando, setEditando] = useState(false)
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [selecionado, setSelecionado] = useState<number | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    obterAtribuicao(itemId).then(setAtribuicao).catch(() => {})
  }, [itemId])

  function abrirEdicao() {
    if (!atribuicao?.pode_editar) return
    setEditando(true)
    setSelecionado(atribuicao.responsavel_id ?? null)
    listarUsuarios(undefined, true).then(setUsuarios).catch(() => setUsuarios([]))
  }

  async function salvar() {
    setSalvando(true)
    try {
      const nova = await alterarAtribuicao(itemId, selecionado || null)
      setAtribuicao(nova)
      setEditando(false)
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setSalvando(false)
    }
  }

  if (!atribuicao) return null

  return (
    <div className="bg-surface-container-lowest rounded-lg border border-outline-variant shadow-card p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="text-label-lg text-on-surface uppercase tracking-wider flex items-center gap-2">
          <Icone nome="person" className="text-[18px] text-primary" />
          Responsável
        </h4>
        {atribuicao.pode_editar && !editando && (
          <button
            onClick={abrirEdicao}
            className="p-1 rounded-full hover:bg-surface-container-high transition-colors"
            title="Alterar responsável"
            aria-label="Alterar responsável"
          >
            <Icone nome="edit" className="text-[16px] text-primary" />
          </button>
        )}
      </div>

      {!editando ? (
        <div>
          {atribuicao.responsavel_nome ? (
            <p className="text-body-md text-on-surface font-semibold">
              {atribuicao.responsavel_nome}
            </p>
          ) : (
            <p className="text-body-md text-on-surface-variant italic">
              Nenhum responsável atribuído
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <select
            value={selecionado ?? ''}
            onChange={(e) => setSelecionado(e.target.value ? Number(e.target.value) : null)}
            className="w-full border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white"
            autoFocus
          >
            <option value="">Sem responsável</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome || u.email}{u.perfil ? ` (${u.perfil})` : ''}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <button
              onClick={salvar}
              disabled={salvando}
              className="px-3 py-1.5 bg-primary text-white rounded-lg text-label-md hover:brightness-110 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {salvando && <Icone nome="progress_activity" className="animate-spin text-[14px]" />}
              Salvar
            </button>
            <button
              onClick={() => setEditando(false)}
              className="px-3 py-1.5 border border-outline-variant text-on-surface-variant rounded-lg text-label-md hover:bg-surface-container-high"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
