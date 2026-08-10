import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { getMe, type Usuario } from '../features/me/api'
import { iniciais } from '../lib/format'
import { Icone } from './Icone'
import { NotificacoesDropdown } from './NotificacoesDropdown'
import { PesquisaGlobal } from './PesquisaGlobal'

type Item = {
  label: string
  icon: string
  to?: string
  /** Item que só aparece para o perfil de coordenação. */
  somenteCoordenador?: boolean
}

const MENU: Item[] = [
  { label: 'Início', icon: 'home', to: '/' },
  { label: 'Caixa de Entrada', icon: 'inbox', to: '/caixa-entrada' },
  { label: 'Processos em Andamento', icon: 'folder_open', to: '/processos' },
  { label: 'Consulta Unificada', icon: 'travel_explore', to: '/consulta-unificada' },
  { label: 'Prazos', icon: 'timer', to: '/prazos' },
  { label: 'Controle Interno', icon: 'notification_important', to: '/processos?filtro=controle_interno' },
  { label: 'Cautelares', icon: 'warning', to: '/cautelares' },
  { label: 'Decisões e Recursos', icon: 'gavel', to: '/processos?filtro=decisoes' },
  { label: 'Arquivamento', icon: 'inventory_2', to: '/processos?filtro=arquivamento' },
  {
    label: 'Textos-Padrão',
    icon: 'edit_document',
    to: '/textos-padroes',
    somenteCoordenador: true,
  },
  {
    label: 'Gestão de Acessos',
    icon: 'admin_panel_settings',
    to: '/usuarios',
    somenteCoordenador: true,
  },
  {
    label: 'Advogados',
    icon: 'person',
    to: '/advogados',
  },
  { label: 'Biblioteca', icon: 'library_books', to: '/biblioteca' },
]

const SIDEBAR_EXPANDED_W = '260px'
const SIDEBAR_COLLAPSED_W = '72px'

const CHAVE_MENU = 'menu-lateral-colapsado'

/**
 * Largura a partir da qual o menu cabe aberto sem apertar o conteúdo.
 *
 * Num notebook de 1366px, o menu aberto (260px) deixa ~1100px para a área de
 * trabalho — o suficiente para as tabelas largas começarem a cortar coluna e
 * para a análise de processo ficar com a lista de documentos estreita. Abaixo
 * deste limite o menu começa recolhido, e o usuário abre se quiser.
 */
const LARGURA_MINIMA_MENU_ABERTO = 1440

function menuComecaColapsado(): boolean {
  if (typeof window === 'undefined') return false

  const salvo = window.localStorage.getItem(CHAVE_MENU)
  if (salvo !== null) return salvo === 'true'

  return window.innerWidth < LARGURA_MINIMA_MENU_ABERTO
}

export function Layout() {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [colapsada, setColapsada] = useState(menuComecaColapsado)
  const location = useLocation()

  useEffect(() => {
    getMe().then(setUsuario).catch(() => setUsuario(null))
  }, [])

  function alternarMenu() {
    setColapsada((atual) => {
      const proximo = !atual
      // Escolha explícita do usuário prevalece sobre o padrão por resolução.
      window.localStorage.setItem(CHAVE_MENU, String(proximo))
      return proximo
    })
  }

  const nome = usuario?.nome ?? 'Usuário'
  const primeiro = nome.split(' ')[0]

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {/* Sidebar */}
      <aside
        className="hidden lg:flex flex-col fixed left-0 top-0 h-full bg-surface-container-lowest border-r border-outline-variant py-stack-lg z-50 transition-all duration-300"
        style={{ width: colapsada ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W }}
      >
        {/* Header com logo + botão de toggle */}
        {/* Logo e título */}
        <div className={`mb-6 ${colapsada ? 'px-3' : 'px-6'}`}>
          {!colapsada && (
            <div className="flex items-center justify-between mb-3">
              <img
                src="/logo-detran.png"
                alt="DETRAN-SP"
                className="shrink-0 object-contain h-12"
              />
              <button
                onClick={alternarMenu}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high text-on-surface-variant transition-colors"
                aria-label="Minimizar menu"
                title="Minimizar menu"
              >
                <Icone nome="menu_open" className="text-[20px]" />
              </button>
            </div>
          )}
          {colapsada && (
            <div className="flex justify-center">
              <button
                onClick={alternarMenu}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high text-on-surface-variant transition-colors"
                aria-label="Expandir menu"
                title="Expandir menu"
              >
                <Icone nome="menu" className="text-[20px]" />
              </button>
            </div>
          )}
          {!colapsada && (
            <div>
              <h2 className="text-headline-sm text-primary font-bold leading-tight">Processamento Sancionatório</h2>
              <p className="text-[10px] uppercase tracking-widest text-outline font-bold">Diretoria de Gestão Regulatória</p>
            </div>
          )}
        </div>

        {/* Navegação */}
        <nav className={`flex-1 space-y-1 overflow-y-auto ${colapsada ? 'px-2' : 'px-4'}`}>
          {MENU.filter(
            // Esconder o item é só para não oferecer o que seria recusado: a
            // autorização de verdade está no backend (exigir_coordenador).
            (item) => !item.somenteCoordenador || usuario?.coordenador,
          ).map((item) =>
            item.to ? (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.to === '/'}
                title={colapsada ? item.label : undefined}
                className={() => {
                  // Lógica manual de "ativo" para lidar com query params
                  const urlCompleta = location.pathname + location.search
                  const to = item.to!
                  let ativo = false
                  if (to === '/') {
                    ativo = location.pathname === '/'
                  } else if (to.includes('?')) {
                    // Item com query param: só ativo se a URL bater exatamente
                    ativo = urlCompleta === to
                  } else if (to === '/caixa-entrada') {
                    ativo = location.pathname.startsWith('/caixa-entrada') || location.pathname.startsWith('/analise')
                  } else if (to === '/processos') {
                    // "Processos em Andamento" só fica ativo se NÃO tiver filtro na URL
                    ativo = location.pathname.startsWith('/processos') && !location.search.includes('filtro=')
                  } else {
                    ativo = location.pathname.startsWith(to)
                  }
                  return `flex items-center rounded-lg text-body-md transition-colors ${
                    colapsada ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'
                  } ${
                    ativo
                      ? 'text-primary font-bold border-l-4 border-primary bg-primary-fixed/20'
                      : 'text-on-surface-variant hover:text-primary hover:bg-surface-container-high'
                  }`
                }}
              >
                <Icone nome={item.icon} className="shrink-0" />
                {!colapsada && <span>{item.label}</span>}
              </NavLink>
            ) : (
              <div
                key={item.label}
                title={colapsada ? `${item.label} (em breve)` : 'Em breve'}
                className={`flex items-center rounded-lg text-body-md text-outline-variant cursor-not-allowed select-none ${
                  colapsada ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'
                }`}
              >
                <Icone nome={item.icon} className="shrink-0" />
                {!colapsada && <span>{item.label}</span>}
                {!colapsada && (
                  <span className="ml-auto text-[9px] uppercase font-bold bg-surface-container-high text-outline px-2 py-0.5 rounded-full whitespace-nowrap">
                    Em breve
                  </span>
                )}
              </div>
            ),
          )}
        </nav>

        {/* Usuário no rodapé */}
        <div className={`pt-6 border-t border-outline-variant mt-auto flex items-center ${colapsada ? 'justify-center px-2' : 'gap-3 px-6'}`}>
          <div
            className="w-10 h-10 rounded-full bg-primary-container text-white flex items-center justify-center font-bold shrink-0"
            title={nome}
          >
            {iniciais(nome)}
          </div>
          {!colapsada && (
            <div className="overflow-hidden flex-1">
              <p className="text-label-lg text-on-surface truncate">{nome}</p>
              <p className="text-[11px] text-outline">Servidor</p>
            </div>
          )}
          {!colapsada && (
            <button
              onClick={() => {
                import('../auth/msalConfig').then(({ msalInstance, authConfigurada }) => {
                  if (authConfigurada) msalInstance.logoutRedirect()
                })
              }}
              className="p-1.5 rounded-full hover:bg-surface-container-high text-on-surface-variant transition-colors"
              title="Sair"
            >
              <Icone nome="logout" className="text-[18px]" />
            </button>
          )}
        </div>
      </aside>

      {/* Conteúdo principal */}
      <div
        className="lg:transition-all lg:duration-300 flex flex-col min-h-screen"
        style={{ marginLeft: `var(--sidebar-w, 0px)` }}
      >
        {/* Variável CSS para adaptar ao estado da sidebar (só desktop) */}
        <style>{`@media (min-width: 1024px) { :root { --sidebar-w: ${colapsada ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W}; } }`}</style>

        <header className="sticky top-0 z-40 h-topbar-height bg-surface-container-lowest border-b border-outline-variant flex items-center justify-between px-margin-page">
          <div className="flex items-center gap-3 lg:hidden">
            <img src="/logo-detran.png" alt="DETRAN-SP" className="h-8 w-auto object-contain" />
            <span className="text-headline-sm text-primary font-bold">Processamento</span>
          </div>
          <PesquisaGlobal />
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-label-lg text-on-surface">Olá, {primeiro}</p>
              <p className="text-[11px] text-outline">Bem-vindo de volta</p>
            </div>
            <NotificacoesDropdown />
            <div
              className="w-10 h-10 rounded-full bg-primary-container text-white flex items-center justify-center font-bold"
              title={nome}
            >
              {iniciais(nome)}
            </div>
          </div>
        </header>

        <main className="flex-1 p-margin-page pb-24 lg:pb-margin-page max-w-[1440px] w-full mx-auto">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav mobile */}
      <nav className="lg:hidden fixed bottom-0 left-0 w-full h-16 z-50 bg-surface-container-lowest border-t border-outline-variant flex justify-around items-center">
        {[
          { label: 'Início', icon: 'home', to: '/' },
          { label: 'Caixa', icon: 'inbox', to: '/caixa-entrada' },
          { label: 'Processos', icon: 'folder_open', to: '/processos' },
          { label: 'Consulta', icon: 'travel_explore', to: '/consulta-unificada' },
          { label: 'Prazos', icon: 'timer', to: '/prazos' },
        ].map((i) => (
          <NavLink
            key={i.label}
            to={i.to}
            end={i.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 text-[10px] ${
                isActive ? 'text-primary font-bold' : 'text-on-surface-variant'
              }`
            }
          >
            <Icone nome={i.icon} />
            {i.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
