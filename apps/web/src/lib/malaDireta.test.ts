import { describe, expect, it } from 'vitest'

import {
  aplicarMarcadores,
  camposPreenchiveis,
  instrucoesDoModelo,
  listaDeValores,
  textoDoValor,
  totalPendentes,
  valoresIniciais,
  type Marcador,
} from './malaDireta'

let sequencia = 0

function marcador(parcial: Partial<Marcador> & { token: string }): Marcador {
  return {
    id: `m${sequencia++}`,
    rotulo: parcial.token.replace(/[[\]]/g, ''),
    tipo: 'texto',
    total: 1,
    indice: null,
    opcoes: [],
    valor_sugerido: null,
    campo: null,
    contexto: null,
    multivalor: false,
    tokens_extras: [],
    preenchivel: true,
    ...parcial,
  }
}

describe('textoDoValor', () => {
  // A lacuna fica dentro de um período, então a junção é em linguagem natural:
  // quebrar linha ali partiria a frase no meio.
  it('junta vários valores como frase', () => {
    expect(textoDoValor(['piso irregular', 'extintor vencido', 'sem sinalização'])).toBe(
      'piso irregular, extintor vencido e sem sinalização',
    )
  })

  it('usa apenas "e" quando são dois', () => {
    expect(textoDoValor(['um', 'dois'])).toBe('um e dois')
  })

  it('um valor entra sozinho', () => {
    expect(textoDoValor(['piso irregular'])).toBe('piso irregular')
    expect(textoDoValor('piso irregular')).toBe('piso irregular')
  })

  it('descarta valor em branco da lista', () => {
    expect(textoDoValor(['um', '', '  ', 'dois'])).toBe('um e dois')
  })

  it('devolve vazio quando não há valor', () => {
    expect(textoDoValor(undefined)).toBe('')
    expect(textoDoValor([])).toBe('')
    expect(textoDoValor(['', '  '])).toBe('')
  })
})

describe('listaDeValores', () => {
  it('sempre devolve ao menos um campo para a tela desenhar', () => {
    expect(listaDeValores(undefined)).toEqual([''])
    expect(listaDeValores('')).toEqual([''])
    expect(listaDeValores([])).toEqual([''])
    expect(listaDeValores('um')).toEqual(['um'])
    expect(listaDeValores(['um', 'dois'])).toEqual(['um', 'dois'])
  })
})

describe('aplicarMarcadores', () => {
  it('um campo só entra em todas as ocorrências do token', () => {
    // Caso do [NOME DA EMPRESA], que repete o mesmo dado no documento.
    const m = marcador({ token: '[NOME DA EMPRESA]', tipo: 'cadastral', total: 2 })
    const html = '<p>[NOME DA EMPRESA] contra [NOME DA EMPRESA]</p>'
    expect(aplicarMarcadores(html, [m], { [m.id]: 'EMPRESA X' })).toBe(
      '<p>EMPRESA X contra EMPRESA X</p>',
    )
  })

  it('cada ocorrência recebe o próprio valor quando o campo é por posição', () => {
    // Caso do [descrição] 3x no termo de instauração: itens 1., 2. e 3.
    const lista = [1, 2, 3].map((indice) =>
      marcador({ token: '[descrição]', total: 3, indice }))
    const html = '<p>1. [descrição] 2. [descrição] 3. [descrição]</p>'
    const valores = {
      [lista[0].id]: 'piso irregular',
      [lista[1].id]: 'extintor vencido',
      [lista[2].id]: 'falta de sinalização',
    }
    expect(aplicarMarcadores(html, lista, valores)).toBe(
      '<p>1. piso irregular 2. extintor vencido 3. falta de sinalização</p>',
    )
  })

  it('aceita vários valores dentro de uma ocorrência', () => {
    const lista = [1, 2].map((indice) =>
      marcador({ token: '[descrição]', total: 2, indice, multivalor: true }))
    const html = '<p>1. [descrição] 2. [descrição]</p>'
    const valores = {
      [lista[0].id]: ['piso irregular', 'extintor vencido'],
      [lista[1].id]: 'outro processo em andamento',
    }
    expect(aplicarMarcadores(html, lista, valores)).toBe(
      '<p>1. piso irregular e extintor vencido 2. outro processo em andamento</p>',
    )
  })

  it('ocorrência em branco no meio mantém só aquela lacuna', () => {
    const lista = [1, 2, 3].map((indice) =>
      marcador({ token: '[descrição]', total: 3, indice }))
    const html = '<p>1. [descrição] 2. [descrição] 3. [descrição]</p>'
    const valores = {
      [lista[0].id]: 'piso irregular',
      [lista[1].id]: '',
      [lista[2].id]: 'falta de sinalização',
    }
    expect(aplicarMarcadores(html, lista, valores)).toBe(
      '<p>1. piso irregular 2. [descrição] 3. falta de sinalização</p>',
    )
  })

  it('trata o marcador como texto literal, não como expressão regular', () => {
    // Colchete, ponto e barra teriam outro sentido em regex.
    const m = marcador({ token: '[XX.XXX.XXX/XXXX]' })
    expect(aplicarMarcadores('<p>[XX.XXX.XXX/XXXX]</p>', [m], {
      [m.id]: '12.345.678/0001-99',
    })).toBe('<p>12.345.678/0001-99</p>')
  })

  it('mantém o marcador quando o valor está vazio', () => {
    // Lacuna aparente no editor é mais segura que buraco silencioso no documento.
    const a = marcador({ token: '[descrição]' })
    const b = marcador({ token: '[NN]' })
    const html = '<p>[descrição] e [NN]</p>'
    expect(aplicarMarcadores(html, [a, b], { [a.id]: '', [b.id]: '   ' })).toBe(html)
  })

  it('deixa como está o marcador que não foi informado', () => {
    const a = marcador({ token: '[descrição]' })
    const b = marcador({ token: '[NN]' })
    expect(aplicarMarcadores('<p>[descrição] e [NN]</p>', [a, b], { [a.id]: '1' })).toBe(
      '<p>1 e [NN]</p>',
    )
  })

  it('devolve o html original quando não há marcador nem valor', () => {
    expect(aplicarMarcadores('', [], {})).toBe('')
    expect(aplicarMarcadores('<p>[A]</p>', [], {})).toBe('<p>[A]</p>')
  })
})

describe('valoresIniciais', () => {
  it('usa o valor do cadastro como ponto de partida', () => {
    const a = marcador({
      token: '[NOME DA EMPRESA]', tipo: 'cadastral', valor_sugerido: 'EMPRESA X',
    })
    const b = marcador({ token: '[descrição]' })
    expect(valoresIniciais([a, b])).toEqual({ [a.id]: 'EMPRESA X', [b.id]: '' })
  })

  it('deixa escolha em branco em vez de pré-selecionar a primeira opção', () => {
    // Escolher errado entre "tempestiva" e "intempestiva" muda o sentido do ato,
    // então a seleção precisa ser consciente.
    const m = marcador({
      token: '[tempestiva /intempestiva]',
      tipo: 'escolha',
      opcoes: ['tempestiva', 'intempestiva'],
    })
    expect(valoresIniciais([m])).toEqual({ [m.id]: '' })
  })

  it('ignora instrução de edição', () => {
    const m = marcador({ token: '[SE HOUVER]', tipo: 'instrucao', preenchivel: false })
    expect(valoresIniciais([m])).toEqual({})
  })
})

describe('separação entre campo e instrução', () => {
  it('campos preenchíveis excluem as instruções', () => {
    const a = marcador({ token: '[NOME DA EMPRESA]', tipo: 'cadastral' })
    const b = marcador({ token: '[SE HOUVER]', tipo: 'instrucao', preenchivel: false })
    const c = marcador({ token: '[descrição]' })
    expect(camposPreenchiveis([a, b, c]).map((m) => m.id)).toEqual([a.id, c.id])
    expect(instrucoesDoModelo([a, b, c]).map((m) => m.id)).toEqual([b.id])
  })
})

describe('totalPendentes', () => {
  it('conta só os campos em branco, ignorando instrução', () => {
    const a = marcador({ token: '[A]' })
    const b = marcador({ token: '[B]' })
    const c = marcador({ token: '[C]', tipo: 'instrucao', preenchivel: false })
    const lista = [a, b, c]
    expect(totalPendentes(lista, { [a.id]: 'x', [b.id]: '' })).toBe(1)
    expect(totalPendentes(lista, { [a.id]: 'x', [b.id]: 'y' })).toBe(0)
    expect(totalPendentes(lista, {})).toBe(2)
    // Espaço em branco não conta como preenchido.
    expect(totalPendentes(lista, { [a.id]: '   ', [b.id]: 'y' })).toBe(1)
  })

  it('lista com todos os valores em branco conta como pendente', () => {
    const a = marcador({ token: '[A]', multivalor: true })
    expect(totalPendentes([a], { [a.id]: ['', '  '] })).toBe(1)
    expect(totalPendentes([a], { [a.id]: ['', 'algo'] })).toBe(0)
  })
})
