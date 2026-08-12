import { useEffect, useState } from 'react'
import { Icone } from '../../components/Icone'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import {
  listarAdvogados,
  criarAdvogado,
  atualizarAdvogado,
  excluirAdvogado,
  buscarPorOab,
} from './api'
import type { Advogado } from './api'

const CLASSE_TH = 'px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider bg-surface-container-low whitespace-nowrap'

export function AdvogadosPage() {
  useDocumentTitle('Advogados')
  const [itens, setItens] = useState<Advogado[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  // Formulário
  const [formAberto, setFormAberto] = useState(false)
  const [editando, setEditando] = useState<Advogado | null>(null)
  const [nome, setNome] = useState('')
  const [oab, setOab] = useState('')
  const [email, setEmail] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)
  const [avisoOab, setAvisoOab] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setCarregando(true)
      listarAdvogados(busca || undefined)
        .then(setItens)
        .catch((e) => setErro(String(e)))
        .finally(() => setCarregando(false))
    }, 300)
    return () => clearTimeout(t)
  }, [busca])

  function abrirNovo() {
    setEditando(null)
    setNome('')
    setOab('')
    setEmail('')
    setErroForm(null)
    setAvisoOab(null)
    setFormAberto(true)
  }

  function abrirEditar(adv: Advogado) {
    setEditando(adv)
    setNome(adv.nome)
    setOab(adv.oab)
    setEmail(adv.email ?? '')
    setErroForm(null)
    setAvisoOab(null)
    setFormAberto(true)
  }

  async function verificarOab() {
    if (!oab.trim()) return
    if (editando && oab.trim().toUpperCase() === editando.oab) return
    try {
      const res = await buscarPorOab(oab.trim())
      if (res.encontrado && res.advogado) {
        setAvisoOab(`OAB já cadastrada para: ${res.advogado.nome}`)
      } else {
        setAvisoOab(null)
      }
    } catch {
      // Silencioso
    }
  }

  async function salvar() {
    if (!nome.trim() || !oab.trim()) {
      setErroForm('Preencha nome e OAB.')
      return
    }
    setSalvando(true)
    setErroForm(null)
    try {
      if (editando) {
        await atualizarAdvogado(editando.id, nome.trim(), oab.trim(), email.trim())
      } else {
        await criarAdvogado(nome.trim(), oab.trim(), email.trim())
      }
      setFormAberto(false)
      // Recarregar lista
      const lista = await listarAdvogados(busca || undefined)
      setItens(lista)
    } catch (e) {
      setErroForm(e instanceof Error ? e.message : String(e))
    } finally {
      setSalvando(false)
    }
  }

  async function handleExcluir(adv: Advogado) {
    if (!window.confirm(`Excluir o advogado "${adv.nome}" (OAB ${adv.oab})?`)) return
    try {
      await excluirAdvogado(adv.id)
      setItens((prev) => prev.filter((a) => a.id !== adv.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-stack-lg">
      <div>
        <nav className="flex items-center gap-2 text-label-sm text-outline mb-2">
          <a href="/" className="hover:text-primary hover:underline">Início</a>
          <Icone nome="chevron_right" className="text-[14px]" />
          <span className="text-primary font-bold">Advogados</span>
        </nav>
        <h1 className="text-headline-lg text-primary">Advogados / Procuradores</h1>
        <p className="text-body-lg text-on-surface-variant">
          Cadastro de advogados que representam os interessados nos processos.
        </p>
      </div>

      <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant shadow-card flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center bg-surface-container-low rounded-lg px-3 py-2 flex-1 min-w-[240px] focus-within:ring-2 focus-within:ring-primary-container/30">
          <Icone nome="search" className="text-outline text-[20px]" />
          <input
            type="search"
            className="bg-transparent border-none outline-none ml-2 w-full text-body-md placeholder:text-outline"
            placeholder="Buscar por nome, OAB ou email"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar advogado"
          />
        </div>
        <button
          onClick={abrirNovo}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-label-lg hover:bg-primary-container transition-colors shadow-card shrink-0"
        >
          <Icone nome="person_add" className="text-[18px]" />
          Novo Advogado
        </button>
      </div>

      {carregando && (
        <div className="flex items-center justify-center py-12 gap-3 text-on-surface-variant">
          <Icone nome="progress_activity" className="animate-spin text-[22px] text-primary" />
          <span className="text-body-lg">Carregando...</span>
        </div>
      )}

      {erro && (
        <p role="alert" className="bg-error-container text-on-error-container px-4 py-3 rounded-lg">
          {erro}
        </p>
      )}

      {!carregando && !erro && itens.length === 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-10 text-center text-on-surface-variant">
          <Icone nome="person_off" className="text-4xl text-outline-variant" />
          <p className="mt-2">Nenhum advogado cadastrado.</p>
        </div>
      )}

      {!erro && itens.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-card overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant">
            <p className="text-body-md text-on-surface-variant">
              <span className="font-bold text-on-surface">{itens.length}</span>{' '}
              {itens.length === 1 ? 'advogado' : 'advogados'}
            </p>
          </div>
          <div className="overflow-auto max-h-[max(320px,calc(100vh-330px))]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className={CLASSE_TH}>Nome</th>
                  <th className={CLASSE_TH}>OAB</th>
                  <th className={CLASSE_TH}>Email</th>
                  <th className={CLASSE_TH}>Cadastrado em</th>
                  <th className={`${CLASSE_TH} text-center`}>Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {itens.map((adv) => (
                  <tr key={adv.id} className="hover:bg-surface-container-low/50 transition-colors">
                    <td className="px-6 py-4 text-body-md text-on-surface font-semibold">{adv.nome}</td>
                    <td className="px-6 py-4 text-body-md text-on-surface-variant tabular-nums">{adv.oab}</td>
                    <td className="px-6 py-4 text-body-md text-on-surface-variant">{adv.email ?? '-'}</td>
                    <td className="px-6 py-4 text-body-md text-on-surface-variant">
                      {adv.criado_em ? new Date(adv.criado_em).toLocaleDateString('pt-BR') : '-'}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => abrirEditar(adv)}
                          className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors"
                          title="Editar"
                          aria-label={`Editar ${adv.nome}`}
                        >
                          <Icone nome="edit" className="text-[18px] text-primary" />
                        </button>
                        <button
                          onClick={() => handleExcluir(adv)}
                          className="p-1.5 rounded-full hover:bg-error-container/30 transition-colors"
                          title="Excluir"
                          aria-label={`Excluir ${adv.nome}`}
                        >
                          <Icone nome="delete" className="text-[18px] text-error" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de cadastro/edição */}
      {formAberto && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest rounded-lg shadow-card w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant">
              <h3 className="text-headline-sm text-on-surface">
                {editando ? 'Editar Advogado' : 'Novo Advogado'}
              </h3>
              <button
                onClick={() => setFormAberto(false)}
                className="p-2 text-on-surface-variant hover:bg-surface-container-high rounded-full"
                aria-label="Fechar"
              >
                <Icone nome="close" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {erroForm && (
                <p role="alert" className="bg-error-container text-on-error-container px-3 py-2 rounded-lg text-body-md">
                  {erroForm}
                </p>
              )}
              <label className="block">
                <span className="text-label-md text-on-surface-variant">Nome completo</span>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
                  placeholder="Nome do advogado"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-label-md text-on-surface-variant">OAB</span>
                <input
                  type="text"
                  value={oab}
                  onChange={(e) => { setOab(e.target.value); setAvisoOab(null) }}
                  onBlur={verificarOab}
                  className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
                  placeholder="Ex: 123456/SP"
                />
                {avisoOab && (
                  <p className="text-[11px] text-tertiary mt-1 flex items-center gap-1">
                    <Icone nome="info" className="text-[14px]" />
                    {avisoOab}
                  </p>
                )}
              </label>
              <label className="block">
                <span className="text-label-md text-on-surface-variant">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
                  placeholder="email@exemplo.com"
                />
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant">
              <button
                onClick={() => setFormAberto(false)}
                className="px-4 py-2 border border-outline-variant text-on-surface-variant rounded-lg hover:bg-surface-container-high transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={salvando}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-container transition-colors disabled:opacity-50 inline-flex items-center gap-2"
              >
                {salvando && <Icone nome="progress_activity" className="animate-spin text-[16px]" />}
                {salvando ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
