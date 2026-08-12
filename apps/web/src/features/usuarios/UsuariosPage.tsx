import { useEffect, useMemo, useState } from 'react'
import { Icone } from '../../components/Icone'
import { FiltroColuna } from '../../components/FiltroColuna'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { listarUsuarios, criarUsuario, atualizarUsuario, desativarUsuario } from './api'
import type { Usuario } from './api'

const CLASSE_TH = 'px-6 py-4 text-label-sm uppercase text-on-surface-variant tracking-wider bg-surface-container-low whitespace-nowrap'

/** Os seis perfis da Documentação de Negócio v3.0, na ordem hierárquica.
 *  Espelha `PERFIS` em backend/app/core/security.py. */
const PERFIS = [
  { valor: 'analista', label: 'Conferente / Analista' },
  { valor: 'chefe_servico', label: 'Chefe de Serviço' },
  { valor: 'chefe_divisao', label: 'Chefe de Divisão' },
  { valor: 'coordenador', label: 'Coordenador' },
  { valor: 'coordenador_geral', label: 'Coordenador Geral' },
  { valor: 'consultoria_juridica', label: 'Consultoria Jurídica' },
]

const ROTULO_PERFIL: Record<string, string> = Object.fromEntries(
  PERFIS.map((p) => [p.valor, p.label]),
)

export function UsuariosPage() {
  useDocumentTitle('Gestão de Usuários')
  const [itens, setItens] = useState<Usuario[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [filtroPerfil, setFiltroPerfil] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  // Formulário
  const [formAberto, setFormAberto] = useState(false)
  const [editando, setEditando] = useState<Usuario | null>(null)
  const [email, setEmail] = useState('')
  const [nome, setNome] = useState('')
  const [perfil, setPerfil] = useState('analista')
  const [idUnidade, setIdUnidade] = useState('')
  const [ativo, setAtivo] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erroForm, setErroForm] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setCarregando(true)
      listarUsuarios(busca || undefined, !mostrarInativos)
        .then(setItens)
        .catch((e) => setErro(String(e)))
        .finally(() => setCarregando(false))
    }, 300)
    return () => clearTimeout(t)
  }, [busca, mostrarInativos])

  const itensFiltrados = useMemo(() => {
    if (!filtroPerfil) return itens
    return itens.filter(u => u.perfil === filtroPerfil)
  }, [itens, filtroPerfil])

  function abrirNovo() {
    setEditando(null)
    setEmail('')
    setNome('')
    setPerfil('analista')
    setIdUnidade('')
    setAtivo(true)
    setErroForm(null)
    setFormAberto(true)
  }

  function abrirEditar(u: Usuario) {
    setEditando(u)
    setEmail(u.email)
    setNome(u.nome ?? '')
    setPerfil(u.perfil ?? 'analista')
    setIdUnidade(u.id_unidade ?? '')
    setAtivo(u.ativo)
    setErroForm(null)
    setFormAberto(true)
  }

  async function salvar() {
    if (!email.trim()) {
      setErroForm('Preencha o email.')
      return
    }
    setSalvando(true)
    setErroForm(null)
    try {
      const dados = {
        email: email.trim(),
        nome: nome.trim() || null,
        perfil: perfil || null,
        id_unidade: idUnidade.trim() || null,
        ativo,
      }
      if (editando) {
        await atualizarUsuario(editando.id, dados)
      } else {
        await criarUsuario(dados)
      }
      setFormAberto(false)
      const lista = await listarUsuarios(busca || undefined, !mostrarInativos)
      setItens(lista)
    } catch (e) {
      setErroForm(e instanceof Error ? e.message : String(e))
    } finally {
      setSalvando(false)
    }
  }

  async function handleDesativar(u: Usuario) {
    if (!window.confirm(`Desativar o usuário "${u.nome || u.email}"? Ele perderá o acesso ao sistema.`)) return
    try {
      await desativarUsuario(u.id)
      setItens((prev) => prev.map((i) => i.id === u.id ? { ...i, ativo: false } : i))
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
          <span className="text-primary font-bold">Gestão de Usuários</span>
        </nav>
        <h1 className="text-headline-lg text-primary">Gestão de Usuários e Acessos</h1>
        <p className="text-body-lg text-on-surface-variant">
          Gerencie quem tem acesso ao sistema e com qual perfil. Apenas coordenadores podem acessar esta tela.
        </p>
      </div>

      <div className="bg-surface-container-lowest p-5 rounded-xl border border-outline-variant shadow-card flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center bg-surface-container-low rounded-lg px-3 py-2 flex-1 min-w-[240px] focus-within:ring-2 focus-within:ring-primary-container/30">
          <Icone nome="search" className="text-outline text-[20px]" />
          <input
            type="search"
            className="bg-transparent border-none outline-none ml-2 w-full text-body-md placeholder:text-outline"
            placeholder="Buscar por nome ou email"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            aria-label="Buscar usuário"
          />
        </div>
        <label className="flex items-center gap-2 text-body-md text-on-surface shrink-0">
          <input
            type="checkbox"
            checked={mostrarInativos}
            onChange={(e) => setMostrarInativos(e.target.checked)}
          />
          Mostrar inativos
        </label>
        <button
          onClick={abrirNovo}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-label-lg hover:bg-primary-container transition-colors shadow-card shrink-0"
        >
          <Icone nome="person_add" className="text-[18px]" />
          Novo Usuário
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
          <Icone nome="group_off" className="text-4xl text-outline-variant" />
          <p className="mt-2">Nenhum usuário cadastrado.</p>
        </div>
      )}

      {!erro && itens.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-card overflow-hidden">
          <div className="px-6 py-4 border-b border-outline-variant">
            <p className="text-body-md text-on-surface-variant">
              <span className="font-bold text-on-surface">{itensFiltrados.length}</span>{' '}
              {itensFiltrados.length === 1 ? 'usuário' : 'usuários'}
              {filtroPerfil ? ' (filtrado)' : ''}
            </p>
          </div>
          <div className="overflow-auto max-h-[max(320px,calc(100vh-330px))]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className={CLASSE_TH}>Nome</th>
                  <th className={CLASSE_TH}>Email</th>
                  <th className={CLASSE_TH}>
                    <div className="flex items-center gap-1">
                      <span>Perfil</span>
                      <FiltroColuna coluna="Perfil" ativo={Boolean(filtroPerfil)} onLimpar={() => setFiltroPerfil('')}>
                        <select
                          value={filtroPerfil}
                          onChange={(e) => setFiltroPerfil(e.target.value)}
                          className="w-full bg-white border border-outline-variant rounded px-2 py-1.5 text-[12px] text-on-surface-variant"
                        >
                          <option value="">Todos</option>
                          {PERFIS.map((p) => (
                            <option key={p.valor} value={p.valor}>{p.label}</option>
                          ))}
                        </select>
                      </FiltroColuna>
                    </div>
                  </th>
                  <th className={CLASSE_TH}>Unidade</th>
                  <th className={CLASSE_TH}>Status</th>
                  <th className={`${CLASSE_TH} text-center`}>Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/40">
                {itensFiltrados.map((u) => (
                  <tr key={u.id} className={`transition-colors ${!u.ativo ? 'opacity-50' : 'hover:bg-surface-container-low/50'}`}>
                    <td className="px-6 py-4 text-body-md text-on-surface font-semibold">{u.nome || '-'}</td>
                    <td className="px-6 py-4 text-body-md text-on-surface-variant">{u.email}</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-[12px] font-bold ${
                        u.perfil === 'coordenador' || u.perfil === 'coordenador_geral'
                          ? 'bg-primary-fixed/40 text-on-primary-fixed-variant'
                          : 'bg-surface-container-high text-on-surface-variant'
                      }`}>
                        {ROTULO_PERFIL[u.perfil ?? ''] ?? 'Conferente / Analista'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-body-md text-on-surface-variant tabular-nums">{u.id_unidade || '-'}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                        u.ativo ? 'bg-tertiary-fixed/30 text-tertiary' : 'bg-error-container/40 text-error'
                      }`}>
                        {u.ativo ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => abrirEditar(u)}
                          className="p-1.5 rounded-full hover:bg-surface-container-high transition-colors"
                          title="Editar"
                          aria-label={`Editar ${u.nome || u.email}`}
                        >
                          <Icone nome="edit" className="text-[18px] text-primary" />
                        </button>
                        {u.ativo && (
                          <button
                            onClick={() => handleDesativar(u)}
                            className="p-1.5 rounded-full hover:bg-error-container/30 transition-colors"
                            title="Desativar"
                            aria-label={`Desativar ${u.nome || u.email}`}
                          >
                            <Icone nome="person_off" className="text-[18px] text-error" />
                          </button>
                        )}
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
                {editando ? 'Editar Usuário' : 'Novo Usuário'}
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
                <span className="text-label-md text-on-surface-variant">Email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
                  placeholder="usuario@detran.sp.gov.br"
                  autoFocus
                />
              </label>
              <label className="block">
                <span className="text-label-md text-on-surface-variant">Nome</span>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
                  placeholder="Nome completo"
                />
              </label>
              <label className="block">
                <span className="text-label-md text-on-surface-variant">Perfil</span>
                <select
                  value={perfil}
                  onChange={(e) => setPerfil(e.target.value)}
                  className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md bg-white"
                >
                  {PERFIS.map((p) => (
                    <option key={p.valor} value={p.valor}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-label-md text-on-surface-variant">Unidade SEI (ID)</span>
                <input
                  type="text"
                  value={idUnidade}
                  onChange={(e) => setIdUnidade(e.target.value)}
                  className="w-full mt-1 border border-outline-variant rounded-lg px-3 py-2 text-body-md"
                  placeholder="Ex: 110053117"
                />
                <p className="text-[11px] text-on-surface-variant mt-1">
                  Deixe vazio para acesso a todas as unidades (coordenadores).
                </p>
              </label>
              {editando && (
                <label className="flex items-center gap-2 text-body-md text-on-surface">
                  <input
                    type="checkbox"
                    checked={ativo}
                    onChange={(e) => setAtivo(e.target.checked)}
                  />
                  Usuário ativo
                </label>
              )}
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
