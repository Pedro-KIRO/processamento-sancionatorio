"""Modelo de dados (PRELIMINAR) do sistema de processamento.

ATENÇÃO: os campos abaixo são uma primeira versão, derivada das 17 listas do
SharePoint e do código existente. Serão refinados após a validação da área de
negócio (ver docs/negocio). A ideia é ter uma base relacional limpa em SQL
Server (em desenvolvimento local usamos SQLite via SQLAlchemy).
"""
from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _agora() -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/Sao_Paulo"))


class AgenteRegulado(Base):
    __tablename__ = "agente_regulado"

    id: Mapped[int] = mapped_column(primary_key=True)
    tipo: Mapped[str | None] = mapped_column(String(50))       # Autoescola, Peritos, ECV, EPIV...
    segmento: Mapped[str | None] = mapped_column(String(30))   # Condutores, Veiculos, Educacao
    razao_social: Mapped[str | None] = mapped_column(String(255))
    cnpj_cpf: Mapped[str | None] = mapped_column(String(20), index=True)
    crm_crp: Mapped[str | None] = mapped_column(String(50))
    logradouro: Mapped[str | None] = mapped_column(String(255))
    numero: Mapped[str | None] = mapped_column(String(20))
    bairro: Mapped[str | None] = mapped_column(String(120))
    cidade: Mapped[str | None] = mapped_column(String(120))

    processos: Mapped[list["Processo"]] = relationship(back_populates="agente")


class Relatorio(Base):
    __tablename__ = "relatorio"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_relatorio_origem: Mapped[str | None] = mapped_column(String(50), index=True)
    numero_sei: Mapped[str | None] = mapped_column(String(50), index=True)
    agente_id: Mapped[int | None] = mapped_column(ForeignKey("agente_regulado.id"))
    tipo_documento: Mapped[str | None] = mapped_column(String(120))
    data_recebimento: Mapped[date | None] = mapped_column(Date)
    conteudo_html: Mapped[str | None] = mapped_column(Text)


class CaixaEntrada(Base):
    __tablename__ = "caixa_entrada"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_relatorio: Mapped[str | None] = mapped_column(String(50), index=True)
    numero_sei: Mapped[str | None] = mapped_column(String(50), index=True)
    protocolo_limpo: Mapped[str | None] = mapped_column(String(30), unique=True, index=True)
    id_procedimento: Mapped[str | None] = mapped_column(String(30))
    razao_social: Mapped[str | None] = mapped_column(String(255))
    # Classe consolidada do agente (Autoescola, Perito, Desmonte, Despachante,
    # ECV, Estampadora) — ver app/services/agentes_regulados.py.
    agente_regulado: Mapped[str | None] = mapped_column(String(120))
    # Nome como veio da listaDesignacao ("Médicos", "Clínica de Medicina do
    # Tráfego"...). Guardado porque a classe consolidada não basta para
    # instaurar: o SEI tem tipos de procedimento distintos para Clínica, Médico
    # e Psicólogo, e nenhum tipo único de "Perito".
    agente_origem: Mapped[str | None] = mapped_column(String(120))
    segmento: Mapped[str | None] = mapped_column(String(30))
    # Localização do agente regulado, resolvida a partir de listaDesignacao.cidade
    # via listaMunicipios (ver app/services/localizacao_agente.py). Guardamos as
    # versões acentuadas, prontas para exibir.
    municipio: Mapped[str | None] = mapped_column(String(120))
    superintendencia: Mapped[str | None] = mapped_column(String(120))
    # Apontamentos do checklist de fiscalização (não conformidades), apurados a
    # partir de lista_perguntas + lista_resposta — ver
    # app/services/conformidade_relatorio.py. Persistidos para a tela abrir
    # rápido, sem depender do SharePoint a cada acesso.
    total_apontamentos: Mapped[int | None] = mapped_column()
    total_itens_avaliados: Mapped[int | None] = mapped_column()
    tipo_documento: Mapped[str | None] = mapped_column(String(120))
    cnpj_cpf: Mapped[str | None] = mapped_column(String(20))
    data_recebimento: Mapped[date | None] = mapped_column(Date)
    data_remetido: Mapped[date | None] = mapped_column(Date)
    data_inicio_fiscalizacao: Mapped[date | None] = mapped_column(Date)
    status_triagem: Mapped[str | None] = mapped_column(String(30), default="pendente")
    # HTML completo do relatório de fiscalização — costuma passar de 1 MB por
    # item. Carregado sob demanda (deferred): sem isso, uma listagem de algumas
    # centenas de itens arrastava centenas de MB do banco para a memória, mesmo
    # que o campo não vá na resposta da API. Era a causa da Caixa de Entrada
    # demorar a carregar. Quem precisa do conteúdo (GET /{id}/relatorio) acessa
    # o atributo normalmente e o SQLAlchemy busca só aquela linha.
    conteudo_html: Mapped[str | None] = mapped_column(Text, deferred=True)

    # Preenchidos quando o item sai da Caixa de Entrada por Arquivar/TAC/Instaurar.
    # No caso de Instaurar, referem-se ao NOVO processo criado no SEI (não ao
    # processo de fiscalização original). Em Arquivar/TAC, o processo é o mesmo
    # (numero_sei), então esses campos ficam vazios e a tela de "Processos em
    # Andamento" usa numero_sei/id_procedimento originais nesses casos.
    numero_processo_sei: Mapped[str | None] = mapped_column(String(50))
    id_procedimento_processo: Mapped[str | None] = mapped_column(String(30))
    data_instauracao: Mapped[date | None] = mapped_column(Date)

    # Unidade SEI que recebeu o processo (gravada pela varredura). Usada para
    # consultar documentos sem tentativa e erro entre as 6 unidades — o SEI só
    # permite acesso aos docs pela unidade que tem o processo aberto.
    id_unidade_sei: Mapped[str | None] = mapped_column(String(30))

    # Última vez que a automação de limpeza checou se o item ainda atende o
    # filtro da caixa de entrada. Permite rodar a limpeza em rotação (os mais
    # antigos primeiro) em vez de reverificar tudo a cada ciclo.
    verificado_em: Mapped[datetime | None] = mapped_column(DateTime)

    # Analista responsável pelo processo (atribuído na instauração, editável
    # pelo coordenador ou chefe de divisão).
    responsavel_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))

    # Priorização (★) da Coordenação: sobe o processo no ordenamento das filas e
    # dá destaque visual em todas as telas, sem alterar prazo legal nenhum.
    prioritario: Mapped[bool] = mapped_column(Boolean, default=False)
    prioridade_justificativa: Mapped[str | None] = mapped_column(Text)
    prioridade_definida_por: Mapped[str | None] = mapped_column(String(255))
    prioridade_definida_em: Mapped[datetime | None] = mapped_column(DateTime)

    responsavel: Mapped["Usuario | None"] = relationship(foreign_keys=[responsavel_id])
    anotacoes: Mapped[list["Anotacao"]] = relationship(
        back_populates="caixa_entrada", cascade="all, delete-orphan"
    )


class Processo(Base):
    __tablename__ = "processo"

    id: Mapped[int] = mapped_column(primary_key=True)
    numero_sei: Mapped[str | None] = mapped_column(String(50), index=True)
    agente_id: Mapped[int | None] = mapped_column(ForeignKey("agente_regulado.id"))
    segmento: Mapped[str | None] = mapped_column(String(30))
    data_instauracao: Mapped[date | None] = mapped_column(Date)
    situacao_processual: Mapped[str | None] = mapped_column(String(120))
    fase_atual: Mapped[str | None] = mapped_column(String(120))
    responsavel_id: Mapped[int | None] = mapped_column(ForeignKey("usuario.id"))
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)

    agente: Mapped["AgenteRegulado | None"] = relationship(back_populates="processos")
    responsavel: Mapped["Usuario | None"] = relationship(foreign_keys=[responsavel_id])
    fases: Mapped[list["FaseProcesso"]] = relationship(
        back_populates="processo", cascade="all, delete-orphan")
    prazos: Mapped[list["Prazo"]] = relationship(
        back_populates="processo", cascade="all, delete-orphan")
    cautelares: Mapped[list["Cautelar"]] = relationship(
        back_populates="processo", cascade="all, delete-orphan")


class FaseProcesso(Base):
    __tablename__ = "fase_processo"

    id: Mapped[int] = mapped_column(primary_key=True)
    processo_id: Mapped[int] = mapped_column(ForeignKey("processo.id"))
    fase: Mapped[str | None] = mapped_column(String(120))
    data_fase: Mapped[date | None] = mapped_column(Date)

    processo: Mapped["Processo"] = relationship(back_populates="fases")


class Prazo(Base):
    __tablename__ = "prazo"

    id: Mapped[int] = mapped_column(primary_key=True)
    processo_id: Mapped[int] = mapped_column(ForeignKey("processo.id"))
    tipo: Mapped[str | None] = mapped_column(String(120))
    data_inicio: Mapped[date | None] = mapped_column(Date)
    data_limite: Mapped[date | None] = mapped_column(Date)
    situacao: Mapped[str | None] = mapped_column(String(30))

    processo: Mapped["Processo"] = relationship(back_populates="prazos")


class Cautelar(Base):
    """Medida cautelar aplicada ao agente regulado.

    Competência exclusiva do Coordenador Geral (art. 62, § único, da Lei
    10.177/1998). O ciclo de vida está descrito na Documentação de Negócio
    v3.0: instauração com cautelar → fila do Coordenador Geral → concordância
    (assinatura) ou recusa (volta à caixa de entrada) → certidão de bloqueio →
    acompanhamento do prazo → renovação ou revogação (com certidão de
    desbloqueio).
    """
    __tablename__ = "cautelar"

    id: Mapped[int] = mapped_column(primary_key=True)
    processo_id: Mapped[int | None] = mapped_column(ForeignKey("processo.id"))
    # Vínculo com o item da caixa de entrada, que é onde o fluxo real do app
    # vive (a tabela `processo` não é populada pela instauração). Sem isto a
    # tela de cautelares não conseguia cruzar com defesa juntada nem abrir o
    # processo no app.
    caixa_entrada_id: Mapped[int | None] = mapped_column(ForeignKey("caixa_entrada.id"), index=True)
    agente_id: Mapped[int | None] = mapped_column(ForeignKey("agente_regulado.id"))
    tipo: Mapped[str | None] = mapped_column(String(120))
    data_inicio: Mapped[date | None] = mapped_column(Date)
    data_fim: Mapped[date | None] = mapped_column(Date)
    situacao: Mapped[str | None] = mapped_column(String(30))
    # Campos adicionais para o painel de cautelares
    prazo_dias: Mapped[int | None] = mapped_column(Integer)
    fundamentacao: Mapped[str | None] = mapped_column(Text)
    unidade_responsavel: Mapped[str | None] = mapped_column(String(200))
    numero_sei_certidao: Mapped[str | None] = mapped_column(String(50))
    renovada_de_id: Mapped[int | None] = mapped_column(ForeignKey("cautelar.id"))

    # --- Concordância do Coordenador Geral ---
    #: pendente | aprovada | recusada
    aprovacao: Mapped[str | None] = mapped_column(String(20), default="pendente")
    aprovada_por: Mapped[str | None] = mapped_column(String(255))
    aprovada_em: Mapped[datetime | None] = mapped_column(DateTime)
    motivo_recusa: Mapped[str | None] = mapped_column(Text)
    #: Certidão de bloqueio criada e aguardando assinatura no SEI.
    pendente_assinatura: Mapped[bool] = mapped_column(Boolean, default=False)
    #: Link do bloco de assinatura no SEI, para a ação "assinar" da tela.
    link_bloco_sei: Mapped[str | None] = mapped_column(String(500))

    # --- Revogação ---
    data_revogacao: Mapped[date | None] = mapped_column(Date)
    revogada_por: Mapped[str | None] = mapped_column(String(255))
    motivo_revogacao: Mapped[str | None] = mapped_column(Text)
    numero_sei_certidao_desbloqueio: Mapped[str | None] = mapped_column(String(50))

    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)
    atualizado_em: Mapped[datetime | None] = mapped_column(DateTime, onupdate=_agora)

    processo: Mapped["Processo | None"] = relationship(back_populates="cautelares")
    caixa_entrada: Mapped["CaixaEntrada | None"] = relationship(foreign_keys=[caixa_entrada_id])
    agente: Mapped["AgenteRegulado | None"] = relationship()


class Feriado(Base):
    __tablename__ = "feriado"

    id: Mapped[int] = mapped_column(primary_key=True)
    data: Mapped[date] = mapped_column(Date, index=True)
    descricao: Mapped[str | None] = mapped_column(String(120))
    tipo: Mapped[str | None] = mapped_column(String(30))   # nacional / estadual / municipal


class Anotacao(Base):
    __tablename__ = "anotacao"

    id: Mapped[int] = mapped_column(primary_key=True)
    caixa_entrada_id: Mapped[int] = mapped_column(ForeignKey("caixa_entrada.id"), index=True)
    autor: Mapped[str | None] = mapped_column(String(255))
    texto: Mapped[str] = mapped_column(Text)
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)

    caixa_entrada: Mapped["CaixaEntrada"] = relationship(back_populates="anotacoes")


class HistoricoDespacho(Base):
    """Registro de cada tentativa de despacho SEI (Arquivar/TAC/Instaurar).

    Guardamos toda tentativa (sucesso ou erro) para dar rastreabilidade ao
    usuário quando a API do SEI falha: ele pode ver se algo já foi criado
    antes de tentar de novo, evitando duplicidade de processos/documentos.
    """
    __tablename__ = "historico_despacho"

    id: Mapped[int] = mapped_column(primary_key=True)
    caixa_entrada_id: Mapped[int] = mapped_column(ForeignKey("caixa_entrada.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(20))  # arquivar / tac / instaurar
    status: Mapped[str] = mapped_column(String(20))  # sucesso / erro_temporario / erro_definitivo
    mensagem: Mapped[str | None] = mapped_column(Text)
    numero_sei_resultado: Mapped[str | None] = mapped_column(String(50))
    id_procedimento_resultado: Mapped[str | None] = mapped_column(String(30))
    documento_formatado: Mapped[str | None] = mapped_column(String(30))
    avisos: Mapped[str | None] = mapped_column(Text)  # avisos concatenados (separados por "\n")
    autor: Mapped[str | None] = mapped_column(String(255))
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)


class Usuario(Base):
    __tablename__ = "usuario"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    nome: Mapped[str | None] = mapped_column(String(255))
    id_unidade: Mapped[str | None] = mapped_column(String(30))
    perfil: Mapped[str | None] = mapped_column(String(30))  # analista / coordenador...
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)


# ==============================================================================
# Tabelas de referência (migradas das listas do SharePoint)
# Dados raramente mudam; populados por script de seed/migração.
# ==============================================================================


class ConfigUnidade(Base):
    """Mapeamento agenteRegulado → idUnidade no SEI.

    Origem: listaUsuarios do SharePoint (site CPSAR).
    Uso: ao consultar documentos de um processo, saber qual unidade SEI tem
    acesso sem tentativa e erro entre as 6 unidades possíveis.
    """
    __tablename__ = "config_unidade"

    id: Mapped[int] = mapped_column(primary_key=True)
    agente_regulado: Mapped[str] = mapped_column(String(120), index=True)
    id_unidade: Mapped[str] = mapped_column(String(30))
    descricao_unidade: Mapped[str | None] = mapped_column(String(255))


class ConfigTipoProcedimento(Base):
    """Mapeamento agenteRegulado → idTipoProcedimento no SEI.

    Origem: listaCódigosAPI do SharePoint (site CPSAR).
    Uso: na Instauração, para criar o processo SEI com o tipo correto.
    """
    __tablename__ = "config_tipo_procedimento"

    id: Mapped[int] = mapped_column(primary_key=True)
    agente_regulado: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    id_tipo_procedimento: Mapped[str] = mapped_column(String(30))


class ConfigBlocoAssinatura(Base):
    """Mapeamento (agenteRegulado, cargo) → idBloco no SEI.

    Origem: listaBlocosAssinatura do SharePoint (site CPSAR).
    Uso: após gerar o documento de despacho, inclui-lo no bloco de assinatura
    correto para que o responsável assine.
    """
    __tablename__ = "config_bloco_assinatura"

    id: Mapped[int] = mapped_column(primary_key=True)
    agente_regulado: Mapped[str] = mapped_column(String(120), index=True)
    cargo: Mapped[str] = mapped_column(String(120))
    id_bloco: Mapped[str] = mapped_column(String(30))


class ConfigTemplateDespacho(Base):
    """Modelos de documento por (agenteRegulado, descricaoDOC).

    Origem atual: os textos-padrão oficiais do SEI, importados por
    ``scripts/importar_textos_padroes.py``. ``descricao_doc`` é
    ``<função>|<rótulo>``: a função é o papel do documento no fluxo e o rótulo
    diferencia as variantes (ver ``app/services/classificacao_modelos.py``).
    Uso: ao gerar um documento de Arquivar/TAC/Instaurar ou de uma fase, puxa o
    modelo correspondente e preenche as variáveis.

    O coordenador edita esses textos na tela "Textos-padrão". Por isso a linha
    guarda três coisas além do texto em uso:

    - ``padrao``: a variante escolhida como padrão do app para aquela função e
      agente. Há mais de uma variante por função (quatro saneadores de
      autoescola, nove arquivamentos de relatório de perito), e é essa marca que
      diz qual vem selecionada.
    - ``html_original``: o texto como veio do SEI. Permite desfazer a edição e é
      o que a reimportação atualiza.
    - ``editado_em`` / ``editado_por``: registram a edição no app. Enquanto
      estiverem preenchidos, a reimportação **não** sobrescreve
      ``template_html`` — senão a próxima coleta apagaria o ajuste do
      coordenador sem aviso.
    """
    __tablename__ = "config_template_despacho"

    id: Mapped[int] = mapped_column(primary_key=True)
    agente_regulado: Mapped[str] = mapped_column(String(120), index=True)
    descricao_doc: Mapped[str] = mapped_column(String(255))
    template_html: Mapped[str] = mapped_column(Text)
    nome_arvore: Mapped[str | None] = mapped_column(String(255))
    padrao: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    html_original: Mapped[str | None] = mapped_column(Text)
    editado_em: Mapped[datetime | None] = mapped_column(DateTime)
    editado_por: Mapped[str | None] = mapped_column(String(255))


class ConfigEmailUnidade(Base):
    """Mapeamento idUnidade → email da unidade para acesso externo no SEI.

    Uso: ao disponibilizar acesso externo, o SEI exige o email da unidade
    que está concedendo o acesso. Este email é enviado ao interessado na
    notificação de disponibilização.
    """
    __tablename__ = "config_email_unidade"

    id: Mapped[int] = mapped_column(primary_key=True)
    id_unidade: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    agente_regulado: Mapped[str] = mapped_column(String(120), index=True)
    email: Mapped[str] = mapped_column(String(255))
    descricao: Mapped[str | None] = mapped_column(String(255))


# ==============================================================================
# Fase de vida do processo administrativo sancionatório
# ==============================================================================

# Fases em ordem sequencial obrigatória (não pode pular):
FASES_PROCESSO = [
    "instauracao",          # 1. Instauração (Termo + Citação + Cautelar)
    "aguardando_defesa",    # 2. Aguardando Defesa Prévia (prazo 15 dias)
    "defesa_apresentada",   # 3. Análise de Defesa (saneador)
    "instrucao",            # 4. Aguardando Alegações (intimação + prazo 7 dias)
    "aguardando_alegacoes", # 5. Elaborar Decisão I (julgamento)
    "julgamento",           # 6. Aguardando Recurso (notificação + prazo 15 dias)
    "recurso",              # 7. Decisão II
    "encerramento",         # 8. Encerramento
    "encerrado",            # Processo finalizado
]


class FaseProcessoAndamento(Base):
    """Rastreia a fase atual e o histórico de fases de um processo instaurado.

    Cada registro representa a ENTRADA em uma fase. A fase atual do processo
    é a mais recente (ordenada por data_entrada DESC). Não é permitido criar
    uma fase que não seja a próxima na sequência (controlado pelo backend).
    """
    __tablename__ = "fase_processo_andamento"

    id: Mapped[int] = mapped_column(primary_key=True)
    caixa_entrada_id: Mapped[int] = mapped_column(ForeignKey("caixa_entrada.id"), index=True)
    fase: Mapped[str] = mapped_column(String(50))  # valor de FASES_PROCESSO
    data_entrada: Mapped[datetime] = mapped_column(DateTime, default=_agora)
    data_saida: Mapped[datetime | None] = mapped_column(DateTime)
    # Quem realizou a ação que avançou para esta fase
    autor: Mapped[str | None] = mapped_column(String(255))
    observacao: Mapped[str | None] = mapped_column(Text)


class PrazoProcesso(Base):
    """Controle de prazos do processo (15 dias para defesa, 7 dias para alegações, etc.).

    Cada prazo é vinculado a uma fase e pode ser reiniciado uma vez, quando o
    interessado visualiza o acesso externo — ``reiniciado``/``data_reinicio``
    são o registro dessa visualização, e ``data_inicio`` é a data em que o
    acesso foi disponibilizado (não a do clique no app).

    Vencido sem resposta, o desfecho depende da visualização: sem ela cabe
    edital de citação (a fase não avança); com ela, certidão de decurso. A
    regra está em ``app/services/acesso_externo.py``.
    """
    __tablename__ = "prazo_processo"

    id: Mapped[int] = mapped_column(primary_key=True)
    caixa_entrada_id: Mapped[int] = mapped_column(ForeignKey("caixa_entrada.id"), index=True)
    fase: Mapped[str] = mapped_column(String(50))  # fase à qual o prazo pertence
    dias: Mapped[int] = mapped_column()  # quantidade de dias (15 ou 7)
    data_inicio: Mapped[date] = mapped_column(Date)  # quando começou a contar
    data_vencimento: Mapped[date] = mapped_column(Date)  # quando vence
    # Controle de reinício (visualização pelo interessado)
    reiniciado: Mapped[bool] = mapped_column(Boolean, default=False)
    data_reinicio: Mapped[date | None] = mapped_column(Date)
    # Status do prazo
    status: Mapped[str] = mapped_column(String(30), default="em_andamento")
    # em_andamento | respondido | decurso | cancelado
    data_resposta: Mapped[date | None] = mapped_column(Date)  # quando o interessado respondeu
    # Se o SEI registrou o prazo (via POST /processos/{numero}/prazo)
    registrado_sei: Mapped[bool] = mapped_column(Boolean, default=False)
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)


class Auditoria(Base):
    """Trilha de auditoria de todas as ações dos usuários.

    Exigência da Documentação de Negócio v3.0: registrar usuário, data, horário,
    operação realizada e documento afetado.

    É alimentada por middleware (``app/main.py``) em toda requisição que altera
    dados — POST, PUT, PATCH e DELETE. Fazer no middleware, e não endpoint a
    endpoint, é o que garante que nenhuma ação nova escape da trilha por
    esquecimento de quem escreveu a rota.
    """
    __tablename__ = "auditoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario: Mapped[str | None] = mapped_column(String(255), index=True)
    #: Data e hora da ação, no fuso de São Paulo (ver `_agora`).
    momento: Mapped[datetime] = mapped_column(DateTime, default=_agora, index=True)
    #: Verbo HTTP + caminho, ex.: "POST /cautelares/12/revogar".
    operacao: Mapped[str] = mapped_column(String(255), index=True)
    metodo: Mapped[str | None] = mapped_column(String(10))
    caminho: Mapped[str | None] = mapped_column(String(500))
    #: Primeiro segmento do caminho, para filtrar por área ("cautelares").
    entidade: Mapped[str | None] = mapped_column(String(60), index=True)
    #: Id numérico presente no caminho, quando houver.
    registro_id: Mapped[int | None] = mapped_column()
    #: Documento do SEI afetado, quando a operação identifica um.
    documento: Mapped[str | None] = mapped_column(String(100))
    status_http: Mapped[int | None] = mapped_column()


class RecursoProcesso(Base):
    """Painel de recurso do processo (Documentação de Negócio v3.0).

    Depois da Decisão I registra-se se houve interposição (Sim/Não) e conduz-se
    o trâmite: interposição → encaminhamento à Consultoria Jurídica → parecer →
    Decisão II pela autoridade competente.

    É tabela própria, e não colunas em ``CaixaEntrada``, porque a Decisão II
    pode determinar o **retorno do processo a uma fase específica** — o processo
    reentra no fluxo e pode chegar a um novo recurso, com histórico separado.
    """
    __tablename__ = "recurso_processo"

    id: Mapped[int] = mapped_column(primary_key=True)
    caixa_entrada_id: Mapped[int] = mapped_column(ForeignKey("caixa_entrada.id"), index=True)

    #: None = ainda não respondido; False = não houve recurso (trânsito).
    interposto: Mapped[bool | None] = mapped_column(Boolean)
    data_interposicao: Mapped[date | None] = mapped_column(Date)
    registrado_por: Mapped[str | None] = mapped_column(String(255))

    # --- Consultoria Jurídica ---
    parecer_numero_sei: Mapped[str | None] = mapped_column(String(50))
    parecer_em: Mapped[date | None] = mapped_column(Date)
    parecer_por: Mapped[str | None] = mapped_column(String(255))
    parecer_resumo: Mapped[str | None] = mapped_column(Text)

    # --- Decisão II ---
    #: mantida | reformada | retorno_fase
    decisao_resultado: Mapped[str | None] = mapped_column(String(30))
    #: Fase para onde o processo volta quando o resultado é ``retorno_fase``.
    decisao_fase_retorno: Mapped[str | None] = mapped_column(String(50))
    decisao_fundamentacao: Mapped[str | None] = mapped_column(Text)
    decisao_em: Mapped[date | None] = mapped_column(Date)
    decisao_por: Mapped[str | None] = mapped_column(String(255))

    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)

    caixa_entrada: Mapped["CaixaEntrada"] = relationship(foreign_keys=[caixa_entrada_id])


class EventoProcesso(Base):
    """Registro de cada evento/ação relevante do processo para rastreabilidade e BI.

    Grava quem fez o quê e quando — usado para auditoria, timeline visual,
    e futura exportação para Power BI.
    """
    __tablename__ = "evento_processo"

    id: Mapped[int] = mapped_column(primary_key=True)
    caixa_entrada_id: Mapped[int] = mapped_column(ForeignKey("caixa_entrada.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(50))
    # Tipos: fase_avancada, prazo_definido, prazo_reiniciado, prazo_vencido,
    #        documento_gerado, acesso_disponibilizado, defesa_juntada,
    #        certidao_gerada, decisao_proferida, recurso_interposto, encerrado
    descricao: Mapped[str | None] = mapped_column(Text)
    autor: Mapped[str | None] = mapped_column(String(255))
    dados_json: Mapped[str | None] = mapped_column(Text)  # metadados extras em JSON
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)


class Notificacao(Base):
    """Notificações para os usuários do sistema.

    Criadas pela automação (verificar_prazos) ou por ações internas quando
    algo relevante acontece em um processo (defesa juntada, prazo vencido,
    fase avançada, etc.).

    O frontend consulta as não-lidas para exibir o ícone de sino com badge.
    """
    __tablename__ = "notificacao"

    id: Mapped[int] = mapped_column(primary_key=True)
    caixa_entrada_id: Mapped[int | None] = mapped_column(ForeignKey("caixa_entrada.id"), index=True)
    tipo: Mapped[str] = mapped_column(String(50), index=True)
    # Tipos: defesa_juntada, defesa_intempestiva, prazo_vencido,
    #        prazo_proximo_vencer, fase_avancada, acesso_externo_visualizado,
    #        acesso_nao_visualizado, documento_externo, documento_assinado
    titulo: Mapped[str] = mapped_column(String(255))
    descricao: Mapped[str | None] = mapped_column(Text)
    lida: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)


# ==============================================================================
# Cache persistente de respostas da API do SEI
# ==============================================================================


class CacheSei(Base):
    """Cache persistente de respostas da API do SEI.

    Motivação: documentos e andamentos já registrados no SEI não mudam. Sem
    cache, cada abertura de tela rebaixava tudo da API, o que deixava o app
    lento e sobrecarregava o SEI.

    Duas categorias de entrada, distinguidas pelo prefixo da ``chave``:

    - ``doc:{numero}`` — conteúdo de um documento. Imutável no SEI depois de
      assinado, então usamos ``ttl_segundos=0`` (nunca expira).
    - ``docs:{id_procedimento}`` / ``hist:{id_procedimento}:{modo}`` — listas
      que crescem conforme o processo anda. Usam TTL curto e são invalidadas
      explicitamente quando o próprio app inclui um documento no processo.
    """
    __tablename__ = "cache_sei"

    id: Mapped[int] = mapped_column(primary_key=True)
    chave: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    valor_json: Mapped[str] = mapped_column(Text)
    # Tamanho em bytes do conteúdo bruto (para diagnóstico/limpeza)
    tamanho: Mapped[int | None] = mapped_column()
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)


# ==============================================================================
# Consulta Unificada (tela somente-leitura)
# ==============================================================================


class ConsultaUnificada(Base):
    """Visão consolidada de relatórios de fiscalização e processos sancionatórios.

    Alimenta a tela "Consulta Unificada", que existe só para consulta — nenhuma
    ação é disparada a partir dela.

    Duas origens:

    - **relatório**: vem da ``listaDesignacao`` do SharePoint (site DCAN) na
      íntegra, inclusive fiscalizações que nunca entraram na nossa caixa de
      entrada. A ``situacao`` é o ``statusAndamento`` dessa lista.
    - **processo**: vem da nossa ``CaixaEntrada``, para os itens cuja triagem
      criou processo sancionatório. Aqui a ``fase_atual`` é preenchida.

    Por que uma tabela própria em vez de consultar na hora: as datas exigidas
    pela tela vêm dos andamentos do SEI (uma chamada por linha) e a lista tem
    ~20 mil registros. Consultar a cada acesso deixaria a tela inviável, então
    a sincronização roda em background e a tela lê só do banco.

    As duas datas saem do mesmo endpoint (``/andamentos/completo``), que devolve
    do mais recente para o mais antigo: ``data_criacao_sei`` é o último item do
    array e ``data_ultima_acao`` é o primeiro.
    """
    __tablename__ = "consulta_unificada"

    id: Mapped[int] = mapped_column(primary_key=True)
    # "relatorio" (fiscalização) ou "processo" (sancionatório)
    tipo: Mapped[str] = mapped_column(String(20), index=True)
    numero_sei: Mapped[str | None] = mapped_column(String(50), index=True)
    # Sem máscara, para busca
    numero_limpo: Mapped[str | None] = mapped_column(String(30), index=True)
    # ID interno do procedimento no SEI: link direto e consulta de andamentos
    id_procedimento: Mapped[str | None] = mapped_column(String(30))
    id_relatorio: Mapped[str | None] = mapped_column(String(60), index=True)

    razao_social: Mapped[str | None] = mapped_column(String(255))
    cnpj_cpf: Mapped[str | None] = mapped_column(String(20), index=True)
    agente_regulado: Mapped[str | None] = mapped_column(String(120), index=True)
    municipio: Mapped[str | None] = mapped_column(String(120))
    ano: Mapped[str | None] = mapped_column(String(10), index=True)

    # statusAndamento da listaDesignacao (Concluído, Avaliado, Em andamento...)
    situacao: Mapped[str | None] = mapped_column(String(60), index=True)
    # Fase do processo administrativo — só para tipo "processo"
    fase_atual: Mapped[str | None] = mapped_column(String(50))

    # Datas obtidas dos andamentos do SEI (ver docstring da classe)
    data_criacao_sei: Mapped[date | None] = mapped_column(Date)
    data_ultima_acao: Mapped[date | None] = mapped_column(Date)

    # Vínculo com o nosso item, quando ele existe na caixa de entrada
    caixa_entrada_id: Mapped[int | None] = mapped_column(ForeignKey("caixa_entrada.id"), index=True)

    # Quando as datas foram buscadas no SEI pela última vez. NULL = nunca;
    # usado para enriquecer em rotação, sem repetir o que já foi feito.
    datas_sincronizadas_em: Mapped[datetime | None] = mapped_column(DateTime)
    atualizado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora, onupdate=_agora)

    @property
    def fonte(self) -> str:
        """De onde o registro veio, para o filtro "Fonte dos dados" da tela.

        ``processamento`` quando o item já chegou à nossa caixa de entrada
        (mesmo que ainda aguarde triagem ou tenha sido arquivado);
        ``fiscalizacao`` quando ele só existe no app de fiscalização.
        """
        return "processamento" if self.caixa_entrada_id else "fiscalizacao"


# ==============================================================================
# Advogados / Procuradores
# ==============================================================================


class Advogado(Base):
    """Cadastro de advogados/procuradores que representam os interessados.

    A busca por OAB é a chave de deduplicação: se o analista cadastrar um
    advogado com OAB que já existe no banco, o sistema retorna o existente em
    vez de criar duplicado. Um advogado pode representar vários processos
    (relação N:N via AdvogadoProcesso).
    """
    __tablename__ = "advogado"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(255))
    oab: Mapped[str] = mapped_column(String(30), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255))
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)


class AdvogadoProcesso(Base):
    """Vínculo entre advogado e processo (um advogado pode atuar em vários)."""
    __tablename__ = "advogado_processo"

    id: Mapped[int] = mapped_column(primary_key=True)
    advogado_id: Mapped[int] = mapped_column(ForeignKey("advogado.id"), index=True)
    caixa_entrada_id: Mapped[int] = mapped_column(ForeignKey("caixa_entrada.id"), index=True)
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)


class BibliotecaTexto(Base):
    """Acervo de referência da área (tela Biblioteca).

    Guarda o que a equipe consulta para instruir processo: estoque normativo,
    pareceres da Consultoria Jurídica e notas técnicas. O conteúdo pode vir de
    três formas, combináveis no mesmo registro — ``link`` para o texto publicado
    fora daqui, ``texto`` digitado/colado no app e PDF anexado (``arquivo_*``).
    Uma nota técnica, por exemplo, costuma ter o resumo em texto e o PDF
    assinado junto.

    ``data_referencia`` é a data do documento (publicação do parecer, da norma),
    não a do cadastro — é por ela que a lista ordena, porque é o que importa
    para achar a referência mais recente sobre um tema.

    O PDF fica no banco, em coluna binária: são poucos arquivos, o volume é
    pequeno e assim o acervo acompanha o backup do banco, sem depender de pasta
    no servidor. ``arquivo_conteudo`` e ``texto`` são ``deferred`` para a
    listagem não arrastar o conteúdo de todos os registros.
    """
    __tablename__ = "biblioteca_texto"

    id: Mapped[int] = mapped_column(primary_key=True)

    #: estoque_normativo | parecer_cj | nota_tecnica (ver CLASSIFICACOES na rota)
    classificacao: Mapped[str] = mapped_column(String(40), index=True)
    titulo: Mapped[str] = mapped_column(String(300), index=True)
    tema: Mapped[str | None] = mapped_column(String(200), index=True)
    #: Data do documento (publicação/assinatura), não a do cadastro.
    data_referencia: Mapped[date | None] = mapped_column(Date, index=True)
    link: Mapped[str | None] = mapped_column(String(1000))
    texto: Mapped[str | None] = mapped_column(Text, deferred=True)

    arquivo_nome: Mapped[str | None] = mapped_column(String(255))
    arquivo_mime: Mapped[str | None] = mapped_column(String(120))
    arquivo_tamanho: Mapped[int | None] = mapped_column(Integer)
    arquivo_conteudo: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)

    autor: Mapped[str | None] = mapped_column(String(255))
    versao_atual: Mapped[int] = mapped_column(Integer, default=1)
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)
    atualizado_em: Mapped[datetime | None] = mapped_column(DateTime, onupdate=_agora)

    versoes: Mapped[list["BibliotecaVersao"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", order_by="BibliotecaVersao.numero.desc()"
    )


class BibliotecaVersao(Base):
    """Histórico de edições de um item da Biblioteca.

    Cada ``PUT`` no item gera uma nova versão com o conteúdo anterior, antes da
    gravação. Permite consultar qualquer estado passado e restaurar se necessário.
    """
    __tablename__ = "biblioteca_versao"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("biblioteca_texto.id"), index=True)
    numero: Mapped[int] = mapped_column(Integer)  # 1, 2, 3...
    autor: Mapped[str | None] = mapped_column(String(255))
    criado_em: Mapped[datetime] = mapped_column(DateTime, default=_agora)

    # Snapshot dos campos editáveis no momento da versão
    classificacao: Mapped[str | None] = mapped_column(String(40))
    titulo: Mapped[str | None] = mapped_column(String(300))
    tema: Mapped[str | None] = mapped_column(String(200))
    data_referencia: Mapped[date | None] = mapped_column(Date)
    link: Mapped[str | None] = mapped_column(String(1000))
    texto: Mapped[str | None] = mapped_column(Text)

    item: Mapped["BibliotecaTexto"] = relationship(back_populates="versoes")
