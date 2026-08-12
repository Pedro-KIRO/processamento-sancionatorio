import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { PrazosPage } from './PrazosPage'

/*
  Os prazos usam datas fixas e o relógio é congelado em 05/08/2026, senão o
  semáforo e a grade do calendário mudariam de resultado conforme o dia em que
  a suíte roda.
*/
const HOJE = new Date(2026, 7, 5, 10, 0, 0)

const PRAZOS = [
  {
    id: 1,
    caixa_entrada_id: 11,
    prioritario: false,
    prioridade_justificativa: null,
    numero_sei: '140.00286276/2026-27',
    id_procedimento: '111111',
    interessado: 'L & L EMPLACADORA ARARAQUARA LTDA',
    cnpj_cpf: '12.345.678/0001-99',
    agente_regulado: 'EPIV',
    fase: 'aguardando_defesa',
    tipo_prazo: 'Defesa prévia',
    base_legal: 'Art. 63, III',
    dias: 15,
    data_inicio: '2026-07-24',
    data_vencimento: '2026-08-08',
    dias_restantes: 3,
    restante_rotulo: '3 dias',
    semaforo: 'amarelo',
    situacao_rotulo: 'Vence em breve',
    responsavel: 'Ana Souza',
    status: 'em_curso',
  },
  {
    id: 2,
    caixa_entrada_id: 12,
    prioritario: true,
    prioridade_justificativa: 'Reincidência',
    numero_sei: '140.00299001/2026-08',
    id_procedimento: '222222',
    interessado: 'TRIUNFO VISTORIA VEICULAR LTDA',
    cnpj_cpf: '98.765.432/0001-10',
    agente_regulado: 'ECV',
    fase: 'instrucao',
    tipo_prazo: 'Alegações finais',
    base_legal: 'Art. 63, VII',
    dias: 7,
    data_inicio: '2026-08-08',
    data_vencimento: '2026-08-15',
    dias_restantes: 10,
    restante_rotulo: '10 dias',
    semaforo: 'verde',
    situacao_rotulo: 'No prazo',
    responsavel: null,
    status: 'em_curso',
  },
]

const RESPOSTA = {
  resumo: { vencidos: 0, vence_em_3_dias: 1, no_prazo: 1, priorizados: 1 },
  prazos: PRAZOS,
  total: 2,
  pode_priorizar: true,
}

function mockFetch(comPrazos = true) {
  return vi.fn((url: string) => {
    const u = String(url)
    if (u.includes('/prazos/tipos')) {
      return Promise.resolve({ ok: true, json: async () => [] })
    }
    if (u.includes('/prazos/responsaveis')) {
      return Promise.resolve({ ok: true, json: async () => [] })
    }
    if (u.includes('/prazos')) {
      return Promise.resolve({
        ok: true,
        json: async () =>
          comPrazos
            ? RESPOSTA
            : { resumo: { vencidos: 0, vence_em_3_dias: 0, no_prazo: 0, priorizados: 0 }, prazos: [], total: 0, pode_priorizar: true },
      })
    }
    if (u.includes('/caixa-entrada/agentes')) {
      return Promise.resolve({ ok: true, json: async () => ['EPIV', 'ECV'] })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  }) as unknown as typeof fetch
}

function renderizar() {
  return render(
    <MemoryRouter>
      <PrazosPage />
    </MemoryRouter>,
  )
}

const ESPERA = { timeout: 5000 }

describe('PrazosPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(HOJE)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mostra a lista de prazos com os dados da API', async () => {
    globalThis.fetch = mockFetch()
    renderizar()
    await waitFor(
      () => expect(screen.getByText('140.00286276/2026-27')).toBeInTheDocument(),
      ESPERA,
    )
    expect(screen.getByText('Defesa prévia')).toBeInTheDocument()
  })

  /*
    Os nomes das colunas vêm do texto do documento de negócio. "Segmento" e
    "Restante" foram tirados da figura por engano — "Segmento" nem existe como
    conceito nesta tela, o dado exibido sempre foi o agente regulado.
  */
  it('usa os nomes de coluna do documento, não os da figura', async () => {
    globalThis.fetch = mockFetch()
    renderizar()
    await waitFor(
      () => expect(screen.getByText('140.00286276/2026-27')).toBeInTheDocument(),
      ESPERA,
    )

    expect(screen.getByTitle('Ordenar por Agente regulado')).toBeInTheDocument()
    expect(screen.getByTitle('Ordenar por Contagem regressiva')).toBeInTheDocument()
    expect(screen.queryByTitle('Ordenar por Segmento')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Ordenar por Restante')).not.toBeInTheDocument()
  })

  /*
    Padrão do projeto, copiado da Consulta Unificada, que é a tela mais completa:
    a busca sozinha na primeira linha da barra e os filtros numa grade abaixo,
    dentro do mesmo cartão. Já errei isso duas vezes — primeiro deixando a busca
    na quinta posição entre as caixas de seleção, depois tirando as caixas da
    barra e jogando todas para o cabeçalho das colunas.
  */
  it('mantém a busca em primeiro lugar e os filtros na mesma barra', async () => {
    globalThis.fetch = mockFetch()
    renderizar()
    await waitFor(
      () => expect(screen.getByText('140.00286276/2026-27')).toBeInTheDocument(),
      ESPERA,
    )

    const busca = screen.getByLabelText('Buscar prazo')
    // A barra é o cartão que envolve a linha da busca e a grade de filtros.
    const barra = busca.closest('div')?.parentElement
    expect(barra?.firstElementChild).toContainElement(busca)

    // Os quatro filtros ficam na barra, logo abaixo da busca.
    for (const rotulo of [
      'Filtrar por agente regulado',
      'Filtrar por tipo de prazo',
      'Filtrar por situação',
      'Filtrar por responsável',
    ]) {
      expect(barra).toContainElement(screen.getByLabelText(rotulo))
    }

    // Vencimento é o único filtro de coluna, para não repetir filtro em dois lugares.
    expect(screen.getByLabelText('Filtrar Vencimento')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filtrar Agente regulado')).not.toBeInTheDocument()
  })

  it('troca para o modo calendário e mostra a grade do mês', async () => {
    globalThis.fetch = mockFetch()
    renderizar()
    await waitFor(
      () => expect(screen.getByText('140.00286276/2026-27')).toBeInTheDocument(),
      ESPERA,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Calendário' }))

    expect(screen.getByText('agosto de 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mês seguinte' })).toBeInTheDocument()
    // O cabeçalho dos dias da semana aparece uma vez por coluna.
    expect(screen.getAllByText('SEG').length).toBeGreaterThan(0)
  })

  it('troca para o modo semana e mostra o intervalo de sete dias', async () => {
    globalThis.fetch = mockFetch()
    renderizar()
    await waitFor(
      () => expect(screen.getByText('140.00286276/2026-27')).toBeInTheDocument(),
      ESPERA,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Semana' }))

    expect(screen.getByRole('button', { name: 'Semana seguinte' })).toBeInTheDocument()
    expect(screen.getByText(/2 – 8 de agosto de 2026/)).toBeInTheDocument()
  })

  /*
    Sem esta garantia o usuário clica em Calendário e nada acontece: a tela
    ficava presa no aviso de "nenhum prazo", porque os três modos só eram
    montados quando havia prazo na resposta.
  */
  it('mostra a grade do calendário mesmo quando não há prazo no filtro', async () => {
    globalThis.fetch = mockFetch(false)
    renderizar()
    await waitFor(
      () => expect(screen.getByText(/Nenhum prazo em curso/)).toBeInTheDocument(),
      ESPERA,
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Calendário' }))

    expect(screen.getByText('agosto de 2026')).toBeInTheDocument()
    expect(screen.queryByText(/Nenhum prazo em curso/)).not.toBeInTheDocument()
  })
})

describe('PrazosLista — ordenação', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(HOJE)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  /*
    O documento pede a lista ordenável. Clicar em Vencimento inverte a ordem;
    clicar de novo desce; na terceira vez volta à ordem do backend.
  */
  it('ordena por vencimento e volta à ordem original no terceiro clique', async () => {
    globalThis.fetch = mockFetch()
    renderizar()
    await waitFor(
      () => expect(screen.getByText('140.00286276/2026-27')).toBeInTheDocument(),
      ESPERA,
    )

    function primeiroSei() {
      const linhas = screen.getAllByRole('row')
      // linha 0 é o cabeçalho
      return linhas[1].textContent ?? ''
    }

    expect(primeiroSei()).toContain('140.00286276/2026-27')

    // A coluna reúne as duas datas ("Início / Vencimento", como o documento
    // escreve) e ordena pelo vencimento.
    const vencimento = () => screen.getByTitle('Ordenar por Início / Vencimento')
    fireEvent.click(vencimento()) // crescente: 08/08 antes de 15/08
    expect(primeiroSei()).toContain('140.00286276/2026-27')

    fireEvent.click(vencimento()) // decrescente: 15/08 primeiro
    expect(primeiroSei()).toContain('140.00299001/2026-08')

    fireEvent.click(vencimento()) // volta à ordem do backend
    expect(primeiroSei()).toContain('140.00286276/2026-27')
  })

  it('ordena a coluna Situação por urgência, não pelo nome da cor', async () => {
    globalThis.fetch = mockFetch()
    renderizar()
    await waitFor(
      () => expect(screen.getByText('140.00286276/2026-27')).toBeInTheDocument(),
      ESPERA,
    )

    fireEvent.click(screen.getByTitle('Ordenar por Situação'))
    const linhas = screen.getAllByRole('row')
    // Amarelo (vence em breve) precede verde (no prazo).
    expect(linhas[1].textContent).toContain('Vence em breve')
    expect(linhas[2].textContent).toContain('No prazo')
  })
})
