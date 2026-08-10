# Fluxo oficial do Processo Administrativo Sancionatório

> Transcrição fiel do fluxograma entregue pela área de negócio.
> Fonte: `fluxo-processo-administrativo-sancionatorio.pdf` (mesma pasta).
> Render em PNG para leitura rápida: `fluxo-processo-administrativo-sancionatorio.png`.
>
> **Este é o documento de referência para a ordem das fases e dos documentos.**
> Quando o código e este arquivo divergirem, o fluxograma manda — e a divergência
> deve ser levada à área antes de mudar código.

## Legenda do fluxograma

| Marca no desenho | Significado |
|---|---|
| Texto em vermelho | Evento que precisa gerar registro de data/hora |
| `MODELO` (tarja amarela) | Existe texto-padrão nosso para o documento |
| `MODELO DO SEI` | Usa modelo próprio do SEI (termo de encerramento) |
| `DECISÃO` | Documento da série Decisão |
| Losango | Ponto de decisão do analista ou do sistema |
| Balão amarelo | Anotação da área (automação desejada) |

Padrão que se repete em todo o fluxo: **toda notificação ao interessado vem
acompanhada de "Disponibilizar acesso ao usuário pelo Sistema SEI" (liberação de
acesso ao processo por 12 meses) seguida de "Despacho certificando a
disponibilização de acesso"**.

---

## Trecho 1 — Triagem do relatório e TAC

```mermaid
flowchart TD
    R1(["Recebimento do Processo da Fiscalização"]) --> R2["Relatório de Fiscalização"]
    R2 --> D1{"Constatada irregularidade?"}
    D1 -- Não --> A1["Arquivamento do Relatório de Fiscalização<br/>MODELO"]
    A1 --> E1["Termo de Encerramento<br/>MODELO DO SEI"]
    E1 --> F1(["Fim e alimentação da fiscalização"])
    D1 -- Sim --> D2{"Proposta de TAC?"}
    D2 -- Sim --> T1["Assinatura do TAC<br/>MODELO"]
    T1 --> T2["Disponibilizar acesso pelo SEI<br/>(acesso por 12 meses)"]
    T2 --> T3["Despacho certificando a disponibilização<br/>MODELO"]
    T3 --> D3{"TAC assinado?<br/>prazo 15 dias"}
    D3 -- Sim --> E1
    D3 -- Não --> P1["Criação do SEI de Processamento"]
    D2 -- Não --> P1
```

Anotações da área grudadas em "Criação do SEI de Processamento":

- Criação de "Processo Relacionado".
- Encerramento automatizado do SEI de Fiscalização.

---

## Trecho 2 — Instauração e defesa prévia

```mermaid
flowchart TD
    P1["Criação do SEI de Processamento"] --> P2(["Início do Processo Administrativo"])
    P2 --> D4{"Suspensão cautelar?"}

    D4 -- Sim --> C1["Termo de Instauração, Notificação do bloqueio e<br/>para apresentação da defesa e dizer as provas<br/>que pretende produzir — MODELO"]
    C1 --> C2["Disponibilizar acesso pelo SEI<br/>(acesso por 12 meses)"]
    C2 --> C3["Despacho certificando a disponibilização<br/>MODELO"]
    C3 --> C4["Inserir bloqueio no sistema"]
    C4 --> C5["Despacho de certificação de inserção<br/>do bloqueio no sistema — MODELO"]
    C5 --> D5

    D4 -- Não --> N1["Termo de Instauração e Notificação para<br/>apresentação da defesa e dizer as provas<br/>que pretende produzir — MODELO"]
    N1 --> N2["Disponibilizar acesso pelo SEI<br/>(acesso por 12 meses)"]
    N2 --> N3["Despacho certificando a disponibilização<br/>MODELO"]
    N3 --> D5{"O processo foi visualizado?<br/>prazo 15 dias"}

    D5 -- Não --> ED["Citação por Edital com<br/>publicação no DOE — MODELO"]
    ED --> D6
    D5 -- Sim --> D6{"Foi apresentada a defesa?"}
    D6 -- Não --> DC["Despacho certificando o decurso do prazo ou<br/>apresentação intempestiva da defesa — MODELO"]
    D6 -- Sim --> D7["segue para o Trecho 3"]
    DC --> D9["segue direto para 'Pedido de oitiva?' (Trecho 4)"]
```

Detalhe importante: o caminho do **decurso de prazo da defesa** não passa pela
análise da cautelar — ele desce direto para o ponto "Pedido de oitiva?".

---

## Trecho 3 — Revisão da medida cautelar

Só entra quando houve defesa apresentada.

```mermaid
flowchart TD
    D7{"Estabelecimento bloqueado?"}
    D7 -- Não --> D9
    D7 -- Sim --> B1["Análise da manutenção do<br/>bloqueio cautelar — DECISÃO"]
    B1 --> D8{"Desbloqueado?"}
    D8 -- Não --> D9
    D8 -- Sim --> B2["Inserir desbloqueio no sistema"]
    B2 --> B3["Despacho certificando o desbloqueio<br/>MODELO"]
    B3 --> D9{"Pedido de oitiva? (Trecho 4)"}
```

---

## Trecho 4 — Oitiva e alegações finais

```mermaid
flowchart TD
    D9{"Pedido de oitiva?"}
    D9 -- Sim --> D10{"Oitiva será realizada?"}
    D9 -- Não --> AL1

    D10 -- Sim --> O1["Notificação da data da realização da oitiva<br/>e indicação das testemunhas — MODELO"]
    O1 --> O2["Disponibilizar acesso pelo SEI<br/>(acesso por 12 meses)"]
    O2 --> O3["Despacho certificando a disponibilização<br/>MODELO"]
    O3 --> O4["Realização da oitiva pelo Teams"]
    O4 --> O5["Transcrição da oitiva realizada e o link"]
    O5 --> AL1

    D10 -- Não --> O6["Despacho indeferindo o<br/>pedido de oitiva — MODELO"]
    O6 --> AL1["Notificação para alegações finais<br/>prazo 7 dias"]

    AL1 --> AL2["Disponibilizar acesso pelo SEI<br/>(acesso por 12 meses)"]
    AL2 --> AL3["Despacho certificando a disponibilização<br/>MODELO"]
    AL3 --> D11{"Foi apresentada alegações?"}
    D11 -- Não --> AL4["Despacho certificando o decurso do prazo ou<br/>apresentação intempestiva das alegações finais<br/>MODELO"]
    D11 -- Sim --> J1
    AL4 --> J1["Inclusão de Parecer da Consultoria Jurídica<br/>(Trecho 5)"]
```

---

## Trecho 5 — Julgamento e decisão administrativa

```mermaid
flowchart TD
    J1["Inclusão de Parecer da Consultoria Jurídica"]
    J1 --> J2["Despacho certificando que o caso se enquadra no<br/>parecer ou que o parecer foi atendido — MODELO"]
    J2 --> J3["Parecer Opinativo (Chefe de Serviço)<br/>MODELO"]
    J3 --> J4["Manifestação Chefe de Divisão<br/>MODELO"]
    J4 --> J5["Acolho Coordenador<br/>MODELO"]
    J5 --> J6["Decisão Administrativa<br/>MODELO"]
    J6 --> J7["Publicação da Portaria no DOE<br/>MODELO"]
    J7 --> J8["Notificação da decisão e prazo recursal<br/>prazo 15 dias — MODELO"]
    J8 --> J9["Disponibilizar acesso pelo SEI<br/>(acesso por 12 meses)"]
    J9 --> J10["Despacho certificando a disponibilização<br/>MODELO"]
    J10 --> D12{"Penalidade aplicada?"}
    D12 -- Sim --> PN1["Inserir penalidade no sistema"]
    PN1 --> PN2["Despacho certificando a inserção<br/>da penalidade no sistema — MODELO"]
    PN2 --> D13
    D12 -- Não --> D13{"Interposto recurso? (Trecho 6)"}
```

Ordem dos pareceres, de baixo para cima no desenho: Chefe de Serviço opina →
Chefe de Divisão se manifesta → Coordenador acolhe → Decisão Administrativa.

---

## Trecho 6 — Recurso

```mermaid
flowchart TD
    D13{"Interposto recurso?<br/>prazo recursal de 15 dias"}
    D13 -- Não --> E2["Termo de Encerramento<br/>MODELO DO SEI"]
    E2 --> F2(["Fim e alimentação da fiscalização"])

    D13 -- Sim --> RC1["Inclusão de parecer da Consultoria<br/>Jurídica sobre o recurso"]
    RC1 --> D14{"Parecer referencial?"}
    D14 -- Sim --> RC2["Despacho certificando que o caso se<br/>enquadra no parecer referencial — MODELO"]
    RC2 --> D15
    D14 -- Não --> D15{"Recurso é tempestivo?"}

    D15 -- Sim --> RC3
    D15 -- Não --> RC3["Decisão da autoridade competente<br/>MODELO"]
    RC3 --> RC4["Publicação da decisão do recurso no DOE"]
    RC4 --> D16{"Reforma decisão?"}
    D16 -- Sim --> RC5["Inclusão da decisão no sistema"]
    RC5 --> RC6["Despacho de inclusão da decisão<br/>no sistema — MODELO"]
    RC6 --> E3["Termo de Encerramento<br/>MODELO DO SEI"]
    D16 -- Não --> E3
    E3 --> F3(["Fim e alimentação da fiscalização"])
```

Ponto que costuma confundir: **tempestivo e intempestivo desembocam no mesmo
lugar** — "Decisão da autoridade competente". O recurso intempestivo não é
descartado sem decisão; a autoridade decide (não conhecer, no caso).

---

## Prazos que o fluxograma fixa

| Momento | Prazo |
|---|---|
| Assinatura do TAC | 15 dias |
| Visualização do processo / apresentação da defesa | 15 dias |
| Alegações finais | 7 dias |
| Recurso (a contar da notificação da decisão) | 15 dias |
| Validade do acesso externo liberado no SEI | 12 meses |

---

## Dados que a área quer registrar

- Data/hora de cada evento marcado em vermelho no fluxograma.
- Quantos dias entre eventos.
- Servidor que criou o documento.
- Servidor que assinou.
- Produtividade por servidor.
- Contagem de processos por agente regulado.
- Tempo de duração do processo (recebimento do processo da fiscalização → termo
  de encerramento).
- Relação de data/hora e quais usuários externos (e-mail) acessaram o processo.

## Objetivos declarados pela área

- Contar cautelar e o prazo que está suspenso.
- Alerta de processo sem tramitação há mais de XX dias (valor editável).
- Alerta de processos com mais de 90 dias sem termo de encerramento.
- Atribuir e consultar atribuição de processos.
- Processo concluído sem o termo de encerramento.
- Gestão da disponibilização de acesso externo (automação).
- Fila de processos (pensando em um FIFO).
- Flag quando inserido um documento externo no processo.
- Possibilidade de inserir despacho saneador.
- Alerta de certidões não incluídas quando o fluxo exigir.

---

## Como o fluxo oficial se encaixa nas fases do app

Fases implementadas em `backend/app/services/catalogo_fases.py` e rotuladas em
`frontend/src/features/processosAndamento/fases.ts`.

| Trecho do fluxograma | Fase no app | Observação |
|---|---|---|
| Triagem / arquivamento do relatório | fora das fases (`ARQUIVAMENTO_RELATORIO`) | acontece no SEI de fiscalização |
| TAC | não modelado como fase | rota em `services/despachos_sei.py` |
| Termo de instauração + notificação | `instauracao` | |
| Prazo de 15 dias, edital, decurso | `aguardando_defesa` | automação `verificar_prazos.py` |
| Revisão da cautelar + saneamento | `defesa_apresentada` | o app usa despacho saneador |
| Intimação para alegações finais | `instrucao` | prazo de 7 dias |
| Prazo de alegações correndo | `aguardando_alegacoes` | |
| Parecer CJ → opinativo → decisão | `julgamento` | |
| Notificação da decisão e prazo recursal | `recurso` | |
| Termo de encerramento + arquivamento | `encerramento` | |

### Pontos do fluxo oficial ainda sem passo próprio no app

Levantados na leitura do fluxograma, **sem alteração de código** — precisam de
decisão da área antes de virar implementação:

- Ramo da **oitiva** inteiro: pedido, deferimento/indeferimento, notificação da
  data e testemunhas, realização pelo Teams, transcrição e link.
- **Revisão da cautelar** depois da defesa (análise da manutenção, desbloqueio,
  despacho certificando o desbloqueio). Existem as funções
  `cautelar_manutencao` e `cautelar_revogacao` no mapa de séries, mas nenhum
  passo de fase as usa.
- **Inserir bloqueio / desbloqueio / penalidade no sistema** — ações em sistema
  externo, com despacho de certificação depois de cada uma.
- Ramo do **recurso** além da notificação: parecer da CJ sobre o recurso,
  parecer referencial, tempestividade, decisão da autoridade competente,
  publicação no DOE e reforma da decisão.
- **TAC com prazo de 15 dias** para assinatura antes de criar o SEI de
  processamento.
- O **despacho saneador** que o app usa na fase `defesa_apresentada` não aparece
  no fluxograma como caixa; ele consta apenas na lista de objetivos
  ("possibilidade de inserir despacho saneador").
