# Fases do Processo Administrativo Sancionatório — Especificação

> Documento de referência para implementação. Baseado na documentação v2 da área de negócio.

## Visão Geral das Fases (sequencial obrigatória)

```
1. Chegada do Relatório (já implementado: Caixa de Entrada)
2. Instauração
3. Apresentação de Defesa Prévia
4. Instrução Processual
5. Julgamento
6. Recurso (condicional: só se interposto)
7. Encerramento
```

**Regra fundamental**: o processo deve seguir a ordem rigorosamente.
Não é permitido pular fases (ex.: sair da Instauração direto para Alegações Finais).

---

## Fase 2: Instauração (foco atual)

### Já implementado:
- [x] Criar processo novo no SEI
- [x] Incluir documento (Termo de Instauração + Citação no mesmo doc)
- [x] Incluir no bloco de assinatura (Coordenador se cautelar, Chefe de Divisão se não)
- [x] Marcar status "instaurado" no banco
- [x] Tela de análise de processo com documentos

### A implementar:

1. **Medida cautelar (certidão de bloqueio)**
   - Feita em outro sistema pelo próprio analista
   - O nosso sistema oferece opção de **anexar imagem** (print da tela do outro sistema)
   - Gerar documento interno ou externo no SEI com essa imagem — decisão pendente da área

2. **Disponibilização de acesso externo no SEI**
   - Por enquanto: manual (analista faz no site do SEI)
   - Futuro: endpoint existe mas aguardando liberação de configuração
   - Quando liberado: botão no sistema que chama a API automaticamente

3. **Controle de prazos (15 dias corridos)**
   - Sistema calcula e exibe o prazo
   - Alerta quando está vencendo
   - Detecta se o interessado visualizou (via andamento do SEI — verificar qual idTarefa)
   - Se visualizado dentro do prazo: prazo reinicia
   - Se visualizado mas não respondido em 15 dias: gerar certidão de decurso de prazo (dia seguinte)
   - Se NÃO visualizado em 15 dias: publicação de edital de citação (manual no SEI) + prazo de mais 15 dias
   - Se edital sem resposta: certidão de decurso de prazo (dia seguinte)

4. **Publicação de edital**
   - API do SEI não tem endpoint de publicação
   - Sistema cria o documento interno com o conteúdo do edital
   - Analista publica manualmente no site do SEI

5. **Fase de vida / rastreamento**
   - Campo de fase no banco (enum sequencial)
   - Timeline visual na tela de andamento do processo (não tela separada)
   - Bloqueio de ações fora de ordem
   - Dados exportáveis para BI/Power BI no futuro

---

## Fase 3: Apresentação de Defesa Prévia

- Apresentação da defesa (juntada pelo interessado via acesso externo)
- Se juntada: certificação da juntada + destaque no app
- Se acessou mas não juntou em 15 dias: certidão de decurso de prazo (dia seguinte)

---

## Fase 4: Instrução Processual

- Análise técnica da defesa
- Despacho sobre pedido de produção de provas
- Intimação para alegações finais
- Disponibilização de acesso no SEI
- Prazo de 7 dias
- Se já visualizado anteriormente e não juntou em 7 dias: decurso de prazo
- Se não visualizado: edital de intimação + 7 dias + decurso se sem resposta

---

## Fase 5: Julgamento

- Juntada de parecer referencial (da biblioteca do app)
- Certificação de regularidade processual
- Relatório opinativo
- Parecer de mérito
- Prolação da Decisão I
- Aplicação de penalidade OU arquivamento
- Publicação da decisão

---

## Fase 6: Recurso (condicional)

- Notificação para apresentação de recurso
- Disponibilização de acesso no SEI
- Prazo de 15 dias
- Se não juntado: decurso de prazo
- Se interposto recurso:
  - Despacho para ADJ (encaminhamento)
  - Parecer da consultoria jurídica
  - Retorno dos autos
  - Prolação da Decisão II

---

## Fase 7: Encerramento

- Comunicação aos órgãos competentes (envio de e-mail)
- Despacho de arquivamento
- Termo de encerramento

---

## Decisões pendentes da área de negócio

- [ ] Certidão de bloqueio: documento interno ou externo?
- [ ] Textos padrões dos documentos de cada fase (templates)
- [ ] Quais dados específicos precisam ser rastreados para o BI?
- [ ] Regras de feriado para contagem de prazos (dias corridos, mas verificar se exclui algo)

---

## Notas técnicas

- A timeline de fase aparece na própria tela de análise de processo (não em tela separada)
- Fases bloqueadas: o sistema não permite executar ações de fases futuras
- Cada ação gera registro no banco para rastreabilidade e exportação BI
- Prazos são em dias CORRIDOS (não úteis), conforme legislação
