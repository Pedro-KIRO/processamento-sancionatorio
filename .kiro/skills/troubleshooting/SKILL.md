---
name: troubleshooting
description: Diagnosticar e resolver problemas comuns do ambiente de desenvolvimento — Docker não sobe, Prisma falha, login não funciona, build quebrou. Ativa quando o dev menciona "erro", "não funciona", "quebrou", "falha", "bug", "problema", "não sobe", "tela branca", "500", "conexão recusada" ou "não consigo rodar".
metadata:
  author: DTI/DETRAN-SP
  version: 1.0.0
  category: troubleshooting
---

# Troubleshooting

Esta skill é ativada quando algo não funciona e o dev precisa de ajuda para
diagnosticar e resolver.

## Abordagem

1. **Identificar a categoria do problema** (ver lista abaixo)
2. **Coletar informações** — pedir ao dev o erro exato ou executar comandos de diagnóstico
3. **Aplicar a solução** da tabela de problemas conhecidos
4. **Verificar** que o problema foi resolvido
5. Se não resolveu, **escalar** — orientar o dev a chamar o tech lead

## Categorias de problemas

| Categoria | Sinais típicos |
|---|---|
| Docker/PostgreSQL | Container não sobe, porta em uso, conexão recusada |
| Prisma | Migração falha, client desatualizado, schema inválido |
| Autenticação (Entra ID) | Login redireciona para erro, token inválido, 401 |
| Build/TypeScript | Erros de tipo, import não encontrado, build falha |
| Frontend (React/Vite) | Tela branca, HMR não atualiza, erro no console |
| Backend (NestJS) | 500 interno, endpoint não encontrado, guard bloqueia |
| Git/SSH | Push rejeitado, permissão negada, branch divergente |
| Dependências | npm install falha, pacote não encontrado, versão incompatível |

## O que o Kiro deve fazer

1. Perguntar (se não estiver claro): "Qual é o erro exato que aparece?"
   **Nota:** se o erro já é visível no contexto (output do terminal, diagnóstico,
   ou mensagem do dev), NÃO perguntar — diagnosticar e resolver diretamente.
2. Consultar a tabela de soluções em `references/problemas-comuns.md`
3. Executar comandos de diagnóstico quando possível
4. Aplicar a correção
5. Confirmar que resolveu

## O que NÃO fazer

- Não sugerir reinstalar tudo sem antes diagnosticar
- Não ignorar o erro e seguir em frente
- Não alterar configurações de produção para resolver problema local
- Não desabilitar segurança (guards, validação) como "workaround"

## Referências

- Problemas comuns e soluções: [references/problemas-comuns.md](references/problemas-comuns.md)
