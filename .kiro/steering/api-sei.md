---
inclusion: manual
---

<!-- Carregado sob demanda: só entra no contexto quando a tarefa envolve a API
     do SEI. Antes era `auto` e ocupava contexto em todos os turnos. -->

# API do SEI — Referência Completa de Endpoints

Este arquivo documenta os endpoints da API do SEI utilizados pelo sistema de Processamento Sancionatório.
Extraído dos scripts de produção (`backend/automacoes/caixa_entrada_prod.py` e `atualizar_assinaturas/`).

## Base URL

- **Produção:** `https://sei-processos.api.rota.sp.gov.br`
- **Homologação:** `https://sei-processos.api-hml.rota.sp.gov.br`

## Autenticação

OAuth2 `client_credentials` via IdP do estado de SP.

- **Token URL:** `https://idp.sp.gov.br/auth/realms/idpsp/protocol/openid-connect/token`
- **Body:**
  ```
  grant_type=client_credentials
  client_id={SEI_CLIENT_ID}
  client_secret={SEI_CLIENT_SECRET}
  ```
- **Resposta:** `{ "access_token": "...", "expires_in": 3600, ... }`
- **Renovação:** antes de expirar (geralmente a cada ~59 min)

## Headers padrão em TODAS as requisições

```
Authorization: Bearer {token}
X-SiglaSistema: CSDR_PROCESSAMENTO
X-IdUnidade: {id_unidade}
X-IdentificacaoServico: {hash de identificação do serviço}
X-TraceId-SP: {trace_id}
Accept: application/json
```

## Unidades-alvo (CPSAR)

IDs das unidades que a automação varre:
```
110051045, 110051042, 110053117, 110051044, 110051043, 110053119
```

---

## Endpoints

### 1. Listar Processos

- **Método:** GET
- **URL:** `/processos`
- **Parâmetros (query):**
  - `limit` (int): máximo de itens por página (ex: 500)
  - `start` (int): índice da página (0, 1, 2...)
  - `tipo` (string): "T" para todos
- **Headers:** padrão + `X-IdUnidade` da unidade sendo varrida
- **Resposta:**
  ```json
  {
    "listaProcessos": [
      {
        "idProcedimento": "123456",
        "protocoloProcedimento": "00012345620240001"
      },
      ...
    ]
  }
  ```
- **Uso no projeto:** varredura periódica de todas as unidades (automação caixa_entrada_prod)
- **Observações:** paginação via `start` (incrementa de 1 em 1); parar quando `listaProcessos` vier vazio

---

### 2. Consultar Processo (Detalhes)

- **Método:** GET
- **URL:** `/processos/{numero_sei_limpo}`
  - `numero_sei_limpo`: número SEI sem pontuação (só dígitos)
- **Parâmetros (query):**
  - `sinRetornarUltimoAndamento`: "true" (retorna o último andamento junto)
- **Headers:** padrão + `X-IdUnidade`
- **Resposta:**
  ```json
  {
    "idProcedimento": "123456",
    "procedimentoFormatado": "140.00286276/2026-27",
    "tipoProcesso": "Centros de formação de condutores – CFC AB",
    "razaoSocial": "Auto Escola Modelo Ltda",
    "ultimoAndamento": {
      "descricao": "Processo remetido pela unidade DETRAN/SI-SJC/SFR",
      "dataHora": "15/03/2026 10:30:00"
    }
  }
  ```
- **Uso no projeto:**
  - Detalhes do processo na tela de análise
  - Filtro de negócio: verifica se `ultimoAndamento.descricao` indica remessa por SFR
  - O campo `idProcedimento` é usado para montar o link direto no SEI web
- **Observações:**
  - O `idProcedimento` numérico é o que o SEI usa internamente para abrir o processo
  - Para link direto: `{SEI_WEB_URL}/controlador.php?acao=procedimento_trabalhar&id_procedimento={idProcedimento}`

---

### 3. Andamentos Completos

- **Método:** GET
- **URL:** `/andamentos/completo`
- **Parâmetros (query):**
  - `protocoloProcedimento` (string): idProcedimento do processo
  - `retornaAtributos`: "S"
  - `tipoHistorico`: "R" (remessas) ou "Z" (todos)
  - `start` (int): índice de paginação (começa em 0)
  - `limit` (int): itens por página (ex: 50 ou 90)
  - `tarefas` (string): "5" (opcional, usado em atualizar_assinaturas)
- **Headers:** padrão + `X-IdUnidade`
- **Resposta:**
  ```json
  {
    "Andamentos": [
      {
        "descricao": "Processo remetido pela unidade DETRAN/SI-SJC/SFR",
        "dataHora": "15/03/2026 10:30:00",
        "unidadeOrigem": { "descricao": "Serviço de Processamento Sancionatório ..." },
        "unidade": { "descricao": "Serviço de Processamento Sancionatório ..." }
      },
      ...
    ]
  }
  ```
- **Uso no projeto:**
  - Extrair `data_remessa`: andamento com descrição contendo unidade SFR e destino "Serviço de Processamento..."
  - Extrair `data_recebimento`: andamento com descrição "Processo recebido na unidade" e origem "Serviço de Processamento..."
  - Calcular `fase_pa`: texto entre parênteses do primeiro andamento
  - Calcular `data_instauracao`: data do andamento que contém um dos documentos cadastrados
- **Observações:**
  - Formato de data: `dd/mm/yyyy HH:mm:ss` (converter para ISO antes de gravar)
  - Paginação: incrementar `start` enquanto `len(Andamentos) == limit`

---

### 4. Andamentos para Documentos (variação do endpoint 3)

Usamos o mesmo endpoint `/andamentos/completo` com parâmetros específicos para obter
os documentos gerados no processo.

- **Método:** GET
- **URL:** `/andamentos/completo`
- **Parâmetros (query):**
  - `protocoloProcedimento` (string): idProcedimento do processo
  - `retornaAtributos`: "S"
  - `tipoHistorico`: "Z" (todos)
  - `tarefas`: "2,13,33" (2=geração doc interno, 13=doc externo, 33=exclusão de doc)
  - `start` (int): 0, 1, 2... (paginação)
  - `limit` (int): 100
- **Headers:** padrão + `X-IdUnidade`
- **Lógica:**
  - Tarefa 2 ou 13 → documento gerado (incluir na lista)
  - Tarefa 33 → documento excluído (remover da lista)
  - Cada andamento traz atributos com o número do documento
- **Uso no projeto:** aba "Documentos" na tela de análise

---

### 5. Consultar Documento (metadados)

- **Método:** GET
- **URL (base documentos):** `https://sei-documentos.api.rota.sp.gov.br/documentos/{numeroDOC}`
- **Headers:** padrão + `X-IdUnidade`
- **Resposta:**
  ```json
  {
    "nome": "Relatório de Fiscalização",
    "nomeArvore": "Relatório de Fiscalização (0123456)",
    "tipo": "I",
    ...
  }
  ```
- **Campos relevantes:**
  - `nome` / `nomeArvore`: nome do documento para exibição
  - `tipo`: "I" (interno) ou "E" (externo)
- **Uso no projeto:** exibir nome e tipo na aba Documentos

---

### 6. Download de Documento — Conteúdo (internos)

- **Método:** GET
- **URL:** `https://sei-documentos.api.rota.sp.gov.br/documentos/{numeroDOC}/conteudo`
- **Headers:** padrão + `X-IdUnidade`
- **Resposta:** base64 do conteúdo do documento (HTML ou PDF)
- **Uso no projeto:** visualizar documentos internos (converter base64 → PDF/HTML no frontend)

---

### 7. Download de Documento — Anexos (externos)

- **Método:** GET
- **URL:** `https://sei-documentos.api.rota.sp.gov.br/documentos/{numeroDOC}/anexos`
- **Headers:** padrão + `X-IdUnidade`
- **Resposta:** base64 do arquivo anexo (PDF, imagem, etc.)
- **Uso no projeto:** visualizar/baixar documentos externos

---

### 8. Listar Séries (tipos de documento)

- **Método:** GET
- **URL (base parâmetros):** `https://sei-parametros.api.rota.sp.gov.br/series`
- **Headers:** padrão + `X-IdUnidade`
- **Resposta:** lista de séries com `idSerie` e `nome`
- **Observação:** o resultado é por unidade — para conhecer tudo, chame uma vez
  por unidade. Medido em produção: 2.666 séries, praticamente todas habilitadas
  nas seis unidades do CPSAR.
- **Uso no projeto:** descobrir o `idSerie` correto de cada documento. Script:
  `backend/scripts/listar_series_sei.py` (aceita `--filtro` e `--json`).

---

## Constantes de Negócio

### Séries usadas pelo processamento (idSerie)

Confirmadas em `GET /series`. Centralizadas em `app/services/series_sei.py`.

| idSerie | Nome |
|---|---|
| 1172 | DETRAN - Despacho |
| 5083 | DETRAN - Intimação |
| 5084 | DETRAN - Decisão |
| 2382 | DETRAN - Citação |
| 5276 | DETRAN - Citação em Processo Administrativo Sancionatório |
| 2380 | DETRAN - Certidão |
| 2381 | DETRAN - Notificação |
| 2410 | DETRAN - Relatório |
| 2412 | DETRAN - Parecer de mérito |
| 2489 | DETRAN - Edital |
| 2403 | DETRAN - Termo de encerramento |
| 2377 | DETRAN - Termo de instauração |
| 5291 | DETRAN - Termo de ajustamento de conduta |
| 1266 | DETRAN - Relatório de fiscalização |
| 1917 | Anexo (documento externo) |

**Cuidado:** até julho/2026 o app usava **2403 para quase tudo**, supondo que
fosse "Despacho". 2403 é **Termo de encerramento** — despacho é **1172**.
Documentos criados antes da correção estão com o rótulo errado na árvore do SEI
(o conteúdo está certo).

Sem série própria no catálogo: **relatório opinativo** entra como Relatório
(2410), **despacho saneador** como Despacho (1172). **Portaria** de penalidade
não tem série adequada (só "Portaria Conjunta" e "Portaria de Pessoal") — sai
como Decisão até a área definir.

### Unidades SFR permitidas (remetentes válidos)
```
DETRAN/SI-ARR/SFR, DETRAN/SI-BTC/SFR, DETRAN/SI-CPN/SFR, DETRAN/SI-FND/SFR,
DETRAN/SI-ITP/SFR, DETRAN/SI-JND/SFR, DETRAN/SI-PPR/SFR, DETRAN/SI-RPT/SFR,
DETRAN/SI-SAN/SFR, DETRAN/SI-SJC/SFR, DETRAN/SI-SJR/SFR, DETRAN/SI-SPL/SFR,
DETRAN/SI-BRU/SFR, DETRAN/SI-RGT/SFR, DETRAN/SI-ARC/SFR, DETRAN/SI-GRU/SFR,
DETRAN/SI-SBC/SFR, DETRAN/SI-OSC/SFR, DETRAN/SI-FRC/SFR, DETRAN/SI-SRC/SFR,
DETRAN/DGR/CQCFAR/DCAR, DETRAN/DGR/CQCFAR/DFAR, DETRAN/DGR/CQCFAR/DFAR/SFA-VPD,
DETRAN/DGR/CQCFAR/DFAR/SFAC, DETRAN/DGR/CQCFAR/DFAR/SFAET, DETRAN/DGR/CQCFAR/DFAR/SFAMA,
DETRAN/DGR/CQCFAR/DFAR/SFAV
```

### Mapeamento de Agente Regulado
| Valor SharePoint (listaDesignação) | Valor canônico |
|---|---|
| Centros de formação de condutores – CFC A/AB/B | Autoescola |
| Clínica de Medicina/Psicologia do Tráfego | Peritos |
| Empresas credenciadas de vistoria – Presencial/Remota | ECV |
| Empresas estampadoras de placas – PIV | EPIV |
| Desmontes Fiscalização / Credenciamento | Desmontes |

### Link Direto (abrir processo no SEI web)
```
{SEI_WEB_URL}/controlador.php?acao=procedimento_trabalhar&id_procedimento={idProcedimento}
```
O `idProcedimento` vem da resposta de `GET /processos/{numero}`.

---

## Fluxo Completo da Automação (caixa_entrada_prod)

1. **Autenticar** no IdP (token OAuth2)
2. **Listar** processos de cada unidade-alvo (`GET /processos?limit=500&start=0&tipo=T`)
3. Para cada processo novo (não está no cache):
   - **Consultar** detalhes (`GET /processos/{numero}?sinRetornarUltimoAndamento=true`)
   - Verificar se foi remetido por uma unidade SFR → senão, descartar
   - **Buscar andamentos** (`GET /andamentos/completo`) para extrair datas
4. **Consultar SharePoint** (listaDesignação) para enriquecer com dados do relatório
5. **Gravar** na Caixa de Entrada (SharePoint → futuro: banco próprio)
6. Marcar protocolo como processado no cache JSON
