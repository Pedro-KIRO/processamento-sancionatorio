-- Migração: adicionar colunas ao modelo de cautelares
-- Contexto: Painel de medidas cautelares (Lei 10.177/1998, art. 62)
-- Data: 2026-08-05
--
-- ATENÇÃO: Executar manualmente no banco SQL Server de produção/dev.
-- O create_all só cria tabelas novas, não adiciona colunas a tabelas existentes.

-- Novas colunas na tabela cautelar
ALTER TABLE cautelar ADD prazo_dias INT NULL;
ALTER TABLE cautelar ADD fundamentacao NVARCHAR(MAX) NULL;
ALTER TABLE cautelar ADD unidade_responsavel NVARCHAR(200) NULL;
ALTER TABLE cautelar ADD numero_sei_certidao NVARCHAR(50) NULL;
ALTER TABLE cautelar ADD renovada_de_id INT NULL;
ALTER TABLE cautelar ADD criado_em DATETIME NULL;
ALTER TABLE cautelar ADD atualizado_em DATETIME NULL;

-- FK para auto-referência (renovação)
ALTER TABLE cautelar
  ADD CONSTRAINT FK_cautelar_renovada_de
  FOREIGN KEY (renovada_de_id) REFERENCES cautelar(id);

-- Índice para busca por situação
CREATE INDEX IX_cautelar_situacao ON cautelar(situacao);

-- Índice para busca por data de vencimento (painel de vencendo/vencidas)
CREATE INDEX IX_cautelar_data_fim ON cautelar(data_fim);
