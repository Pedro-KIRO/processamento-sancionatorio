import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DespachoModal } from './DespachoModal'

const TEMPLATE_HTML = '<p>[NOME COMPLETO] [CNPJ]</p>'

/** Mock de fetch parametrizável: GET do template sempre sucede; o POST de
 * envio responde conforme `respostaPost` (definida em cada teste). */
function mockFetch(respostaPost: () => { ok: boolean; status: number; json: () => Promise<unknown> }) {
  return vi.fn((url: string, init?: RequestInit) => {
    const u = String(url)
    if (!init || init.method === undefined) {
      // GET do template
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ html: TEMPLATE_HTML }) })
    }
    if (init.method === 'POST' && u.includes('/despachos/')) {
      const r = respostaPost()
      return Promise.resolve(r)
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  }) as unknown as typeof fetch
}

async function renderizarEEditar(respostaPost: () => { ok: boolean; status: number; json: () => Promise<unknown> }) {
  globalThis.fetch = mockFetch(respostaPost)
  const onSucesso = vi.fn()
  const onClose = vi.fn()
  render(<DespachoModal itemId={1} tipo="arquivar" onClose={onClose} onSucesso={onSucesso} />)
  await waitFor(() => expect(screen.getByLabelText('Editor do documento')).toBeInTheDocument())
  return { onSucesso, onClose }
}

describe('DespachoModal - tratamento de erros da API SEI', () => {
  it('mostra aviso de instabilidade temporária e mantém o botão Confirmar habilitado', async () => {
    const { onSucesso } = await renderizarEEditar(() => ({
      ok: false,
      status: 503,
      json: async () => ({
        detail: {
          message: 'O SEI está temporariamente indisponível: erro 503',
          temporario: true,
          etapa: 'consultar_processo',
          numero_sei_criado: null,
        },
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: /Confirmar e criar no SEI/i }))

    const alerta = await screen.findByRole('alert')
    expect(within(alerta).getAllByText(/temporariamente indisponível/i).length).toBeGreaterThan(0)
    expect(onSucesso).not.toHaveBeenCalled()

    const botaoConfirmar = screen.getByRole('button', { name: /Confirmar e criar no SEI/i })
    expect(botaoConfirmar).not.toBeDisabled()
  })

  it('bloqueia o botão Confirmar e alerta sobre duplicidade quando um processo já foi criado', async () => {
    const { onSucesso } = await renderizarEEditar(() => ({
      ok: false,
      status: 502,
      json: async () => ({
        detail: {
          message: 'O processo já foi criado, mas houve falha ao incluir o documento',
          temporario: false,
          etapa: 'incluir_documento',
          numero_sei_criado: '140.00999999/2026-01',
          id_procedimento_criado: '999999',
        },
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: /Confirmar e criar no SEI/i }))

    const alerta = await screen.findByRole('alert')
    expect(within(alerta).getAllByText(/140\.00999999\/2026-01/).length).toBeGreaterThan(0)
    expect(within(alerta).getByText(/Não clique em "Confirmar" novamente/i)).toBeInTheDocument()
    expect(onSucesso).not.toHaveBeenCalled()

    const botaoConfirmar = screen.getByRole('button', { name: /Confirmar e criar no SEI/i })
    expect(botaoConfirmar).toBeDisabled()
  })

  it('mostra erro definitivo genérico quando não há processo criado', async () => {
    await renderizarEEditar(() => ({
      ok: false,
      status: 502,
      json: async () => ({
        detail: {
          message: 'O SEI recusou a solicitação: dados inválidos',
          temporario: false,
          etapa: 'incluir_documento',
          numero_sei_criado: null,
        },
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: /Confirmar e criar no SEI/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/Não foi possível concluir a solicitação/i)).toBeInTheDocument()

    // Erro definitivo sem processo criado NÃO bloqueia novas tentativas.
    const botaoConfirmar = screen.getByRole('button', { name: /Confirmar e criar no SEI/i })
    expect(botaoConfirmar).not.toBeDisabled()
  })

  it('chama onSucesso com os avisos quando a ação é concluída com sucesso parcial', async () => {
    const { onSucesso } = await renderizarEEditar(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        numero_sei: '140.00286276/2026-27',
        id_procedimento: '123456',
        id_documento: '9',
        documento_formatado: '0009999',
        avisos: ['Não foi possível incluir no bloco de assinatura.'],
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: /Confirmar e criar no SEI/i }))

    await waitFor(() => expect(onSucesso).toHaveBeenCalledTimes(1))
    const resultado = onSucesso.mock.calls[0][0]
    expect(resultado.avisos).toEqual(['Não foi possível incluir no bloco de assinatura.'])
  })
})


// --- Mala direta: o formulário vem antes do documento ---------------------
const MARCADORES = [
  {
    id: 'm0',
    token: '[NOME COMPLETO]',
    rotulo: 'NOME COMPLETO',
    tipo: 'cadastral',
    total: 1,
    indice: null,
    opcoes: [],
    valor_sugerido: 'AUTO ESCOLA MODELO',
    campo: 'razao_social',
    contexto: null,
    multivalor: false,
    preenchivel: true,
  },
  {
    id: 'm1',
    token: '[CNPJ]',
    rotulo: 'CNPJ',
    tipo: 'texto',
    total: 1,
    indice: null,
    opcoes: [],
    valor_sugerido: null,
    campo: null,
    contexto: null,
    multivalor: false,
    preenchivel: true,
  },
  {
    id: 'm2',
    token: '[SE HOUVER]',
    rotulo: 'SE HOUVER',
    tipo: 'instrucao',
    total: 1,
    indice: null,
    opcoes: [],
    valor_sugerido: null,
    campo: null,
    contexto: null,
    multivalor: false,
    preenchivel: false,
  },
]

/** Um [descrição] no documento (antes eram 3 campos, agora é 1 + Acrescentar). */
const CONTEXTOS = [
  '1 ___ [Citar irregularidades segundo relatório de fiscalização];',
  '2. ___ [CITAR se há outro processo em andamento];',
  '3. ___ [Demais irregularidades documentais e estruturais];',
]
const MARCADORES_REPETIDOS = [{
  id: 'd1',
  token: '[descrição]',
  rotulo: 'descrição',
  tipo: 'texto',
  total: 3,
  indice: null,
  opcoes: [],
  valor_sugerido: null,
  campo: null,
  contexto: CONTEXTOS[0],
  multivalor: true,
  preenchivel: true,
}]

function mockFetchComMarcadores(
  marcadores: unknown[],
  html = '<p>[NOME COMPLETO] [CNPJ] [SE HOUVER]</p>',
) {
  globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => {
    if (!init || init.method === undefined) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ html, marcadores }),
      })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({
      numero_sei: '1', id_procedimento: '2', id_documento: null,
      documento_formatado: null, avisos: [],
    }) })
  }) as unknown as typeof fetch
}

describe('DespachoModal - mala direta', () => {
  it('abre no formulário de dados, e não direto no editor', async () => {
    mockFetchComMarcadores(MARCADORES)
    render(<DespachoModal itemId={1} tipo="arquivar" onClose={vi.fn()} onSucesso={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText(/Dados do documento/i)).toBeInTheDocument())
    // O editor ainda não existe nesta etapa.
    expect(screen.queryByLabelText('Editor do documento')).not.toBeInTheDocument()
  })

  it('já traz preenchido o que vem do cadastro e conta o que falta', async () => {
    mockFetchComMarcadores(MARCADORES)
    render(<DespachoModal itemId={1} tipo="arquivar" onClose={vi.fn()} onSucesso={vi.fn()} />)

    await waitFor(() => expect(screen.getByDisplayValue('AUTO ESCOLA MODELO')).toBeInTheDocument())
    // Dois campos preenchíveis; só um veio do cadastro.
    expect(screen.getByText(/1 em branco/i)).toBeInTheDocument()
    // Instrução de edição não é campo, aparece como aviso recolhível.
    expect(screen.getByText(/1 observação do modelo/i)).toBeInTheDocument()
  })

  it('aplica os valores no documento ao continuar para o editor', async () => {
    mockFetchComMarcadores(MARCADORES)
    render(<DespachoModal itemId={1} tipo="arquivar" onClose={vi.fn()} onSucesso={vi.fn()} />)

    await waitFor(() => expect(screen.getByDisplayValue('AUTO ESCOLA MODELO')).toBeInTheDocument())
    fireEvent.change(screen.getByDisplayValue('AUTO ESCOLA MODELO'), {
      target: { value: 'EMPRESA EDITADA' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Continuar para o documento/i }))

    const editor = await screen.findByLabelText('Editor do documento')
    expect(editor.innerHTML).toContain('EMPRESA EDITADA')
    // Campo deixado em branco mantém a marcação visível no texto.
    expect(editor.innerHTML).toContain('[CNPJ]')
    // Instrução do modelo continua no documento, para resolver no editor.
    expect(editor.innerHTML).toContain('[SE HOUVER]')
  })

  it('não bloqueia o avanço com campo em branco', async () => {
    mockFetchComMarcadores(MARCADORES)
    render(<DespachoModal itemId={1} tipo="arquivar" onClose={vi.fn()} onSucesso={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByText(/Dados do documento/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Continuar para o documento/i })).not.toBeDisabled()
  })

  it('modelo sem lacuna vai direto para o editor', async () => {
    mockFetchComMarcadores([])
    render(<DespachoModal itemId={1} tipo="arquivar" onClose={vi.fn()} onSucesso={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByLabelText('Editor do documento')).toBeInTheDocument())
    expect(screen.queryByText(/Dados do documento/i)).not.toBeInTheDocument()
  })

  it('"Rever dados" volta ao formulário e refaz o documento do modelo', async () => {
    mockFetchComMarcadores(MARCADORES)
    render(<DespachoModal itemId={1} tipo="arquivar" onClose={vi.fn()} onSucesso={vi.fn()} />)

    await waitFor(() => expect(screen.getByDisplayValue('AUTO ESCOLA MODELO')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Continuar para o documento/i }))
    await screen.findByLabelText('Editor do documento')

    fireEvent.click(screen.getByRole('button', { name: /Rever dados/i }))
    const campo = await screen.findByDisplayValue('AUTO ESCOLA MODELO')
    fireEvent.change(campo, { target: { value: 'OUTRA EMPRESA' } })
    fireEvent.click(screen.getByRole('button', { name: /Continuar para o documento/i }))

    const editor = await screen.findByLabelText('Editor do documento')
    expect(editor.innerHTML).toContain('OUTRA EMPRESA')
    expect(editor.innerHTML).not.toContain('AUTO ESCOLA MODELO')
  })
})


describe('DespachoModal - contexto e quantidade livre de valores', () => {
  const HTML_TERMO = '<p>1 [descrição] 2. [descrição] 3. [descrição]</p>'

  it('identifica a lacuna pelo contexto no hover do rótulo', async () => {
    mockFetchComMarcadores(MARCADORES_REPETIDOS, HTML_TERMO)
    render(<DespachoModal itemId={1} tipo="arquivar" onClose={vi.fn()} onSucesso={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByTitle(/Citar irregularidades segundo relatório/i)).toBeInTheDocument())
  })

  it('acrescenta quantos valores o caso exigir, sem convenção escondida', async () => {
    mockFetchComMarcadores(MARCADORES_REPETIDOS, HTML_TERMO)
    render(<DespachoModal itemId={1} tipo="arquivar" onClose={vi.fn()} onSucesso={vi.fn()} />)

    // O input está associado ao label via htmlFor/id.
    const campo = await screen.findByRole('textbox', { name: /descrição/i })
    fireEvent.change(campo, { target: { value: 'piso irregular' } })

    // Três condutas numa lacuna que o modelo previa como uma.
    const acrescentar = screen.getByRole('button', { name: /Acrescentar/i })
    fireEvent.click(acrescentar)
    fireEvent.change(screen.getByLabelText(/descrição — valor 2/i), {
      target: { value: 'extintor vencido' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Acrescentar/i }))
    fireEvent.change(screen.getByLabelText(/descrição — valor 3/i), {
      target: { value: 'sem sinalização' },
    })

    fireEvent.click(screen.getByRole('button', { name: /Continuar para o documento/i }))
    const editor = await screen.findByLabelText('Editor do documento')
    // Junção em linguagem natural: a lacuna fica dentro de uma frase.
    expect(editor.innerHTML).toContain(
      '1 piso irregular, extintor vencido e sem sinalização',
    )
  })

  it('permite remover um valor acrescentado', async () => {
    mockFetchComMarcadores(MARCADORES_REPETIDOS, HTML_TERMO)
    render(<DespachoModal itemId={1} tipo="arquivar" onClose={vi.fn()} onSucesso={vi.fn()} />)

    const campo = await screen.findByRole('textbox', { name: /descrição/i })
    fireEvent.change(campo, { target: { value: 'piso irregular' } })
    fireEvent.click(screen.getByRole('button', { name: /Acrescentar/i }))
    fireEvent.change(screen.getByLabelText(/descrição — valor 2/i), {
      target: { value: 'extintor vencido' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Remover valor 2/i }))

    fireEvent.click(screen.getByRole('button', { name: /Continuar para o documento/i }))
    const editor = await screen.findByLabelText('Editor do documento')
    expect(editor.innerHTML).toContain('1 piso irregular')
    expect(editor.innerHTML).not.toContain('extintor vencido')
  })

  it('campo de cadastro não oferece acrescentar', async () => {
    // Razão social é um valor só; oferecer "+" ali seria convite a erro.
    mockFetchComMarcadores([MARCADORES[0]], '<p>[NOME COMPLETO]</p>')
    render(<DespachoModal itemId={1} tipo="arquivar" onClose={vi.fn()} onSucesso={vi.fn()} />)

    await waitFor(() => expect(screen.getByDisplayValue('AUTO ESCOLA MODELO')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Acrescentar/i })).not.toBeInTheDocument()
  })
})
