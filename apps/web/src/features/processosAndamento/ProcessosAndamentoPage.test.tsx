import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ProcessosAndamentoPage } from './ProcessosAndamentoPage'

const ITENS = [
  {
    id: 1,
    id_relatorio: 'R-1',
    numero_sei: '140.00286276/2026-27',
    id_procedimento: '111111',
    razao_social: 'Auto Escola Modelo',
    agente_regulado: 'Autoescola',
    segmento: 'Educacao',
    tipo_documento: 'Relatorio',
    cnpj_cpf: '12.345.678/0001-99',
    data_recebimento: '2026-01-10',
    data_remetido: null,
    status_triagem: 'instaurado',
    numero_processo_sei: '140.00999999/2026-01',
    id_procedimento_processo: '999999',
    data_instauracao: '2026-02-01',
  },
  {
    id: 2,
    id_relatorio: 'R-2',
    numero_sei: '140.00299001/2026-08',
    id_procedimento: '222222',
    razao_social: 'Vistorias SP',
    agente_regulado: 'ECV',
    segmento: 'Veiculos',
    tipo_documento: 'Relatorio',
    cnpj_cpf: '98.765.432/0001-10',
    data_recebimento: '2026-01-15',
    data_remetido: null,
    status_triagem: 'tac',
    numero_processo_sei: null,
    id_procedimento_processo: null,
    data_instauracao: null,
  },
]

function mockFetch(listaOk: boolean) {
  return vi.fn((url: string) => {
    const u = String(url)
    if (u.includes('/caixa-entrada/agentes')) {
      return Promise.resolve({ ok: true, json: async () => ['Autoescola', 'ECV'] })
    }
    if (u.includes('/processos-andamento')) {
      return Promise.resolve({ ok: listaOk, status: listaOk ? 200 : 500, json: async () => ITENS })
    }
    if (u.includes('/notificacoes')) {
      return Promise.resolve({ ok: true, json: async () => ({ total_nao_lidas: 0, notificacoes: [] }) })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }) as unknown as typeof fetch
}

function renderizar() {
  return render(
    <MemoryRouter>
      <ProcessosAndamentoPage />
    </MemoryRouter>,
  )
}

// A tela espera 350ms (debounce) antes de consultar a API. Com os arquivos de
// teste rodando em paralelo, o padrão de 1s do waitFor fica apertado e gera
// falha intermitente — daí a folga maior aqui.
const ESPERA = { timeout: 5000 }

describe('ProcessosAndamentoPage', () => {
  it('mostra os processos em andamento retornados pela API', async () => {
    globalThis.fetch = mockFetch(true)
    renderizar()
    expect(screen.getByRole('heading', { name: 'Processos em Andamento' })).toBeInTheDocument()
    // Instaurado: exibe o numero_processo_sei (processo NOVO), não o numero_sei original.
    await waitFor(() => expect(screen.getByText('140.00999999/2026-01')).toBeInTheDocument(), ESPERA)
    // TAC: exibe o numero_sei original, pois não existe processo novo.
    expect(screen.getByText('140.00299001/2026-08')).toBeInTheDocument()
    expect(screen.getByText('Instaurado')).toBeInTheDocument()
    expect(screen.getByText('TAC')).toBeInTheDocument()
    // Data de instauração formatada para o item instaurado.
    expect(screen.getByText('01/02/2026')).toBeInTheDocument()
    // Item ainda sem data de instauração mostra o texto de espera.
    expect(screen.getByText('Aguardando assinatura')).toBeInTheDocument()
  })

  it('mostra erro quando a API falha', async () => {
    globalThis.fetch = mockFetch(false)
    renderizar()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), ESPERA)
  })
})
