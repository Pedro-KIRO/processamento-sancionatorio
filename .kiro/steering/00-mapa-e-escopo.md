---
inclusion: always
---

# Mapa do projeto e regras de escopo

Este arquivo é curto de propósito: ele entra no contexto a cada turno. As
referências grandes ficam fora e são carregadas só quando o assunto exige.

## Como trabalhar (economia de tempo e de créditos)

1. **Não reexplore o projeto.** Use o mapa abaixo para ir direto ao arquivo.
   Só investigue além dele se o mapa não responder.
2. **Trabalhe no escopo do pedido.** Não leia, refatore nem "melhore" partes
   não relacionadas.
3. **Avise antes de expandir.** Se a mudança pedida exigir tocar algo fora do
   escopo (outra tela, endpoint, tabela ou automação), diga qual é o impacto e
   pergunte antes de fazer. Não saia mexendo por conta própria.
4. **Verificação proporcional.** Mudança pequena e localizada: rode só os
   testes do arquivo afetado. Mudança que cruza camadas (modelo, endpoint,
   contrato de API): rode a suíte inteira.
5. **Não repita o que já foi verificado** no mesmo turno.

## Referências grandes (carregar só quando o assunto for esse)

- `.kiro/steering/api-sei.md` — endpoints, cabeçalhos e tarefas do SEI.
- `.kiro/steering/sharepoint-integracao.md` — listas, IDs e nomes internos das
  colunas do SharePoint.
- `docs/tecnica/documentacao-tecnica.md` — arquitetura, modelo de dados,
  endpoints e histórico.
- `docs/negocio/fluxo-oficial-processo-sancionatorio.md` — **fonte da verdade do
  fluxo**: transcrição do fluxograma oficial da área (todos os trechos,
  decisões, documentos e prazos). Leia antes de mexer em fase, prazo, ordem de
  documento ou timeline. O PDF/PNG originais estão na mesma pasta.
- `docs/negocio/fases-processo-administrativo.md` — regras das fases.

## Mapa: onde mexer para cada assunto

### Backend (`backend/app/`)

| Assunto | Arquivo |
|---|---|
| Modelo de dados (todas as tabelas) | `db/models.py` |
| Caixa de entrada, apontamentos, histórico do agente | `api/routes/caixa_entrada.py` |
| Processos em andamento, acesso externo, documentos de fase | `api/routes/processos_andamento.py` |
| Fases, prazos, eventos, ações por fase | `api/routes/fases.py` |
| Arquivar / TAC / Instaurar (rotas) | `api/routes/despachos.py` |
| Arquivar / TAC / Instaurar (regra) | `services/despachos_sei.py` |
| Documentos do SEI (listar, baixar, PDF unificado) | `api/routes/documentos.py` |
| Histórico de andamentos | `api/routes/historico.py` |
| Pesquisa global do cabeçalho | `api/routes/busca.py` |
| Tela Consulta Unificada | `api/routes/consulta_unificada.py` |
| Notificações | `api/routes/notificacoes.py` |
| Exportação para BI | `api/routes/exportacao.py` |
| Cliente SEI (HTTP, token, retry) | `integrations/sei/client.py` |
| Cliente SharePoint/Graph | `integrations/graph/client.py` |
| Clientes compartilhados (evita reautenticar) | `core/sei_shared.py` |
| Cache de respostas do SEI | `services/cache_sei.py` |
| Apontamentos de conformidade | `services/conformidade_relatorio.py` |
| Município e superintendência | `services/localizacao_agente.py` |
| Documentos automáticos (certidões, editais) | `services/documentos_automaticos.py` |
| Relatório de fiscalização (HTML) | `services/relatorio_fiscalizacao.py` |
| Configuração e variáveis de ambiente | `core/config.py` |
| Autenticação (Entra ID) | `core/security.py` |
| Registro de rotas | `main.py` |

### Automações (`backend/automacoes/`)

| Assunto | Arquivo |
|---|---|
| Varredura do SEI + limpeza da caixa | `varredura_sei.py` |
| Remoção de itens fora do filtro | `limpar_caixa_entrada.py` |
| Prazos, decurso e detecção de resposta | `verificar_prazos.py` |
| Sincronização da Consulta Unificada | `sincronizar_consulta_unificada.py` |

### Frontend (`frontend/src/`)

| Assunto | Arquivo |
|---|---|
| Menu lateral, cabeçalho, rotas visuais | `components/Layout.tsx` |
| Pesquisa global com sugestões | `components/PesquisaGlobal.tsx` |
| Sino de notificações | `components/NotificacoesDropdown.tsx` |
| Rotas da aplicação | `App.tsx` |
| Tela inicial | `features/home/HomePage.tsx` |
| Caixa de entrada (lista) | `features/caixaEntrada/CaixaEntradaPage.tsx` |
| Análise do relatório | `features/analise/AnaliseRelatorioPage.tsx` |
| Cards de resumo (3 cards) | `features/analise/CardsResumo.tsx` |
| Anotações internas | `features/analise/PainelAnotacoes.tsx` |
| Editor de despacho | `features/analise/DespachoModal.tsx` |
| Processos em andamento (lista) | `features/processosAndamento/ProcessosAndamentoPage.tsx` |
| Análise do processo, timeline, ações de fase | `features/processosAndamento/AnaliseProcessoPage.tsx` |
| Rótulos das fases | `features/processosAndamento/fases.ts` |
| Consulta Unificada | `features/consultaUnificada/ConsultaUnificadaPage.tsx` |
| Formatação (data, documento, tipo de pessoa, divisão) | `lib/format.ts` |
| Cliente HTTP | `api/client.ts` |

Cada `features/<área>/api.ts` concentra as chamadas HTTP daquela área, e
`types.ts` os tipos.

## Regras do projeto que não mudam

- **Toda rota de API vive sob `/api`.** No backend, entre no router `api` do
  `main.py`; no frontend, use `BASE_API` de `api/client.ts` e nunca monte a URL
  na mão. Sem o prefixo o caminho colide com o endereço de uma tela (`/prazos`,
  `/cautelares`, `/usuarios`...) e o F5 passa a devolver JSON cru. Travado por
  `backend/tests/test_prefixo_api.py` e `frontend/src/api/client.test.ts`.
- **Padrão de filtros de tabela:** referência é `ConsultaUnificadaPage.tsx` —
  busca sozinha na primeira linha do cartão e os filtros numa grade abaixo, mais
  `FiltroColuna` no cabeçalho só para o que não está na barra. Caixa de Entrada e
  Processos em Andamento têm apenas a busca; não são a referência.
- Segredos só em `backend/.env`; nunca no código.
- Alterar tabela existente exige `ALTER TABLE` manual (o `create_all` só cria
  tabelas novas).
- Upload e inclusão de documento no SEI usam a **mesma unidade**.
- As fases são sequenciais e não podem ser puladas.
- Testar com dados reais antes de dizer que está pronto.
- Fuso do banco: `America/Sao_Paulo`.
