-- Dados de teste da exportação para BI.
--
-- Rodar à mão:
--   Get-Content prisma/dados-teste/exportacao.sql -Raw | docker compose exec -T postgres psql -U detran -d processamento
--
-- A razão social tem vírgula E aspas de propósito: é o caso que quebra CSV mal
-- escapado. Sem escape, a vírgula partiria a linha em duas colunas e o BI leria
-- o CNPJ na coluna do nome, sem erro nenhum — número que não bate semanas
-- depois.

UPDATE processamento.caixa_entrada SET
  razao_social     = 'EMPRESA X, LTDA "ME"',
  status_triagem   = 'instaurado',
  segmento         = 'Condutores',
  tipo_documento   = 'Relatorio de Fiscalizacao',
  data_recebimento = CURRENT_DATE - 30,
  data_instauracao = CURRENT_DATE - 20,
  id_unidade_sei   = '110053117',
  cnpj_cpf         = '12.345.678/0001-90'
WHERE id = 1;

-- Um item ainda em triagem, que NÃO deve aparecer na exportação de processos.
UPDATE processamento.caixa_entrada SET
  status_triagem = 'pendente'
WHERE id = 3;

SELECT id, razao_social, status_triagem FROM processamento.caixa_entrada ORDER BY id LIMIT 4;
