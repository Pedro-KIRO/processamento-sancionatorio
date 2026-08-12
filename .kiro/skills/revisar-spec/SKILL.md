---
name: revisar-spec
description: Revisar a spec de um dev antes da implementação, verificando aderência aos padrões da plataforma. Ativa quando o tech lead menciona "revisar spec", "verificar spec", "spec está boa?", "validar spec do dev" ou "spec review".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: process
---

# Revisar Spec

Esta skill permite ao tech lead validar a spec de um dev antes
da implementação, garantindo que segue os padrões da plataforma.

## Quando ativa

- Tech lead quer revisar uma spec antes de autorizar implementação
- Tech lead menciona "revisar spec", "spec review", "spec está boa?"

## O que o Kiro faz (AUTOMÁTICO)

### Passo 1 — Identificar a spec

Perguntar: **"Qual spec quer revisar?"**
- Listar specs existentes em `.kiro/specs/` se houver
- Ou receber o caminho/nome direto

### Passo 2 — Analisar Requirements

Verificar:
- [ ] User stories têm papel, ação e benefício claros
- [ ] Critérios de aceite são testáveis (não ambíguos)
- [ ] Menção ao interlocutor de negócio que validou
- [ ] Roles/permissões definidas
- [ ] Não conflita com entidades canônicas existentes

### Passo 3 — Analisar Design

Verificar:
- [ ] Segue a estrutura canônica (módulo por domínio)
- [ ] Usa PrismaService (não queries diretas)
- [ ] DTOs com class-validator
- [ ] Guards de auth previstos
- [ ] Não duplica o que já existe no contrato compartilhado
- [ ] Frontend usa design system (CSS Variables, assets do template)
- [ ] Não introduz dependências proibidas (ver CONTRIBUTING)

### Passo 4 — Analisar Tasks

Verificar:
- [ ] Tasks são atômicas e executáveis
- [ ] Ordem faz sentido (dependências respeitadas)
- [ ] Build/teste previsto como task final
- [ ] Não tem task vaga tipo "implementar tudo"

### Passo 5 — Resultado

Emitir parecer:

**Se OK:**
> "Spec aprovada. O dev pode iniciar a implementação."

**Se tem problemas:**
> Listar os pontos que precisam de ajuste com sugestões específicas.
> Orientar o dev a corrigir antes de implementar.

## O que NÃO fazer

- Não validar regras de negócio (isso é responsabilidade do interlocutor)
- Não reescrever a spec do dev (sugerir, não impor)
- Não bloquear por detalhes mínimos (pragmatismo > perfeição)
