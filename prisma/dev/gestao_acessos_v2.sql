-- =============================================================================
-- gestao_acessos_v2 — schema MÍNIMO para DESENVOLVIMENTO LOCAL
-- =============================================================================
-- Este arquivo NÃO é a fonte da verdade do Gestão de Acessos. Ele existe porque
-- o PermissionsModule exige PERMISSIONS_DATABASE_URL e falha no construtor sem
-- ela (fail-closed, ver .kiro/steering/permissionamento.md). Sem um schema local
-- ninguém consegue subir a API na própria máquina.
--
-- O PostgreSQL do docker-compose executa tudo que está em
-- /docker-entrypoint-initdb.d na PRIMEIRA inicialização do volume. Para
-- reaplicar depois de mudar este arquivo:
--     docker compose down -v && docker compose up -d postgres
--
-- ATENÇÃO — RISCO CONHECIDO:
-- Os nomes de coluna abaixo foram derivados de .kiro/steering/permissionamento.md,
-- que documenta as 6 tabelas mas não a DDL completa. Eles ainda NÃO foram
-- conferidos contra o banco real de homologação. Se divergirem, as consultas de
-- apps/api/src/app/permissions/permissions-database.service.ts quebram em
-- homologação mesmo funcionando aqui. Conferir antes do primeiro deploy.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS gestao_acessos_v2;

-- Identidade -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gestao_acessos_v2.tb_usuarios (
    id     SERIAL PRIMARY KEY,
    nome   VARCHAR(255),
    email  VARCHAR(255),
    -- Object ID do usuário no Microsoft Entra ID. Imutável, por isso tem
    -- precedência sobre o e-mail na resolução da identidade.
    oid    VARCHAR(64),
    ativo  BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS ix_usuarios_email ON gestao_acessos_v2.tb_usuarios (LOWER(email));
CREATE INDEX IF NOT EXISTS ix_usuarios_oid   ON gestao_acessos_v2.tb_usuarios (oid);

-- Perfis ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gestao_acessos_v2.tb_perfis (
    id   SERIAL PRIMARY KEY,
    nome VARCHAR(120) NOT NULL
);

-- Catálogo de permissões -----------------------------------------------------
-- `identificador` segue o formato {sistema}:{recurso}:{acao}.
CREATE TABLE IF NOT EXISTS gestao_acessos_v2.tb_permissoes (
    id            SERIAL PRIMARY KEY,
    identificador VARCHAR(200) NOT NULL UNIQUE,
    sistema       VARCHAR(60),
    descricao     VARCHAR(255),
    ativa         BOOLEAN DEFAULT TRUE
);

-- Vínculo usuário <-> perfil, com vigência ----------------------------------
CREATE TABLE IF NOT EXISTS gestao_acessos_v2.tb_usuario_perfis (
    id             SERIAL PRIMARY KEY,
    usuario_id     INTEGER NOT NULL REFERENCES gestao_acessos_v2.tb_usuarios (id),
    perfil_id      INTEGER NOT NULL REFERENCES gestao_acessos_v2.tb_perfis (id),
    ativa          BOOLEAN DEFAULT TRUE,
    acesso_inicio  TIMESTAMP,
    acesso_fim     TIMESTAMP
);

-- Vínculo perfil <-> permissão ----------------------------------------------
CREATE TABLE IF NOT EXISTS gestao_acessos_v2.tb_perfil_permissoes (
    id           SERIAL PRIMARY KEY,
    perfil_id    INTEGER NOT NULL REFERENCES gestao_acessos_v2.tb_perfis (id),
    permissao_id INTEGER NOT NULL REFERENCES gestao_acessos_v2.tb_permissoes (id)
);

-- Concessões diretas (delegação), com vigência ------------------------------
CREATE TABLE IF NOT EXISTS gestao_acessos_v2.tb_concessoes (
    id            SERIAL PRIMARY KEY,
    usuario_id    INTEGER NOT NULL REFERENCES gestao_acessos_v2.tb_usuarios (id),
    permissao_id  INTEGER NOT NULL REFERENCES gestao_acessos_v2.tb_permissoes (id),
    concedida_por INTEGER REFERENCES gestao_acessos_v2.tb_usuarios (id),
    ativa         BOOLEAN DEFAULT TRUE,
    acesso_inicio TIMESTAMP,
    acesso_fim    TIMESTAMP
);

-- =============================================================================
-- Dados de desenvolvimento
-- =============================================================================
-- O usuário abaixo é o DEV_USER padrão. Como é Gestor Principal, tem bypass
-- total das permissões — é o que faz o app funcionar localmente sem cadastrar o
-- catálogo inteiro. Para testar 403 de verdade, use o segundo usuário.

INSERT INTO gestao_acessos_v2.tb_perfis (nome)
VALUES ('Gestor Principal'), ('Analista')
ON CONFLICT DO NOTHING;

-- Catálogo de permissões do sistema "processamento".
--
-- Cresce a cada domínio migrado. Em homologação e produção quem publica o
-- catálogo é o próprio Gestão de Acessos; aqui é só espelho para o dev local.
-- Mantenha em sincronia com os @RequirePermission dos controllers: permissão
-- ausente do catálogo faz o endpoint responder 403 mesmo para quem deveria ter
-- acesso (só o Gestor Principal passa, por bypass).
INSERT INTO gestao_acessos_v2.tb_permissoes (identificador, sistema, descricao, ativa)
VALUES
    ('processamento:anotacoes:listar',  'processamento', 'Listar anotações internas de um processo', TRUE),
    ('processamento:anotacoes:criar',   'processamento', 'Criar anotação interna',                   TRUE),
    ('processamento:anotacoes:excluir', 'processamento', 'Excluir anotação interna própria',         TRUE),

    ('processamento:usuarios:listar',    'processamento', 'Listar usuários e perfis do sistema', TRUE),
    ('processamento:usuarios:criar',     'processamento', 'Cadastrar usuário',                   TRUE),
    ('processamento:usuarios:editar',    'processamento', 'Editar usuário, perfil e unidade',    TRUE),
    ('processamento:usuarios:desativar', 'processamento', 'Desativar usuário',                   TRUE),

    ('processamento:advogados:listar',   'processamento', 'Listar e buscar advogados',        TRUE),
    ('processamento:advogados:criar',    'processamento', 'Cadastrar advogado',               TRUE),
    ('processamento:advogados:editar',   'processamento', 'Editar advogado',                  TRUE),
    ('processamento:advogados:excluir',  'processamento', 'Excluir advogado e seus vínculos', TRUE),
    ('processamento:advogados:vincular', 'processamento', 'Vincular advogado a processo',     TRUE),

    ('processamento:prazos:listar', 'processamento', 'Consultar o controle de prazos', TRUE),

    ('processamento:auditoria:consultar', 'processamento', 'Consultar a trilha de auditoria', TRUE),

    -- Recurso e Decisão II. A competência de cada ato (parecer é da Consultoria
    -- Jurídica, Decisão II é da Coordenação) é verificada por perfil no código:
    -- é competência legal, não configuração de acesso.
    ('processamento:recursos:consultar',              'processamento', 'Consultar o painel de recurso',            TRUE),
    ('processamento:recursos:registrar-interposicao', 'processamento', 'Registrar interposição de recurso',        TRUE),
    ('processamento:recursos:emitir-parecer',         'processamento', 'Registrar parecer da Consultoria Jurídica',TRUE),
    ('processamento:recursos:decidir',               'processamento', 'Proferir a Decisão II',                    TRUE),

    ('processamento:consulta-unificada:consultar', 'processamento', 'Consultar a tela de Consulta Unificada', TRUE),

    ('processamento:exportacao:baixar', 'processamento', 'Exportar dados para BI (JSON ou CSV)', TRUE),

    -- Cautelares. Aplicar, renovar e revogar são competência EXCLUSIVA do
    -- Coordenador Geral (art. 62, § único, da Lei 10.177/1998), verificada por
    -- perfil no código — a permissão abaixo dá acesso à tela, não a competência.
    ('processamento:cautelares:listar',           'processamento', 'Consultar o painel de cautelares',        TRUE),
    ('processamento:cautelares:aplicar',          'processamento', 'Indicar medida cautelar na instauração',  TRUE),
    ('processamento:cautelares:decidir',          'processamento', 'Concordar, recusar, renovar ou revogar',  TRUE),
    ('processamento:cautelares:juntar-certidao',  'processamento', 'Juntar certidão de bloqueio/desbloqueio', TRUE),

    -- Biblioteca. Excluir é permissão separada porque é definitivo, e no código
    -- ainda se exige ser o autor do item ou da coordenação.
    ('processamento:biblioteca:consultar', 'processamento', 'Consultar o acervo de referência',   TRUE),
    ('processamento:biblioteca:cadastrar', 'processamento', 'Cadastrar e editar itens do acervo', TRUE),
    ('processamento:biblioteca:excluir',   'processamento', 'Excluir item do acervo',             TRUE)
ON CONFLICT (identificador) DO NOTHING;

INSERT INTO gestao_acessos_v2.tb_usuarios (nome, email, oid, ativo)
VALUES
    ('Desenvolvedor Local', 'dev@detran.sp.gov.br', NULL, TRUE),
    ('Analista Sem Permissao', 'analista@detran.sp.gov.br', NULL, TRUE)
ON CONFLICT DO NOTHING;

-- dev@ = Gestor Principal, vigente e sem data de fim.
INSERT INTO gestao_acessos_v2.tb_usuario_perfis (usuario_id, perfil_id, ativa, acesso_inicio, acesso_fim)
SELECT u.id, p.id, TRUE, NOW() - INTERVAL '1 day', NULL
FROM gestao_acessos_v2.tb_usuarios u
CROSS JOIN gestao_acessos_v2.tb_perfis p
WHERE u.email = 'dev@detran.sp.gov.br'
  AND p.nome = 'Gestor Principal'
ON CONFLICT DO NOTHING;

-- analista@ = perfil Analista, sem nenhuma permissão vinculada. Serve para
-- verificar que o PermissionGuard realmente nega (403) quando deveria.
INSERT INTO gestao_acessos_v2.tb_usuario_perfis (usuario_id, perfil_id, ativa, acesso_inicio, acesso_fim)
SELECT u.id, p.id, TRUE, NOW() - INTERVAL '1 day', NULL
FROM gestao_acessos_v2.tb_usuarios u
CROSS JOIN gestao_acessos_v2.tb_perfis p
WHERE u.email = 'analista@detran.sp.gov.br'
  AND p.nome = 'Analista'
ON CONFLICT DO NOTHING;
