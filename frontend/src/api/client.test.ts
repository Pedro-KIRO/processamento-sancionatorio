import { BASE_API } from './client'

/*
  Travas do prefixo /api no frontend.

  Motivo: o endereço da tela e o da API eram o mesmo texto — `/cautelares` era ao
  mesmo tempo a tela e a lista de dados —, e o backend respondia com os dados.
  Quem apertava F5 em oito telas via JSON cru. A API foi movida para `/api`, e
  estes testes existem para que nenhum lugar novo escape do prefixo.

  A varredura é do código-fonte de propósito: o erro que se quer pegar é alguém
  (inclusive eu) montar uma URL de API na mão em vez de usar a base única. Isso
  não aparece em teste de comportamento, só na leitura do fonte.
*/

/** Único arquivo autorizado a ler a variável de ambiente da API. */
const DONO_DA_BASE = '/src/api/client.ts'

/*
  A leitura do fonte usa o `import.meta.glob` do Vite em vez do módulo `fs` do
  Node: o `tsconfig` deste projeto não inclui os tipos do Node, e puxar
  `@types/node` só para um teste não se paga.

  O padrão começa com `/` (raiz do projeto) de propósito. Com caminho relativo,
  o Vite normalizava a chave do próprio `client.ts` para `./client.ts`, e a
  comparação com o dono da base falhava.
*/
const MODULOS = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const FONTES = Object.entries(MODULOS)
  .filter(([caminho]) => !/\.test\.tsx?$/.test(caminho))
  .map(([caminho, texto]) => ({ nome: caminho, texto }))

describe('prefixo /api', () => {
  it('a base da API carrega o prefixo', () => {
    expect(BASE_API.endsWith('/api')).toBe(true)
  })

  it('a varredura do fonte encontrou arquivos (senão a trava passa por vazio)', () => {
    expect(FONTES.length).toBeGreaterThan(30)
  })

  /*
    Cinco lugares montavam a URL da API na mão, dois deles com fallback para a
    porta 8000, que o backend já não usa. Todos passaram a usar BASE_API.
  */
  it('só o client.ts lê VITE_API_URL', () => {
    const infratores = FONTES
      .filter((f) => f.nome !== DONO_DA_BASE && f.texto.includes('VITE_API_URL'))
      .map((f) => f.nome)

    expect(infratores, 
      `Estes arquivos montam a URL da API por conta própria: ${infratores.join(', ')}. ` +
      'Use BASE_API de api/client.ts — fora dela o prefixo /api fica de fora e a ' +
      'chamada quebra.',
    ).toEqual([])
  })

  it('nenhum fetch aponta para caminho de API sem o prefixo', () => {
    // Pega fetch('/algo') e fetch(`/algo`), que ignoram a base.
    const semPrefixo = /fetch\(\s*[`'"]\/(?!api\/)/
    const infratores = FONTES
      .filter((f) => f.nome !== DONO_DA_BASE && semPrefixo.test(f.texto))
      .map((f) => f.nome)

    expect(infratores,
      `Estes arquivos chamam fetch com caminho absoluto sem /api: ${infratores.join(', ')}. ` +
      'Passe pelos helpers de api/client.ts.',
    ).toEqual([])
  })

  /*
    Os downloads usam `<a href>` porque o navegador precisa da URL, não de um
    fetch — e é justamente por isso que eles escapam de qualquer verificação de
    comportamento. Eram quatro, montando a URL na mão.

    A verificação é por linha, e não por arquivo: procura a linha que contém um
    caminho de download e exige BASE_API nela. Um regex genérico de `href` não
    serviria — os links antigos interpolavam a variável de ambiente antes do
    caminho, então o `href` era seguido de `${`, e o regex passaria batido dando
    falsa segurança.
  */
  it('todo link de download monta a URL com a base da API', () => {
    const CAMINHOS_DE_DOWNLOAD = ['download-todos', '/download?tipo=', 'arquivo_url']
    const infratores: string[] = []

    for (const arquivo of FONTES) {
      if (arquivo.nome === DONO_DA_BASE) continue
      arquivo.texto.split('\n').forEach((linha: string, i: number) => {
        const eDownload = CAMINHOS_DE_DOWNLOAD.some((c) => linha.includes(c))
        const temHref = linha.includes('href')
        if (eDownload && temHref && !linha.includes('BASE_API')) {
          infratores.push(`${arquivo.nome}:${i + 1}`)
        }
      })
    }

    expect(infratores,
      `Estes links de download não usam a base da API: ${infratores.join(', ')}. ` +
      'Sem BASE_API o prefixo /api fica de fora e o download devolve a tela ' +
      'em vez do arquivo.',
    ).toEqual([])
  })
})
