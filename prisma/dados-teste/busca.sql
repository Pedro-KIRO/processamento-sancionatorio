-- Dados para conferir a pesquisa global contra o PostgreSQL de verdade.
--
-- Cada linha existe por um motivo:
--   1  relatório ainda na triagem, sem processo instaurado
--   2  já instaurado: tem os DOIS números SEI, e é o caso que a classificação
--      precisa desambiguar
--   3  máscara diferente da digitada (espaço no lugar da barra)
--   4  sem data de recebimento — comprova o NULLS LAST
--   5  razão social que casa por texto, com número que não casa por dígito
BEGIN;

DELETE FROM processamento.caixa_entrada WHERE id BETWEEN 900001 AND 900005;

INSERT INTO processamento.caixa_entrada
  (id, numero_sei, numero_processo_sei, id_procedimento,
   id_procedimento_processo, razao_social, cnpj_cpf, agente_regulado,
   status_triagem, data_recebimento)
VALUES
  (900001, '140.001/2024', NULL, 'PROC-1', NULL,
   'AUTO ESCOLA ALFA LTDA', '12.345.678/0001-99', 'Autoescola',
   'pendente', '2026-08-01'),

  (900002, '140.002/2024', '999.888/2025', 'PROC-2', 'PROC-999',
   'CLINICA BETA ME', '98.765.432/0001-11', 'Clinica',
   'instaurado', '2026-08-05'),

  (900003, '140 003 2024', NULL, 'PROC-3', NULL,
   'DESPACHANTE GAMA', '111.222.333-44', 'Despachante',
   'pendente', '2026-08-03'),

  (900004, '140.004/2024', NULL, 'PROC-4', NULL,
   'ECV DELTA SA', '22.333.444/0001-55', 'ECV',
   'pendente', NULL),

  (900005, '777.777/2020', NULL, 'PROC-5', NULL,
   'AUTO ESCOLA EPSILON', '33.444.555/0001-66', 'Autoescola',
   'arquivado', '2026-07-20');

COMMIT;
