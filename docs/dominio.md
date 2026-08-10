# Domínio — Processamento Sancionatório CPSAR

## O que o sistema faz

Gerencia o ciclo de vida completo de processos administrativos sancionatórios contra agentes regulados pelo DETRAN-SP (Autoescolas, Peritos, Desmontes, Despachantes, ECVs, Estampadoras). Integrado ao SEI (Sistema Eletrônico de Informações do Governo SP) para criação de processos, inclusão de documentos e controle de prazos.

## Para quem

Analistas e coordenadores da Coordenadoria de Processamento Sancionatório dos Agentes Regulados (CPSAR), dentro da Diretoria de Gestão Regulatória (DGR) do DETRAN-SP.

## Entidades canônicas

| Entidade | Papel neste sistema |
|----------|---------------------|
| Agente Regulado | Entidade central — o fiscalizado (autoescola, perito, desmonte, etc.) |
| Processo SEI | Referência externa — criado e gerido no SEI, consumido aqui |
| Servidor (usuário) | Quem opera o sistema (analista ou coordenador) |

## Módulos

| Módulo | Responsabilidade |
|--------|------------------|
| CaixaEntrada | Recebimento e triagem dos relatórios de fiscalização |
| Despachos | Ações sobre o relatório: Arquivar, TAC, Instaurar |
| ProcessosAndamento | Acompanhamento do processo instaurado por fases |
| Fases | Controle sequencial das fases (instauração → encerramento) |
| Prazos | Contagem de prazos, detecção de visualização, decurso |
| Documentos | Geração, upload e inclusão de documentos no SEI |
| TextosPadroes | Edição dos modelos de documento pela coordenação |
| ConsultaUnificada | Visão consolidada de toda a fiscalização (somente leitura) |
| Notificacoes | Alertas de eventos relevantes (defesa juntada, prazo vencido) |

## Integrações

| Sistema externo | Como integra |
|-----------------|--------------|
| SEI (API REST) | Criação de processos, inclusão de documentos, consulta de andamentos, definição de prazos, blocos de assinatura |
| Microsoft Graph / SharePoint | Leitura de listas de referência (designações, perguntas de checklist, municípios) |
| Microsoft Entra ID | Autenticação SSO dos usuários |

## Vocabulário do domínio

| Termo | Significado |
|-------|-------------|
| Agente regulado | Pessoa jurídica ou física fiscalizada pelo DETRAN (autoescola, perito, ECV, etc.) |
| Relatório de fiscalização | Documento SEI que reporta irregularidades encontradas em campo |
| Instauração | Ato de abrir formalmente o processo sancionatório |
| Saneador | Despacho que organiza os autos e define o próximo passo |
| Termo de instauração | Documento que formaliza o início do processo |
| Citação | Notificação ao agente de que há processo contra ele |
| Defesa prévia | Manifestação do agente em resposta à citação |
| Decurso de prazo | Quando o prazo vence sem resposta do agente |
| Cautelar | Medida de bloqueio preventivo antes da decisão final |
| TAC | Termo de Ajuste de Conduta — acordo sem processo completo |
| Fase processual | Etapa sequencial obrigatória do processo (não pode pular) |

## Decisões de arquitetura

| Decisão | Justificativa |
|---------|---------------|
| Backend Python/FastAPI (não NestJS do template) | Sistema já funcional com 269 testes; reescrita em TypeScript seria retrabalho sem ganho funcional |
| SQLite em dev, PostgreSQL em produção | SQLAlchemy abstrai; migração é trocar a URL |
| Modelos de documento vindos do SEI | Em vez de manter templates manuais, importamos direto e o coordenador ajusta na tela |
| Fases sequenciais obrigatórias | Regra da área de negócio; o app impede pular fase |
| Cache persistente de respostas do SEI | Documentos assinados são imutáveis; sem cache a tela ficava lenta |
