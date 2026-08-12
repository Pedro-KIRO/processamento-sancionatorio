-- Dados de teste da Consulta Unificada.
--
-- Rodar à mão (não é seed automático):
--   Get-Content prisma/dados-teste/consulta-unificada.sql -Raw | docker compose exec -T postgres psql -U detran -d processamento
--
-- Os casos foram escolhidos para provar as partes que o query builder do Prisma
-- não expressa e por isso foram escritas em SQL:
--
--   * razão social em caixa MISTA, para conferir que a ordem usa LOWER() e não
--     a collation (que colocaria "Zeta" antes de "alfa");
--   * CPF e CNPJ juntos, com máscaras de tamanhos diferentes, para conferir a
--     ordenação sem pontuação;
--   * linhas SEM data, para conferir que ficam no fim nas duas direções;
--   * linha com e sem vínculo à caixa de entrada, para conferir o campo `fonte`.

DELETE FROM processamento.consulta_unificada;

INSERT INTO processamento.consulta_unificada
  (tipo, numero_sei, numero_limpo, id_procedimento, id_relatorio, razao_social,
   cnpj_cpf, agente_regulado, municipio, ano, situacao, fase_atual,
   data_criacao_sei, data_ultima_acao, caixa_entrada_id, atualizado_em)
VALUES
  -- Caixa mista de propósito: "alfa" minúsculo tem de vir antes de "Beta".
  ('processo',  '140.00000001/2026-11', '14000000001202611', '9001', 'REL-1',
   'alfa autoescola',        '12.345.678/0001-90', 'Autoescola', 'Campinas',  '2026',
   'Em andamento', 'aguardando_defesa', DATE '2026-03-10', DATE '2026-08-01', 1, NOW()),

  ('processo',  '140.00000002/2026-22', '14000000002202622', '9002', 'REL-2',
   'Beta Clinica',           '987.654.321-00',     'Perito',     'Santos',    '2026',
   'Em andamento', 'instauracao',       DATE '2026-05-20', DATE '2026-08-05', 2, NOW()),

  ('relatorio', '140.00000003/2026-33', '14000000003202633', '9003', 'REL-3',
   'GAMA ECV',               '11.222.333/0001-44', 'ECV',        'Sorocaba',  '2026',
   'Concluído',    NULL,                DATE '2026-01-15', DATE '2026-02-01', NULL, NOW()),

  -- Sem data nenhuma: tem de ficar no FIM tanto em asc quanto em desc.
  ('relatorio', '140.00000004/2026-44', '14000000004202644', '9004', 'REL-4',
   'delta despachante',      '55.666.777/0001-88', 'Despachante','Bauru',     '2026',
   'Avaliado',     NULL,                NULL,             NULL,             NULL, NOW()),

  -- Fase fora da lista oficial: tem de aparecer no fim do filtro de fases,
  -- não desaparecer.
  ('processo',  '140.00000005/2025-55', '14000000005202555', '9005', 'REL-5',
   'Epsilon Estampadora',    '99.888.777/0001-66', 'Estampadora','Osasco',    '2025',
   'Em andamento', 'fase_legada',       DATE '2025-11-30', DATE '2026-07-10', NULL, NOW());

SELECT razao_social, cnpj_cpf, data_criacao_sei, fase_atual, caixa_entrada_id
FROM processamento.consulta_unificada ORDER BY id;
