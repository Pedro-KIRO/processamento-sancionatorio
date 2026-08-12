import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CaixaEntradaPage } from './CaixaEntradaPage'

const ITENS = [
  {
    id: 1,
    id_relatorio: 'R-1',
    numero_sei: '140.00286276/2026-27',
    razao_social: 'Auto Escola Modelo',
    agente_regulado: 'Autoescola',
    segmento: 'Educacao',
    tipo_documento: 'Relatorio',
    cnpj_cpf: '12.345.678/0001-99',
    data_recebimento: '2026-01-10',
    data_remetido: null,
    status_triagem: 'pendente',
  },
]

function mockFetch(listaOk: boolean) {
  return vi.fn((url: string) => {
    const u = String(url)
    if (u.includes('/caixa-entrada/agentes')) {
      return Promise.resolve({ ok: true, json: async () => ['Autoescola', 'ECV'] })
    }
    if (u.includes('/caixa-entrada')) {
      return Promise.resolve({ ok: listaOk, status: listaOk ? 200 : 500, json: async () => ITENS })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }) as unknown as typeof fetch
}

function renderizar() {
  return render(
    <MemoryRouter>
      <CaixaEntradaPage />
    </MemoryRouter>,
  )
}

// A tela espera 350ms (debounce) antes de consultar a API. Com os arquivos de
// teste rodando em paralelo, o padrão de 1s do waitFor fica apertado e gera
// falha intermitente — daí a folga maior aqui.
const ESPERA = { timeout: 5000 }

describe('CaixaEntradaPage', () => {
  it('mostra os itens retornados pela API', async () => {
    globalThis.fetch = mockFetch(true)
    renderizar()
    expect(screen.getByRole('heading', { name: 'Caixa de Entrada' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('140.00286276/2026-27')).toBeInTheDocument(), ESPERA)
    expect(screen.getByText('12.345.678/0001-99')).toBeInTheDocument()
  })

  it('mostra erro quando a API falha', async () => {
    globalThis.fetch = mockFetch(false)
    renderizar()
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), ESPERA)
  })
})
