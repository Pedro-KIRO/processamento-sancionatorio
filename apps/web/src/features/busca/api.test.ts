import { describe, expect, it } from 'vitest'

import { rotaDoResultado, type ResultadoBusca } from './api'

function resultado(parcial: Partial<ResultadoBusca>): ResultadoBusca {
  return {
    caixa_entrada_id: 7,
    tipo: 'relatorio',
    numero_sei: '140.00100000/2026-01',
    id_procedimento: '111',
    razao_social: 'AUTO ESCOLA MODELO LTDA',
    cnpj_cpf: '12.345.678/0001-99',
    agente_regulado: 'Autoescola',
    status_triagem: 'pendente',
    ...parcial,
  }
}

describe('rotaDoResultado', () => {
  it('manda relatório para a tela de análise do relatório', () => {
    expect(rotaDoResultado(resultado({ tipo: 'relatorio' }))).toBe('/analise/7')
  })

  it('manda processo para a tela do processo', () => {
    expect(rotaDoResultado(resultado({ tipo: 'processo' }))).toBe('/processos/7')
  })

  it('usa o tipo do que foi encontrado, não o status do item', () => {
    // Um item instaurado tem os dois números. Pesquisar o número do RELATÓRIO
    // deve abrir a tela do relatório — era justamente o caso que caía errado.
    const rel = resultado({ tipo: 'relatorio', status_triagem: 'instaurado' })
    expect(rotaDoResultado(rel)).toBe('/analise/7')

    const proc = resultado({ tipo: 'processo', status_triagem: 'instaurado' })
    expect(rotaDoResultado(proc)).toBe('/processos/7')
  })
})
