-- Dados de teste para conferir os oito alertas internos.
--
-- Fica FORA de prisma/dev/ de propósito: aquela pasta é montada em
-- /docker-entrypoint-initdb.d e roda sozinha na primeira subida do volume.
-- Estes dados sujariam o banco de quem só quer desenvolver.
--
-- Rode à mão quando for verificar os alertas:
--
--   Get-Content prisma/dados-teste/alertas.sql -Raw | docker compose exec -T postgres psql -U detran -d processamento
--
-- Cada bloco dispara exatamente um alerta, e há casos negativos propositais
-- (prazo em decurso, cautelar revogada, recurso decidido, encerramento
-- concluído) que NÃO devem alertar — servem para provar que os filtros pegam.

INSERT INTO processamento.caixa_entrada (numero_sei, razao_social, agente_regulado, status_triagem, prioritario)
VALUES
  ('0001.2026/000101-1', 'ALFA PRAZO VENCIDO',        'Autoescola',  'instaurado', false),
  ('0001.2026/000102-2', 'BETA PRAZO A VENCER',       'Autoescola',  'instaurado', false),
  ('0001.2026/000103-3', 'GAMA SEM MOVIMENTACAO',     'ECV',         'instaurado', false),
  ('0001.2026/000104-4', 'DELTA CAUTELAR VENCENDO',   'Perito',      'instaurado', false),
  ('0001.2026/000105-5', 'EPSILON CAUTELAR VENCIDA',  'Perito',      'instaurado', false),
  ('0001.2026/000106-6', 'ZETA RECURSO PENDENTE',     'Despachante', 'instaurado', false),
  ('0001.2026/000107-7', 'IOTA AGUARDA ASSINATURA',   'Autoescola',  'instaurado', false),
  ('0001.2026/000108-8', 'TETA ENCERRAMENTO ABERTO',  'ECV',         'instaurado', false);

-- 1. prazos_vencidos
INSERT INTO processamento.prazo_processo (caixa_entrada_id, fase, dias, data_inicio, data_vencimento, status, reiniciado, registrado_sei, criado_em)
SELECT id, 'aguardando_defesa', 15, CURRENT_DATE - 20, CURRENT_DATE - 5, 'em_andamento', false, false, NOW()
FROM processamento.caixa_entrada WHERE razao_social LIKE 'ALFA%';

-- 2. prazos_a_vencer (dentro da janela de 3 dias)
INSERT INTO processamento.prazo_processo (caixa_entrada_id, fase, dias, data_inicio, data_vencimento, status, reiniciado, registrado_sei, criado_em)
SELECT id, 'aguardando_alegacoes', 7, CURRENT_DATE - 5, CURRENT_DATE + 2, 'em_andamento', false, false, NOW()
FROM processamento.caixa_entrada WHERE razao_social LIKE 'BETA%';

-- CASO NEGATIVO: prazo em "decurso" não entra em nenhum alerta de prazo.
INSERT INTO processamento.prazo_processo (caixa_entrada_id, fase, dias, data_inicio, data_vencimento, status, reiniciado, registrado_sei, criado_em)
SELECT id, 'recurso', 15, CURRENT_DATE - 40, CURRENT_DATE - 20, 'decurso', false, false, NOW()
FROM processamento.caixa_entrada WHERE razao_social LIKE 'ALFA%';

-- 3. sem_movimentacao — só GAMA fica sem evento; os demais ganham evento
--    recente justamente para não caírem neste alerta.
INSERT INTO processamento.evento_processo (caixa_entrada_id, tipo, descricao, autor, criado_em)
SELECT id, 'fase_avancada', 'Evento recente', 'teste', NOW() - INTERVAL '1 day'
FROM processamento.caixa_entrada WHERE razao_social NOT LIKE 'GAMA%';

-- 4. cautelares_vencendo
INSERT INTO processamento.cautelar (caixa_entrada_id, tipo, data_inicio, data_fim, situacao, aprovacao, pendente_assinatura, criado_em)
SELECT id, 'suspensao', CURRENT_DATE - 27, CURRENT_DATE + 2, 'ativa', 'aprovada', false, NOW()
FROM processamento.caixa_entrada WHERE razao_social LIKE 'DELTA%';

-- 5. cautelares_vencidas
INSERT INTO processamento.cautelar (caixa_entrada_id, tipo, data_inicio, data_fim, situacao, aprovacao, pendente_assinatura, criado_em)
SELECT id, 'suspensao', CURRENT_DATE - 60, CURRENT_DATE - 10, 'ativa', 'aprovada', false, NOW()
FROM processamento.caixa_entrada WHERE razao_social LIKE 'EPSILON%';

-- CASO NEGATIVO: cautelar revogada e vencida não alerta — o bloqueio acabou.
INSERT INTO processamento.cautelar (caixa_entrada_id, tipo, data_inicio, data_fim, situacao, aprovacao, pendente_assinatura, criado_em)
SELECT id, 'suspensao', CURRENT_DATE - 90, CURRENT_DATE - 30, 'revogada', 'aprovada', false, NOW()
FROM processamento.caixa_entrada WHERE razao_social LIKE 'ALFA%';

-- 6. recursos_pendentes
INSERT INTO processamento.recurso_processo (caixa_entrada_id, interposto, data_interposicao, registrado_por, criado_em)
SELECT id, true, CURRENT_DATE - 10, 'teste', NOW()
FROM processamento.caixa_entrada WHERE razao_social LIKE 'ZETA%';

-- CASO NEGATIVO: recurso já decidido não alerta.
INSERT INTO processamento.recurso_processo (caixa_entrada_id, interposto, data_interposicao, decisao_resultado, decisao_em, criado_em)
SELECT id, true, CURRENT_DATE - 40, 'mantida', CURRENT_DATE - 5, NOW()
FROM processamento.caixa_entrada WHERE razao_social LIKE 'ALFA%';

-- 7. aguardando_assinatura
INSERT INTO processamento.cautelar (caixa_entrada_id, tipo, data_inicio, data_fim, situacao, aprovacao, pendente_assinatura, criado_em)
SELECT id, 'suspensao', CURRENT_DATE - 1, CURRENT_DATE + 29, 'ativa', 'aprovada', true, NOW()
FROM processamento.caixa_entrada WHERE razao_social LIKE 'IOTA%';

-- 8. encerramento_sem_conclusao (fase aberta há mais de 2 dias)
INSERT INTO processamento.fase_processo_andamento (caixa_entrada_id, fase, data_entrada, data_saida, autor)
SELECT id, 'encerramento', NOW() - INTERVAL '5 days', NULL, 'teste'
FROM processamento.caixa_entrada WHERE razao_social LIKE 'TETA%';

-- CASO NEGATIVO: encerramento já concluído (data_saida preenchida) não alerta.
INSERT INTO processamento.fase_processo_andamento (caixa_entrada_id, fase, data_entrada, data_saida, autor)
SELECT id, 'encerramento', NOW() - INTERVAL '10 days', NOW() - INTERVAL '1 day', 'teste'
FROM processamento.caixa_entrada WHERE razao_social LIKE 'ALFA%';

SELECT razao_social, id FROM processamento.caixa_entrada ORDER BY id;
