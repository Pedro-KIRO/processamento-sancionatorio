# Automações do Processamento Sancionatório

Scripts de automação que rodam periodicamente (via Agendador de Tarefas do Windows)
para manter os dados sincronizados entre a API do SEI e o banco de dados do sistema.

## Origem

Portados de `codigod/` (Desktop), que são os scripts usados em produção hoje
com Power Apps + SharePoint. Aqui estão adaptados para usar o banco próprio
(futuro) e o `.env` já consolidado do projeto.

## Scripts

### `caixa_entrada_prod.py`
Varredura completa da caixa de entrada do SEI:
1. Lista processos de todas as unidades-alvo
2. Filtra apenas os remetidos pelas unidades SFR (fiscalização)
3. Busca histórico de andamentos para extrair datas de remessa/recebimento
4. Consulta o SharePoint (listaDesignação) para enriquecer com dados do relatório
5. Grava na Caixa de Entrada (SharePoint → futuro: banco próprio)

### `atualizar_assinaturas/`
Atualiza `listaProcEmAndamento` e `listaFasesPA` no SharePoint consultando a API SEI:
- Para cada processo, consulta andamentos e calcula: data situação, fase PA, data instauração
- Atualiza os campos no SharePoint se houve mudança

## Configuração

Todos os scripts usam variáveis de ambiente via `.env` (nunca hardcoded).
Ver `backend/.env.example` para o modelo completo.

## Como rodar

```bash
# A partir de backend/
python -m automacoes.caixa_entrada_prod
python -m automacoes.atualizar_assinaturas.main --dry-run
```
