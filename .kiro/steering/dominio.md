---
inclusion: always
---

# Domínio — processamento

## Identidade do sistema
- **Nome:** `processamento`
- **Descrição:** conduz o processo administrativo sancionatório do DETRAN-SP contra
  agentes regulados (credenciados, clínicas, CFCs, despachantes, ECVs). Cobre o ciclo
  completo: recebimento do relatório de fiscalização vindo do SEI, triagem dos
  apontamentos de conformidade, decisão de encaminhamento (arquivar, TAC ou instaurar),
  condução das fases do processo com controle de prazos e, por fim, o encerramento.
  Usado pela área de processamento sancionatório e pelas superintendências regionais.
- **É o núcleo?** NÃO — consome identidade e permissões de sistemas externos e é a fonte
  da verdade apenas do seu próprio domínio sancionatório.

## Entidades canônicas
- **Consome do contrato:** nenhuma entidade canônica de negócio hoje. Consome apenas
  identidade e autorização do schema `gestao_acessos_v2` (somente leitura), conforme
  `permissionamento.md`.
- **Publica (apenas se for o núcleo):** não se aplica.

> Os dados de agente regulado, processo e relatório são próprios deste domínio e vêm do
> SEI, não do contrato compartilhado. Se no futuro "Agente Regulado" for promovido a
> entidade canônica, a mudança passa por expand/contract (`migration-nucleo.md`).

## Regras de negócio

- **As fases são sequenciais e não podem ser puladas.** A ordem obrigatória é:
  `instauracao` → `aguardando_defesa` → `defesa_apresentada` → `instrucao` →
  `aguardando_alegacoes` → `julgamento` → `recurso` → `encerramento`.
  Os rótulos exibidos ao usuário não coincidem com os códigos; a tradução é única e
  compartilhada entre a timeline e a Consulta Unificada.
- **A fonte da verdade do fluxo** (trechos, decisões, documentos e prazos) é
  `docs/negocio/fluxo-oficial-processo-sancionatorio.md`. Leia antes de alterar fase,
  prazo, ordem de documento ou timeline. Não inferir regra de fluxo a partir do código.
- **Upload e inclusão de documento no SEI usam a mesma unidade.** Divergir de unidade
  entre as duas chamadas faz o SEI rejeitar o documento.
- **Prazos correm em dias conforme o fluxo oficial**, considerando a tabela de feriados.
  Decurso de prazo e detecção de resposta são apurados por automação, não manualmente.
- **Um processo instaurado não volta para a caixa de entrada.** A triagem é o ponto de
  entrada; depois da instauração o acompanhamento é pela tela de processos em andamento.
- **Toda rota de API vive sob `/api`.** Sem o prefixo, o caminho colide com o endereço de
  uma tela (`/prazos`, `/cautelares`, `/usuarios`) e o F5 devolve JSON cru. Regra travada
  por teste automatizado.
- **Fuso do banco: `America/Sao_Paulo`.** Datas de prazo e vencimento dependem disso.

## Regra de autorização

O escopo de atuação deriva de **dado canônico do servidor**, nunca de valor enviado pelo
cliente:

- A identidade vem de `gestao_acessos_v2.tb_usuarios`, resolvida pelo `UsuarioAtualGuard`.
- A permissão de cada endpoint é verificada pelo `PermissionGuard` no formato
  `processamento:{recurso}:{acao}`.
- **Escopo por superintendência/unidade:** quando um endpoint restringe a atuação à
  unidade do servidor, a unidade é obtida do cadastro do usuário e da configuração de
  unidade do agente regulado — nunca de parâmetro de query ou corpo da requisição.
- Ações que produzem documento no SEI (arquivar, TAC, instaurar, despachar) são sempre
  registradas em log de auditoria com autor, ação e momento.

## Módulos principais

Módulos NestJS previstos em `apps/api/src/app/`, um por domínio:

| Módulo | Responsabilidade |
|---|---|
| `AuthModule` / `PermissionsModule` | Identidade e permissões (padrão da plataforma) |
| `CaixaEntradaModule` | Triagem, apontamentos de conformidade, histórico do agente |
| `AnaliseModule` | Anotações internas e cards de resumo do relatório |
| `DespachosModule` | Arquivar, TAC e instaurar — gera documento no SEI |
| `ProcessosAndamentoModule` | Processos em andamento, acesso externo, documentos de fase |
| `FasesModule` | Fases, prazos, eventos e ações por fase |
| `DocumentosModule` | Listar, baixar e unificar documentos do SEI em PDF |
| `HistoricoModule` | Histórico de andamentos |
| `BuscaModule` | Pesquisa global do cabeçalho |
| `ConsultaUnificadaModule` | Tela de consulta unificada |
| `NotificacoesModule` | Notificações do sistema |
| `PrazosModule` | Consulta e acompanhamento de prazos |
| `CautelaresModule` | Medidas cautelares |
| `RecursosModule` | Recursos e decisões |
| `AdvogadosModule` | Cadastro de advogados |
| `BibliotecaModule` | Biblioteca de documentos e modelos |
| `TextosPadroesModule` | Textos-padrão do SEI |
| `UsuariosModule` | Cadastro de usuários do sistema |
| `AuditoriaModule` | Log de auditoria |
| `ExportacaoModule` | Exportação para BI |

## Integrações e extensões de fronteira

| Integração | Natureza |
|---|---|
| **SEI** (API REST) | Fonte dos processos, relatórios e documentos; destino dos documentos gerados. Detalhes em `.kiro/steering/api-sei.md`. |
| **SharePoint / Microsoft Graph** | Listas de apoio e dados de agentes regulados. Detalhes em `.kiro/steering/sharepoint-integracao.md`. |
| **Gestão de Acessos** (`gestao_acessos_v2`) | Identidade e permissões, somente leitura. |

Nenhuma extensão de fronteira para outras diretorias prevista no momento.
