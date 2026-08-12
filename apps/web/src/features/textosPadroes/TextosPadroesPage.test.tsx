import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { TextosPadroesPage } from './TextosPadroesPage'

const RESUMOS = [
  {
    id: 10,
    agente_regulado: 'Perito',
    funcao: 'arquivamento_relatorio',
    funcao_titulo: 'Arquivamento do Relatório',
    rotulo: 'Despacho 47 - Sem irregular',
    nome_arvore: 'Despacho',
    padrao: true,
    editado: false,
    editado_em: null,
    editado_por: null,
    divergente_do_original: false,
  },
  {
    id: 11,
    agente_regulado: 'ECV',
    funcao: 'saneador',
    funcao_titulo: 'Despacho Saneador',
    rotulo: 'Despacho 139 SANEADOR',
    nome_arvore: 'Despacho saneador',
    padrao: false,
    editado: true,
    editado_em: '2026-08-03T10:00:00',
    editado_por: 'coord@detran.sp.gov.br',
    divergente_do_original: true,
  },
]

const DETALHE = {
  ...RESUMOS[1],
  template_html: '<p class="Texto_Justificado">Texto do saneador.</p>',
  html_original: '<p class="Texto_Justificado">Texto original do SEI.</p>',
}

function mockFetch(listaOk = true) {
  return vi.fn((url: string, init?: RequestInit) => {
    const u = String(url)
    const metodo = init?.method ?? 'GET'

    if (u.includes('/textos-padroes/agentes')) {
      return Promise.resolve({ ok: true, json: async () => ['ECV', 'Perito'] })
    }
    if (u.includes('/textos-padroes/funcoes')) {
      return Promise.resolve({
        ok: true,
        json: async () => [
          { funcao: 'arquivamento_relatorio', titulo: 'Arquivamento do Relatório', quantidade: 9 },
          { funcao: 'saneador', titulo: 'Despacho Saneador', quantidade: 4 },
        ],
      })
    }
    if (u.match(/\/textos-padroes\/\d+$/) && metodo === 'PUT') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...DETALHE, editado: true, divergente_do_original: true }),
      })
    }
    if (u.match(/\/textos-padroes\/\d+\/restaurar$/)) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ...DETALHE,
          template_html: DETALHE.html_original,
          editado: false,
          editado_em: null,
          editado_por: null,
          divergente_do_original: false,
        }),
      })
    }
    if (u.match(/\/textos-padroes\/\d+$/)) {
      return Promise.resolve({ ok: true, json: async () => DETALHE })
    }
    return Promise.resolve({
      ok: listaOk,
      status: listaOk ? 200 : 403,
      json: async () =>
        listaOk
          ? RESUMOS
          : { detail: 'Apenas o perfil de coordenação pode consultar e editar os textos-padrão.' },
    })
  }) as unknown as typeof fetch
}

function renderizar() {
  return render(
    <MemoryRouter>
      <TextosPadroesPage />
    </MemoryRouter>,
  )
}

// A lista espera 300ms (debounce) antes de consultar a API.
const ESPERA = { timeout: 5000 }

describe('TextosPadroesPage', () => {
  it('agrupa os modelos por documento e marca o padrão', async () => {
    globalThis.fetch = mockFetch()
    renderizar()

    await waitFor(
      () => expect(screen.getByText('Despacho 47 - Sem irregular')).toBeInTheDocument(),
      ESPERA,
    )
    expect(screen.getByRole('heading', { name: 'Arquivamento do Relatório' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Despacho Saneador' })).toBeInTheDocument()
    expect(screen.getByText('Padrão')).toBeInTheDocument()
    expect(screen.getByText('Editado')).toBeInTheDocument()
    expect(screen.getByText('Mudou no SEI')).toBeInTheDocument()
  })

  it('mostra erro quando o acesso é recusado', async () => {
    globalThis.fetch = mockFetch(false)
    renderizar()

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), ESPERA)
    expect(screen.getByRole('alert').textContent).toContain('perfil de coordenação')
  })

  it('abre o modelo escolhido e avisa da divergência com o SEI', async () => {
    globalThis.fetch = mockFetch()
    renderizar()
    await waitFor(
      () => expect(screen.getByText('Despacho 139 SANEADOR')).toBeInTheDocument(),
      ESPERA,
    )

    fireEvent.click(screen.getByText('Despacho 139 SANEADOR'))

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Despacho 139 SANEADOR/ })).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /Restaurar original/ })).toBeInTheDocument()
    expect(screen.getByRole('alert').textContent).toContain('mudou no SEI')
  })

  it('salvar fica desabilitado até haver alteração', async () => {
    globalThis.fetch = mockFetch()
    renderizar()
    await waitFor(
      () => expect(screen.getByText('Despacho 139 SANEADOR')).toBeInTheDocument(),
      ESPERA,
    )
    fireEvent.click(screen.getByText('Despacho 139 SANEADOR'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled())
  })
})
