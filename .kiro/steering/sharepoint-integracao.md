---
inclusion: manual
---

<!-- Carregado sob demanda: só entra no contexto quando a tarefa envolve listas
     do SharePoint. Antes era `auto` e ocupava contexto em todos os turnos. -->

# Integração SharePoint — Referência para o Projeto

Documenta as listas do SharePoint usadas pelo sistema e como o enriquecimento
de dados funciona (listaDesignação → Caixa de Entrada).

## Autenticação (Microsoft Graph)

- **Token URL:** `https://login.microsoftonline.com/{GRAPH_TENANT_ID}/oauth2/v2.0/token`
- **Body:** `grant_type=client_credentials`, `client_id`, `client_secret`, `scope=https://graph.microsoft.com/.default`
- **Header:** `Authorization: Bearer {token}`

## Sites SharePoint

| Alias | Caminho | Uso |
|-------|---------|-----|
| DCAN | `governosp.sharepoint.com:/teams/DETRAN-DCAN` | listaDesignação (dados do relatório de fiscalização), listaDivisao |
| CPSAR | `governosp.sharepoint.com:/teams/DETRAN-CPSAR` | listaCaixaDeEntrada, listaProcEmAndamento, listaFasesPA, listaUsuarios, listaSEIDespachos |
| DGR | `governosp.sharepoint.com:/teams/DETRAN-DGR` | listaMunicipios (município → superintendência) |

## Listas principais

### listaDesignação (site DCAN)

**ID:** `2855ddc6-c7e4-4b1a-a972-5bb939f378d3`

Contém os dados do relatório de fiscalização criados pela equipe de designação.
É a **fonte primária** para enriquecer os dados que vêm da API SEI.

**Campos relevantes:**
| Campo | Tipo | Descrição |
|-------|------|-----------|
| `numeroSei` | string | Número SEI formatado (com pontuação) — chave de busca |
| `ID_Relatorio` | string/int | ID do relatório de fiscalização |
| `agenteRegulado` | string | Tipo do agente (valor descritivo, precisa normalizar) |
| `cnpj` | string | CNPJ ou CPF do agente regulado |
| `razaoSocial` | string | Razão social / nome do agente |
| `cidade` | string | Município do agente — chave para achar a superintendência |
| `dataInicioFiscalizacao` | data | Data de início da fiscalização |

**Consulta via Graph:**
```
GET /sites/{site_dcan_id}/lists/{LISTA_DESIGNACAO_ID}/items
  ?$expand=fields
  &$filter=fields/numeroSei eq '{numero_sei_formatado}'
  &$top=1
Headers: Authorization, Prefer: HonorNonIndexedQueriesWarningMayFailRandomly
```

---

### listaMunicipios (site DGR)

**ID:** `1d0e99a3-5bc7-4937-8dc0-a05c527818ef`

Relaciona município → superintendência regional. É como o app de Fiscalização
(Power Apps) descobre a superintendência de um agente regulado.

**Atenção:** os nomes de exibição não são os nomes internos usados pelo Graph.
O Power Apps mostra `Cidade`/`Superintendencia`, mas na API os campos são
`field_N`. Use sempre os nomes internos:

| Nome de exibição | Nome interno | Conteúdo | Exemplo |
|------------------|--------------|----------|---------|
| `Cidade` | `field_1` | Município **sem acento** (chave de busca) | `Aracatuba` |
| `Superintendencia` | `field_2` | Superintendência **sem acento** | `Aracatuba` |
| `Municipio` | `field_3` | Município **com acento** (para exibir) | `Araçatuba` |
| `Super` | `field_4` | Superintendência **com acento** (para exibir) | `Araçatuba` |

Boa prática: casar pelo campo sem acento (`field_1`) e exibir os acentuados
(`field_3`, `field_4`).

---

### listaDivisao (site DCAN)

**ID:** `9e5a20c8-c1a5-4d5c-9dbd-d4ec99d02ba4`

Relaciona superintendência → unidade SEI e responsáveis. No app de Fiscalização
é a origem da "Mesa" (`VarMesa.Title` = idUnidade do SEI).

| Nome de exibição | Nome interno | Conteúdo | Exemplo |
|------------------|--------------|----------|---------|
| `Title` | `Title` | idUnidade do SEI | `110053146` |
| `unidade` | `field_1` | Descrição da unidade remetente | `Processo remetido pela unidade DETRAN/SI-ARR/SFR` |
| `superintendente` | `field_2` | Nome do superintendente | — |
| `chefeSetor` | `field_3` | Nome do chefe de setor | — |
| `superintendencia` | `field_4` | Superintendência (chave de busca) | `Araraquara` |
| `Email` / `Email2` / `Email3` | idem | E-mails do setor | — |

---

### Cadeia município → superintendência → divisão

Extraída do app de Fiscalização (`msapp/DETRAN - DGR - Fiscalização.msapp`,
telas `telaDemandas` e `telaValidacaoEmail`):

```
listaDesignacao.cidade
  → LookUp(listaMunicipios, Cidade = cidade).Superintendencia     → varSuper
    → LookUp(listaDivisao, superintendencia = varSuper)            → VarMesa
       .Title      → idUnidade SEI (a "Mesa")
       .Email      → e-mail do setor
       .chefeSetor → chefe do setor
```

---

### listaCaixaDeEntrada (site CPSAR)

**ID:** `62d23c4f-0ccb-44c9-bc0a-be052bea3668`

Destino final dos dados processados pela automação. No futuro será substituída
pelo banco próprio do sistema.

**Campos gravados:**
| Campo | Tipo | Origem |
|-------|------|--------|
| `ID_Relatorio` | string | listaDesignação |
| `numeroSEI` | string | API SEI (procedimentoFormatado) |
| `razaoSocial` | string | listaDesignação (ou fallback da API SEI) |
| `agenteRegulado` | string | listaDesignação (normalizado) |
| `tipoDocumento` | string | "CPF" se Peritos/Despachantes, senão "CNPJ" |
| `CNPJ_x002f_CPF` | string | listaDesignação.cnpj (com máscara aplicada) |
| `dataRecebimento` | datetime ISO | Andamentos SEI (data do "Processo recebido na unidade") |
| `dataRemetido` | datetime ISO | Andamentos SEI (data da remessa pela SFR) |
| `copiaID` | int | ID do próprio item (gravado em PATCH após criação) |

**Verificação de duplicidade:** antes de gravar, consulta:
```
GET /sites/{site_cpsar_id}/lists/{LISTA_CAIXA_ENTRADA_ID}/items
  ?$expand=fields
  &$filter=fields/numeroSEI eq '{numero_sei}'
  &$top=1
```
Se retornar item, o processo já existe → não duplicar.

---

### Outras listas (site CPSAR)

| Lista | Uso |
|-------|-----|
| `listaProcEmAndamento` | Processos com fase ativa (atualizado por `atualizar_assinaturas`) |
| `listaFasesPA` | Fases do processo administrativo |
| `listaUsuarios` | Mapeamento agente → idUnidade (para saber qual unidade consultar no SEI) |
| `listaSEIDespachos` | Descrições de documentos usadas para calcular data de instauração |

---

## Fluxo de Enriquecimento (listaDesignação → Banco)

```
API SEI (processos) ──→ Filtro SFR ──→ Consulta SharePoint (listaDesignação)
                                              │
                                              ▼
                                   Campos enriquecidos:
                                   - ID_Relatorio
                                   - agenteRegulado (normalizado)
                                   - cnpj/cpf
                                   - razaoSocial
                                              │
                                              ▼
                              Gravação: banco próprio (futuro)
                              Hoje: listaCaixaDeEntrada no SharePoint
```

**Regra de normalização do agente:**
O campo `agenteRegulado` da listaDesignação usa nomes descritivos longos.
A automação normaliza para valores canônicos (Autoescola, Peritos, ECV, EPIV, Desmontes).
Mapeamento completo na doc da API SEI (#[[file:.kiro/steering/api-sei.md]]).

**Fallback:** se a listaDesignação não retornar `agenteRegulado`, classifica pelo `tipoProcesso` da API SEI.

---

## Migração para o banco próprio

A ideia é substituir a gravação no SharePoint por gravação direta no banco:
1. A automação continua varrendo o SEI e consultando a listaDesignação
2. Em vez de gravar via Graph na listaCaixaDeEntrada, grava no modelo `CaixaEntrada` do SQLAlchemy
3. Quando o banco SQL Server estiver disponível, desacopla totalmente do SharePoint

O modelo `CaixaEntrada` do banco (`backend/app/db/models.py`) já tem os campos equivalentes:
`id_relatorio`, `numero_sei`, `razao_social`, `agente_regulado`, `segmento`, `tipo_documento`,
`cnpj_cpf`, `data_recebimento`, `data_remetido`, `status_triagem`.
