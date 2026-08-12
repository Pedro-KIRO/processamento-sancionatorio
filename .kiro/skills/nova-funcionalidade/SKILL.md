---
name: nova-funcionalidade
description: Guiar o dev no fluxo obrigatório de spec antes de implementar funcionalidades de negócio. Ativa quando o dev menciona "nova funcionalidade", "novo caso de uso", "nova tela", "implementar fluxo", "novo módulo de negócio", "quero criar", "preciso fazer" ou "área pediu".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: process
---

# Nova Funcionalidade (Fluxo de Negócio)

Esta skill é o **guarda de portão** — garante que nenhuma funcionalidade de
negócio seja implementada sem spec e sem validação com o interlocutor.

## Quando ativa

- Dev menciona "nova funcionalidade", "novo caso de uso", "nova tela"
- Dev quer implementar algo que veio de uma área de negócio
- Dev menciona "a área pediu", "o coordenador quer", "preciso criar um fluxo"

## O que o Kiro faz (AUTOMÁTICO)

### Passo 1 — Verificar pré-requisitos

Perguntar ao dev:

1. **"Quem é o interlocutor de negócio?"** (nome/área que vai validar)
2. **"Você já entendeu o requisito com o interlocutor?"**
   - Se **não** → orientar: "Antes de codificar, converse com o interlocutor
     para entender as regras de negócio. Anote os pontos principais e volte
     aqui para criarmos a spec."
   - Se **sim** → seguir para o passo 2

### Passo 2 — Coletar insumo de negócio

Perguntar:

3. **"Descreva o que a área precisa (pode colar um documento, email ou resumo)"**
4. **"Quais são as regras de negócio principais?"** (validações, exceções, permissões)
5. **"Quem pode usar essa funcionalidade?"** (perfis/roles)

### Passo 3 — Criar a spec

Com as respostas, abrir uma **Spec session** (Requirements → Design → Tasks):

- Usar as respostas do dev como input dos Requirements
- Incluir nos critérios de aceite: "Validado com [interlocutor]"
- Incluir regras de negócio como critérios testáveis
- Design técnico seguindo padrões da plataforma (steerings)

### Passo 4 — Validação

Após gerar Requirements, orientar o dev:

> "Compartilhe os requirements com [interlocutor] antes de prosseguir.
> Confirme que os critérios de aceite estão corretos.
> Quando validado, volte aqui e diga 'validado' para gerarmos o design e as tasks."

### Passo 5 — Implementação

Somente após validação:
- Gerar Design técnico
- Gerar Tasks
- Dev executa tasks pelo Kiro

## Regras

- **Nunca** implementar funcionalidade de negócio sem spec
- **Nunca** pular a validação com interlocutor
- **Nunca** gerar design/tasks sem requirements validados
- Se o dev insistir em pular etapas, lembrar: "O processo existe para evitar
  retrabalho. Funcionalidades sem spec e sem validação serão rejeitadas no PR."

## O que NÃO se aplica aqui

- Bugfixes simples → use modo Vibe ou `/troubleshooting`
- Ajustes de texto/UI pontuais → modo Vibe
- Infraestrutura técnica (tech lead cria spec direto) → Spec session normal
- Novo módulo técnico sem regra de negócio → `/criar-modulo`

## Referências

- Steerings de padrão: `.kiro/steering/`
- Design system: `docs/design-system/`
- Checklist PR: `/pr-review`
