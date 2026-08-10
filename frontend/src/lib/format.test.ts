import { describe, expect, it } from 'vitest'

import {
  divisaoPorSegmento,
  formatarRazaoSocial,
  formatarTexto,
  mascararDocumento,
  rotuloDocumento,
  rotuloTipoPessoa,
  tipoPessoa,
} from './format'

describe('tipoPessoa', () => {
  it('trata 11 dígitos como pessoa física (CPF)', () => {
    expect(tipoPessoa('123.456.789-09')).toBe('fisica')
    expect(tipoPessoa('12345678909')).toBe('fisica')
  })

  it('trata 14 dígitos como pessoa jurídica (CNPJ)', () => {
    expect(tipoPessoa('27.644.604/0001-27')).toBe('juridica')
    expect(tipoPessoa('27644604000127')).toBe('juridica')
  })

  it('devolve indefinido para documento ausente ou com tamanho inesperado', () => {
    expect(tipoPessoa(null)).toBe('indefinido')
    expect(tipoPessoa('')).toBe('indefinido')
    expect(tipoPessoa('123')).toBe('indefinido')
  })
})

describe('rotuloTipoPessoa', () => {
  it('descreve o tipo de pessoa a partir do documento', () => {
    expect(rotuloTipoPessoa('12345678909')).toBe('Pessoa Física')
    expect(rotuloTipoPessoa('27644604000127')).toBe('Pessoa Jurídica')
  })

  it('usa rótulo neutro quando não é possível identificar', () => {
    expect(rotuloTipoPessoa(null)).toBe('Documento')
  })
})

describe('rotuloDocumento', () => {
  it('nomeia o documento conforme o tipo', () => {
    expect(rotuloDocumento('12345678909')).toBe('CPF')
    expect(rotuloDocumento('27644604000127')).toBe('CNPJ')
  })

  it('mantém o rótulo genérico quando indefinido', () => {
    expect(rotuloDocumento('')).toBe('CPF/CNPJ')
  })
})

describe('mascararDocumento', () => {
  it('aplica máscara de CPF e de CNPJ', () => {
    expect(mascararDocumento('12345678909')).toBe('123.456.789-09')
    expect(mascararDocumento('27644604000127')).toBe('27.644.604/0001-27')
  })

  it('devolve marcador quando não há documento', () => {
    expect(mascararDocumento(null)).toBe('-')
  })
})

describe('divisaoPorSegmento', () => {
  it('expande o código do segmento para o nome completo da divisão', () => {
    expect(divisaoPorSegmento('Educacao')).toBe('Educação e Medidas Administrativas de Trânsito')
    expect(divisaoPorSegmento('Veiculos')).toBe('Veículos')
    expect(divisaoPorSegmento('Condutores')).toBe('Condutores')
  })

  it('reconhece o segmento independente de acento e caixa', () => {
    expect(divisaoPorSegmento('educação')).toBe('Educação e Medidas Administrativas de Trânsito')
    expect(divisaoPorSegmento('VEÍCULOS')).toBe('Veículos')
    expect(divisaoPorSegmento(' condutores ')).toBe('Condutores')
  })

  it('mostra o próprio valor quando o segmento é desconhecido', () => {
    expect(divisaoPorSegmento('Outro')).toBe('Outro')
  })

  it('devolve marcador quando não há segmento', () => {
    expect(divisaoPorSegmento(null)).toBe('-')
    expect(divisaoPorSegmento('')).toBe('-')
  })
})

describe('formatarRazaoSocial', () => {
  it('sobe a razão social para caixa alta', () => {
    expect(formatarRazaoSocial('Auto Escola Modelo Ltda')).toBe('AUTO ESCOLA MODELO LTDA')
    expect(formatarRazaoSocial('maria das graças braga alves')).toBe('MARIA DAS GRAÇAS BRAGA ALVES')
  })

  it('mantém o que já vem em caixa alta do cadastro', () => {
    expect(formatarRazaoSocial('GRAJAU VISTORIA VEICULAR LTDA')).toBe('GRAJAU VISTORIA VEICULAR LTDA')
    expect(formatarRazaoSocial('L & L EMPLACADORA ARARAQUARA LTDA')).toBe('L & L EMPLACADORA ARARAQUARA LTDA')
  })

  it('descarta espaço em volta do nome', () => {
    expect(formatarRazaoSocial('  Vistorias SP  ')).toBe('VISTORIAS SP')
  })

  it('devolve marcador quando não há nome', () => {
    expect(formatarRazaoSocial(null)).toBe('-')
    expect(formatarRazaoSocial('')).toBe('-')
    expect(formatarRazaoSocial('   ')).toBe('-')
  })
})

describe('formatarTexto', () => {
  it('deixa só a primeira letra maiúscula (Sentence case)', () => {
    expect(formatarTexto('instaurado')).toBe('Instaurado')
    expect(formatarTexto('PROCESSO INSTAURADO')).toBe('Processo instaurado')
    expect(formatarTexto('autoescola')).toBe('Autoescola')
  })

  it('não mexe no texto que já está no padrão', () => {
    expect(formatarTexto('Concluído in loco')).toBe('Concluído in loco')
    expect(formatarTexto('A realizar')).toBe('A realizar')
    expect(formatarTexto('Em andamento')).toBe('Em andamento')
  })

  // Sem isso, as classes de agente e os tipos de documento do cadastro
  // sairiam como "Ecv", "Epiv" e "Cnpj".
  it('preserva siglas em caixa alta', () => {
    expect(formatarTexto('ECV')).toBe('ECV')
    expect(formatarTexto('EPIV')).toBe('EPIV')
    expect(formatarTexto('CNPJ')).toBe('CNPJ')
    expect(formatarTexto('TAC assinado')).toBe('TAC assinado')
  })

  it('devolve marcador quando não há texto', () => {
    expect(formatarTexto(null)).toBe('-')
    expect(formatarTexto('')).toBe('-')
    expect(formatarTexto('   ')).toBe('-')
  })
})
