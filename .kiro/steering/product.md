---
inclusion: always
---

# Produto — Plataforma de Sistemas Internos da DTI / DETRAN-SP

## O que é
Padrão de plataforma para os sistemas web internos da Diretoria de TI do DETRAN-SP,
substituindo soluções construídas em Power Apps + listas do SharePoint por aplicações
próprias, governadas e manuteníveis.

## Para quem
- **Servidores** do DETRAN-SP, que usam os sistemas no dia a dia.
- **Gestores**, que aprovam, acompanham e extraem informação.
- **A própria DTI**, responsável por manter e evoluir os sistemas.

## Objetivos
- Base de código governada e manutenível, em que qualquer dev contribui com segurança.
- Padrões impostos por **tooling** (estes steering files), não por gargalo de revisão humana.
- Modelo relacional íntegro (PostgreSQL), superando os limites das listas do SharePoint
  (limites de itens, ausência de integridade relacional, dificuldade de compartilhar entre
  sistemas).
- Identidade corporativa única via Microsoft Entra ID (SSO).

## Conceitos
- A plataforma hospeda **múltiplos sistemas de domínio**, cada um em seu repositório,
  criados a partir de um repositório-template comum.
- Um sistema pode ser **designado núcleo**: a fonte da verdade de uma família de entidades
  canônicas (papel atribuível, não um sistema fixo). Os demais sistemas **consomem** essas
  entidades, sem duplicá-las.
- Pedidos de integração de outras diretorias são tratados como **extensão de fronteira**,
  nunca como fork.
