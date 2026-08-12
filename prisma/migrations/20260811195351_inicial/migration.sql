-- CreateTable
CREATE TABLE "agente_regulado" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(50),
    "segmento" VARCHAR(30),
    "razao_social" VARCHAR(255),
    "cnpj_cpf" VARCHAR(20),
    "crm_crp" VARCHAR(50),
    "logradouro" VARCHAR(255),
    "numero" VARCHAR(20),
    "bairro" VARCHAR(120),
    "cidade" VARCHAR(120),

    CONSTRAINT "agente_regulado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "relatorio" (
    "id" SERIAL NOT NULL,
    "id_relatorio_origem" VARCHAR(50),
    "numero_sei" VARCHAR(50),
    "agente_id" INTEGER,
    "tipo_documento" VARCHAR(120),
    "data_recebimento" DATE,
    "conteudo_html" TEXT,

    CONSTRAINT "relatorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caixa_entrada" (
    "id" SERIAL NOT NULL,
    "id_relatorio" VARCHAR(50),
    "numero_sei" VARCHAR(50),
    "protocolo_limpo" VARCHAR(30),
    "id_procedimento" VARCHAR(30),
    "razao_social" VARCHAR(255),
    "agente_regulado" VARCHAR(120),
    "agente_origem" VARCHAR(120),
    "segmento" VARCHAR(30),
    "municipio" VARCHAR(120),
    "superintendencia" VARCHAR(120),
    "total_apontamentos" INTEGER,
    "total_itens_avaliados" INTEGER,
    "tipo_documento" VARCHAR(120),
    "cnpj_cpf" VARCHAR(20),
    "data_recebimento" DATE,
    "data_remetido" DATE,
    "data_inicio_fiscalizacao" DATE,
    "status_triagem" VARCHAR(30) DEFAULT 'pendente',
    "conteudo_html" TEXT,
    "numero_processo_sei" VARCHAR(50),
    "id_procedimento_processo" VARCHAR(30),
    "data_instauracao" DATE,
    "id_unidade_sei" VARCHAR(30),
    "verificado_em" TIMESTAMP(3),
    "responsavel_id" INTEGER,
    "prioritario" BOOLEAN NOT NULL DEFAULT false,
    "prioridade_justificativa" TEXT,
    "prioridade_definida_por" VARCHAR(255),
    "prioridade_definida_em" TIMESTAMP(3),

    CONSTRAINT "caixa_entrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processo" (
    "id" SERIAL NOT NULL,
    "numero_sei" VARCHAR(50),
    "agente_id" INTEGER,
    "segmento" VARCHAR(30),
    "data_instauracao" DATE,
    "situacao_processual" VARCHAR(120),
    "fase_atual" VARCHAR(120),
    "responsavel_id" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fase_processo" (
    "id" SERIAL NOT NULL,
    "processo_id" INTEGER NOT NULL,
    "fase" VARCHAR(120),
    "data_fase" DATE,

    CONSTRAINT "fase_processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prazo" (
    "id" SERIAL NOT NULL,
    "processo_id" INTEGER NOT NULL,
    "tipo" VARCHAR(120),
    "data_inicio" DATE,
    "data_limite" DATE,
    "situacao" VARCHAR(30),

    CONSTRAINT "prazo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cautelar" (
    "id" SERIAL NOT NULL,
    "processo_id" INTEGER,
    "caixa_entrada_id" INTEGER,
    "agente_id" INTEGER,
    "tipo" VARCHAR(120),
    "data_inicio" DATE,
    "data_fim" DATE,
    "situacao" VARCHAR(30),
    "prazo_dias" INTEGER,
    "fundamentacao" TEXT,
    "unidade_responsavel" VARCHAR(200),
    "numero_sei_certidao" VARCHAR(50),
    "renovada_de_id" INTEGER,
    "aprovacao" VARCHAR(20) DEFAULT 'pendente',
    "aprovada_por" VARCHAR(255),
    "aprovada_em" TIMESTAMP(3),
    "motivo_recusa" TEXT,
    "pendente_assinatura" BOOLEAN NOT NULL DEFAULT false,
    "link_bloco_sei" VARCHAR(500),
    "data_revogacao" DATE,
    "revogada_por" VARCHAR(255),
    "motivo_revogacao" TEXT,
    "numero_sei_certidao_desbloqueio" VARCHAR(50),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3),

    CONSTRAINT "cautelar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feriado" (
    "id" SERIAL NOT NULL,
    "data" DATE NOT NULL,
    "descricao" VARCHAR(120),
    "tipo" VARCHAR(30),

    CONSTRAINT "feriado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anotacao" (
    "id" SERIAL NOT NULL,
    "caixa_entrada_id" INTEGER NOT NULL,
    "autor" VARCHAR(255),
    "texto" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anotacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historico_despacho" (
    "id" SERIAL NOT NULL,
    "caixa_entrada_id" INTEGER NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "mensagem" TEXT,
    "numero_sei_resultado" VARCHAR(50),
    "id_procedimento_resultado" VARCHAR(30),
    "documento_formatado" VARCHAR(30),
    "avisos" TEXT,
    "autor" VARCHAR(255),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_despacho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "nome" VARCHAR(255),
    "id_unidade" VARCHAR(30),
    "perfil" VARCHAR(30),
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_unidade" (
    "id" SERIAL NOT NULL,
    "agente_regulado" VARCHAR(120) NOT NULL,
    "id_unidade" VARCHAR(30) NOT NULL,
    "descricao_unidade" VARCHAR(255),

    CONSTRAINT "config_unidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_tipo_procedimento" (
    "id" SERIAL NOT NULL,
    "agente_regulado" VARCHAR(120) NOT NULL,
    "id_tipo_procedimento" VARCHAR(30) NOT NULL,

    CONSTRAINT "config_tipo_procedimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_bloco_assinatura" (
    "id" SERIAL NOT NULL,
    "agente_regulado" VARCHAR(120) NOT NULL,
    "cargo" VARCHAR(120) NOT NULL,
    "id_bloco" VARCHAR(30) NOT NULL,

    CONSTRAINT "config_bloco_assinatura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_template_despacho" (
    "id" SERIAL NOT NULL,
    "agente_regulado" VARCHAR(120) NOT NULL,
    "descricao_doc" VARCHAR(255) NOT NULL,
    "template_html" TEXT NOT NULL,
    "nome_arvore" VARCHAR(255),
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "html_original" TEXT,
    "editado_em" TIMESTAMP(3),
    "editado_por" VARCHAR(255),

    CONSTRAINT "config_template_despacho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_email_unidade" (
    "id" SERIAL NOT NULL,
    "id_unidade" VARCHAR(30) NOT NULL,
    "agente_regulado" VARCHAR(120) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "descricao" VARCHAR(255),

    CONSTRAINT "config_email_unidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fase_processo_andamento" (
    "id" SERIAL NOT NULL,
    "caixa_entrada_id" INTEGER NOT NULL,
    "fase" VARCHAR(50) NOT NULL,
    "data_entrada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_saida" TIMESTAMP(3),
    "autor" VARCHAR(255),
    "observacao" TEXT,

    CONSTRAINT "fase_processo_andamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prazo_processo" (
    "id" SERIAL NOT NULL,
    "caixa_entrada_id" INTEGER NOT NULL,
    "fase" VARCHAR(50) NOT NULL,
    "dias" INTEGER NOT NULL,
    "data_inicio" DATE NOT NULL,
    "data_vencimento" DATE NOT NULL,
    "reiniciado" BOOLEAN NOT NULL DEFAULT false,
    "data_reinicio" DATE,
    "status" VARCHAR(30) NOT NULL DEFAULT 'em_andamento',
    "data_resposta" DATE,
    "registrado_sei" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prazo_processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" SERIAL NOT NULL,
    "usuario" VARCHAR(255),
    "momento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operacao" VARCHAR(255) NOT NULL,
    "metodo" VARCHAR(10),
    "caminho" VARCHAR(500),
    "entidade" VARCHAR(60),
    "registro_id" INTEGER,
    "documento" VARCHAR(100),
    "status_http" INTEGER,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurso_processo" (
    "id" SERIAL NOT NULL,
    "caixa_entrada_id" INTEGER NOT NULL,
    "interposto" BOOLEAN,
    "data_interposicao" DATE,
    "registrado_por" VARCHAR(255),
    "parecer_numero_sei" VARCHAR(50),
    "parecer_em" DATE,
    "parecer_por" VARCHAR(255),
    "parecer_resumo" TEXT,
    "decisao_resultado" VARCHAR(30),
    "decisao_fase_retorno" VARCHAR(50),
    "decisao_fundamentacao" TEXT,
    "decisao_em" DATE,
    "decisao_por" VARCHAR(255),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurso_processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_processo" (
    "id" SERIAL NOT NULL,
    "caixa_entrada_id" INTEGER NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "descricao" TEXT,
    "autor" VARCHAR(255),
    "dados_json" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacao" (
    "id" SERIAL NOT NULL,
    "caixa_entrada_id" INTEGER,
    "tipo" VARCHAR(50) NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "descricao" TEXT,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache_sei" (
    "id" SERIAL NOT NULL,
    "chave" VARCHAR(255) NOT NULL,
    "valor_json" TEXT NOT NULL,
    "tamanho" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cache_sei_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consulta_unificada" (
    "id" SERIAL NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "numero_sei" VARCHAR(50),
    "numero_limpo" VARCHAR(30),
    "id_procedimento" VARCHAR(30),
    "id_relatorio" VARCHAR(60),
    "razao_social" VARCHAR(255),
    "cnpj_cpf" VARCHAR(20),
    "agente_regulado" VARCHAR(120),
    "municipio" VARCHAR(120),
    "ano" VARCHAR(10),
    "situacao" VARCHAR(60),
    "fase_atual" VARCHAR(50),
    "data_criacao_sei" DATE,
    "data_ultima_acao" DATE,
    "caixa_entrada_id" INTEGER,
    "datas_sincronizadas_em" TIMESTAMP(3),
    "atualizado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consulta_unificada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advogado" (
    "id" SERIAL NOT NULL,
    "nome" VARCHAR(255) NOT NULL,
    "oab" VARCHAR(30) NOT NULL,
    "email" VARCHAR(255),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advogado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advogado_processo" (
    "id" SERIAL NOT NULL,
    "advogado_id" INTEGER NOT NULL,
    "caixa_entrada_id" INTEGER NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advogado_processo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biblioteca_texto" (
    "id" SERIAL NOT NULL,
    "classificacao" VARCHAR(40) NOT NULL,
    "titulo" VARCHAR(300) NOT NULL,
    "tema" VARCHAR(200),
    "data_referencia" DATE,
    "link" VARCHAR(1000),
    "texto" TEXT,
    "arquivo_nome" VARCHAR(255),
    "arquivo_mime" VARCHAR(120),
    "arquivo_tamanho" INTEGER,
    "arquivo_conteudo" BYTEA,
    "autor" VARCHAR(255),
    "versao_atual" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3),

    CONSTRAINT "biblioteca_texto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biblioteca_versao" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "numero" INTEGER NOT NULL,
    "autor" VARCHAR(255),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classificacao" VARCHAR(40),
    "titulo" VARCHAR(300),
    "tema" VARCHAR(200),
    "data_referencia" DATE,
    "link" VARCHAR(1000),
    "texto" TEXT,

    CONSTRAINT "biblioteca_versao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agente_regulado_cnpj_cpf_idx" ON "agente_regulado"("cnpj_cpf");

-- CreateIndex
CREATE INDEX "relatorio_id_relatorio_origem_idx" ON "relatorio"("id_relatorio_origem");

-- CreateIndex
CREATE INDEX "relatorio_numero_sei_idx" ON "relatorio"("numero_sei");

-- CreateIndex
CREATE UNIQUE INDEX "caixa_entrada_protocolo_limpo_key" ON "caixa_entrada"("protocolo_limpo");

-- CreateIndex
CREATE INDEX "caixa_entrada_id_relatorio_idx" ON "caixa_entrada"("id_relatorio");

-- CreateIndex
CREATE INDEX "caixa_entrada_numero_sei_idx" ON "caixa_entrada"("numero_sei");

-- CreateIndex
CREATE INDEX "caixa_entrada_protocolo_limpo_idx" ON "caixa_entrada"("protocolo_limpo");

-- CreateIndex
CREATE INDEX "caixa_entrada_responsavel_id_idx" ON "caixa_entrada"("responsavel_id");

-- CreateIndex
CREATE INDEX "processo_numero_sei_idx" ON "processo"("numero_sei");

-- CreateIndex
CREATE INDEX "processo_responsavel_id_idx" ON "processo"("responsavel_id");

-- CreateIndex
CREATE INDEX "cautelar_caixa_entrada_id_idx" ON "cautelar"("caixa_entrada_id");

-- CreateIndex
CREATE INDEX "feriado_data_idx" ON "feriado"("data");

-- CreateIndex
CREATE INDEX "anotacao_caixa_entrada_id_idx" ON "anotacao"("caixa_entrada_id");

-- CreateIndex
CREATE INDEX "historico_despacho_caixa_entrada_id_idx" ON "historico_despacho"("caixa_entrada_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_email_key" ON "usuario"("email");

-- CreateIndex
CREATE INDEX "config_unidade_agente_regulado_idx" ON "config_unidade"("agente_regulado");

-- CreateIndex
CREATE UNIQUE INDEX "config_tipo_procedimento_agente_regulado_key" ON "config_tipo_procedimento"("agente_regulado");

-- CreateIndex
CREATE INDEX "config_bloco_assinatura_agente_regulado_idx" ON "config_bloco_assinatura"("agente_regulado");

-- CreateIndex
CREATE INDEX "config_template_despacho_agente_regulado_idx" ON "config_template_despacho"("agente_regulado");

-- CreateIndex
CREATE UNIQUE INDEX "config_email_unidade_id_unidade_key" ON "config_email_unidade"("id_unidade");

-- CreateIndex
CREATE INDEX "config_email_unidade_agente_regulado_idx" ON "config_email_unidade"("agente_regulado");

-- CreateIndex
CREATE INDEX "fase_processo_andamento_caixa_entrada_id_idx" ON "fase_processo_andamento"("caixa_entrada_id");

-- CreateIndex
CREATE INDEX "prazo_processo_caixa_entrada_id_idx" ON "prazo_processo"("caixa_entrada_id");

-- CreateIndex
CREATE INDEX "auditoria_usuario_idx" ON "auditoria"("usuario");

-- CreateIndex
CREATE INDEX "auditoria_momento_idx" ON "auditoria"("momento");

-- CreateIndex
CREATE INDEX "auditoria_operacao_idx" ON "auditoria"("operacao");

-- CreateIndex
CREATE INDEX "auditoria_entidade_idx" ON "auditoria"("entidade");

-- CreateIndex
CREATE INDEX "recurso_processo_caixa_entrada_id_idx" ON "recurso_processo"("caixa_entrada_id");

-- CreateIndex
CREATE INDEX "evento_processo_caixa_entrada_id_idx" ON "evento_processo"("caixa_entrada_id");

-- CreateIndex
CREATE INDEX "notificacao_caixa_entrada_id_idx" ON "notificacao"("caixa_entrada_id");

-- CreateIndex
CREATE INDEX "notificacao_tipo_idx" ON "notificacao"("tipo");

-- CreateIndex
CREATE INDEX "notificacao_lida_idx" ON "notificacao"("lida");

-- CreateIndex
CREATE UNIQUE INDEX "cache_sei_chave_key" ON "cache_sei"("chave");

-- CreateIndex
CREATE INDEX "consulta_unificada_tipo_idx" ON "consulta_unificada"("tipo");

-- CreateIndex
CREATE INDEX "consulta_unificada_numero_sei_idx" ON "consulta_unificada"("numero_sei");

-- CreateIndex
CREATE INDEX "consulta_unificada_numero_limpo_idx" ON "consulta_unificada"("numero_limpo");

-- CreateIndex
CREATE INDEX "consulta_unificada_id_relatorio_idx" ON "consulta_unificada"("id_relatorio");

-- CreateIndex
CREATE INDEX "consulta_unificada_cnpj_cpf_idx" ON "consulta_unificada"("cnpj_cpf");

-- CreateIndex
CREATE INDEX "consulta_unificada_agente_regulado_idx" ON "consulta_unificada"("agente_regulado");

-- CreateIndex
CREATE INDEX "consulta_unificada_ano_idx" ON "consulta_unificada"("ano");

-- CreateIndex
CREATE INDEX "consulta_unificada_situacao_idx" ON "consulta_unificada"("situacao");

-- CreateIndex
CREATE INDEX "consulta_unificada_caixa_entrada_id_idx" ON "consulta_unificada"("caixa_entrada_id");

-- CreateIndex
CREATE UNIQUE INDEX "advogado_oab_key" ON "advogado"("oab");

-- CreateIndex
CREATE INDEX "advogado_processo_advogado_id_idx" ON "advogado_processo"("advogado_id");

-- CreateIndex
CREATE INDEX "advogado_processo_caixa_entrada_id_idx" ON "advogado_processo"("caixa_entrada_id");

-- CreateIndex
CREATE INDEX "biblioteca_texto_classificacao_idx" ON "biblioteca_texto"("classificacao");

-- CreateIndex
CREATE INDEX "biblioteca_texto_titulo_idx" ON "biblioteca_texto"("titulo");

-- CreateIndex
CREATE INDEX "biblioteca_texto_tema_idx" ON "biblioteca_texto"("tema");

-- CreateIndex
CREATE INDEX "biblioteca_texto_data_referencia_idx" ON "biblioteca_texto"("data_referencia");

-- CreateIndex
CREATE INDEX "biblioteca_versao_item_id_idx" ON "biblioteca_versao"("item_id");

-- AddForeignKey
ALTER TABLE "relatorio" ADD CONSTRAINT "relatorio_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente_regulado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caixa_entrada" ADD CONSTRAINT "caixa_entrada_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processo" ADD CONSTRAINT "processo_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente_regulado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processo" ADD CONSTRAINT "processo_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fase_processo" ADD CONSTRAINT "fase_processo_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prazo" ADD CONSTRAINT "prazo_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cautelar" ADD CONSTRAINT "cautelar_processo_id_fkey" FOREIGN KEY ("processo_id") REFERENCES "processo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cautelar" ADD CONSTRAINT "cautelar_caixa_entrada_id_fkey" FOREIGN KEY ("caixa_entrada_id") REFERENCES "caixa_entrada"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cautelar" ADD CONSTRAINT "cautelar_agente_id_fkey" FOREIGN KEY ("agente_id") REFERENCES "agente_regulado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cautelar" ADD CONSTRAINT "cautelar_renovada_de_id_fkey" FOREIGN KEY ("renovada_de_id") REFERENCES "cautelar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anotacao" ADD CONSTRAINT "anotacao_caixa_entrada_id_fkey" FOREIGN KEY ("caixa_entrada_id") REFERENCES "caixa_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_despacho" ADD CONSTRAINT "historico_despacho_caixa_entrada_id_fkey" FOREIGN KEY ("caixa_entrada_id") REFERENCES "caixa_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fase_processo_andamento" ADD CONSTRAINT "fase_processo_andamento_caixa_entrada_id_fkey" FOREIGN KEY ("caixa_entrada_id") REFERENCES "caixa_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prazo_processo" ADD CONSTRAINT "prazo_processo_caixa_entrada_id_fkey" FOREIGN KEY ("caixa_entrada_id") REFERENCES "caixa_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurso_processo" ADD CONSTRAINT "recurso_processo_caixa_entrada_id_fkey" FOREIGN KEY ("caixa_entrada_id") REFERENCES "caixa_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_processo" ADD CONSTRAINT "evento_processo_caixa_entrada_id_fkey" FOREIGN KEY ("caixa_entrada_id") REFERENCES "caixa_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_caixa_entrada_id_fkey" FOREIGN KEY ("caixa_entrada_id") REFERENCES "caixa_entrada"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consulta_unificada" ADD CONSTRAINT "consulta_unificada_caixa_entrada_id_fkey" FOREIGN KEY ("caixa_entrada_id") REFERENCES "caixa_entrada"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advogado_processo" ADD CONSTRAINT "advogado_processo_advogado_id_fkey" FOREIGN KEY ("advogado_id") REFERENCES "advogado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advogado_processo" ADD CONSTRAINT "advogado_processo_caixa_entrada_id_fkey" FOREIGN KEY ("caixa_entrada_id") REFERENCES "caixa_entrada"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biblioteca_versao" ADD CONSTRAINT "biblioteca_versao_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "biblioteca_texto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
