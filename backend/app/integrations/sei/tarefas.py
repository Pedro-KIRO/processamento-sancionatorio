"""Mapeamento de IDs de tarefas do SEI → descrição (template).

Extraído do Excel "Lista ID e tarefas 1.xlsx" fornecido pela equipe.
Cada tarefa corresponde a um tipo de andamento que pode aparecer no
histórico de um processo no SEI.

Uso principal:
- Identificar o que cada `idTarefa` retornado pela API de andamentos significa.
- Filtrar andamentos por tipo (ex.: tarefas=2,13,33 para documentos;
  tarefas=48 para recebimento na unidade).
"""

# ID da tarefa → template de descrição (com placeholders do SEI: @CAMPO@)
TAREFAS_SEI: dict[int, str] = {
    1: "Processo @NIVEL_ACESSO@@GRAU_SIGILO@ gerado@DATA_AUTUACAO@@HIPOTESE_LEGAL@",
    2: "Gerado documento @NIVEL_ACESSO@@GRAU_SIGILO@ @DOCUMENTO@@HIPOTESE_LEGAL@",
    5: "Assinado Documento @DOCUMENTO@ por @USUARIO@",
    6: "Cancelamento de assinatura do documento @DOCUMENTO@",
    7: "@MOTIVO@ do documento @DOCUMENTO@ no veículo @VEICULO@ de @DATA@ @TIPO@",
    12: "Envio de correspondência eletrônica @DOCUMENTO@",
    13: "Registro de documento externo @NIVEL_ACESSO@@GRAU_SIGILO@ @DOCUMENTO@@TIPO_CONFERENCIA@@HIPOTESE_LEGAL@",
    18: "Adicionado processo relacionado @PROCESSO@",
    19: "Removido relacionamento com o processo @PROCESSO@",
    20: "Sobrestamento. @MOTIVO@",
    21: "Remoção de sobrestamento",
    24: "Arquivado documento @DOCUMENTO@ no localizador @LOCALIZADOR@",
    26: "Desarquivado documento @DOCUMENTO@. Retirado por @USUARIO@.",
    27: "Migrado documento @DOCUMENTO@ para o localizador @LOCALIZADOR@",
    28: "Conclusão do processo na unidade",
    29: "Reabertura do processo na unidade",
    30: "Arquivo @ANEXO@ anexado no documento @DOCUMENTO@.",
    31: "Anexo @ANEXO@ removido do documento @DOCUMENTO@.",
    32: "Processo remetido pela unidade @UNIDADE@",
    33: "Exclusão do documento @DOCUMENTO@",
    34: "Processo inserido no bloco @BLOCO@",
    35: "Documento @DOCUMENTO@ inserido no bloco @BLOCO@",
    36: "Processo retirado do bloco @BLOCO@",
    37: "Documento @DOCUMENTO@ retirado do bloco @BLOCO@",
    38: "Bloco @BLOCO@ disponibilizado para unidade @UNIDADE@",
    39: "Cancelada disponibilização do bloco @BLOCO@ para a unidade @UNIDADE@",
    40: "Bloco @BLOCO@ retornado para a unidade @UNIDADE@",
    41: "Conclusão automática de processo na unidade",
    42: "Sobrestando o processo @PROCESSO@. @MOTIVO@",
    43: "Sobrestado com vínculo ao processo @PROCESSO@. @MOTIVO@",
    44: "Deixou de sobrestar o processo @PROCESSO@",
    45: "Deixou de estar sobrestado ao processo @PROCESSO@",
    47: "Cancelado agendamento de @MOTIVO@ do documento @DOCUMENTO@ no veículo @VEICULO@ de @DATA@",
    48: "Processo recebido na unidade",
    50: "Disponibilizado acesso externo para @DESTINATARIO_NOME@ (@DESTINATARIO_EMAIL@)@VALIDADE@.@VISUALIZACAO@ @MOTIVO@",
    51: "Cancelado documento @DOCUMENTO@. @MOTIVO@",
    52: "Disponibilizado acesso externo para @INTERESSADO@",
    53: "Documento @DOCUMENTO@ recebido para arquivamento",
    54: "Cancelado recebimento do documento @DOCUMENTO@ para arquivamento",
    55: "Solicitado desarquivamento do documento @DOCUMENTO@",
    56: "Cancelada solicitação de desarquivamento do documento @DOCUMENTO@",
    57: "Processo atribuído para @USUARIO@",
    58: "Alterado nível de acesso geral para @NIVEL_ACESSO@",
    59: "Removida atribuição do processo",
    60: "Alterada ordem dos protocolos",
    61: "Credencial concedida para o usuário @USUARIO@",
    62: "Processo recebido",
    63: "Processo concluído",
    64: "Reabertura do processo",
    65: "@DESCRICAO@",
    66: "Transferida credencial para o usuário @USUARIO@",
    67: "Credencial concedida para o usuário @USUARIO@ (cassada em @DATA_HORA@)",
    68: "Transferida credencial para o usuário @USUARIO@ (cassada em @DATA_HORA@)",
    69: "Cassada credencial do usuário @USUARIO@",
    70: "Conclusão Automática de Processo do Usuário @USUARIO@",
    71: "Credencial concedida para o usuário @USUARIO@ (anulada em @DATA_HORA@)",
    72: "Transferida credencial para o usuário @USUARIO@ (anulada em @DATA_HORA@)",
    73: "Concedida credencial de assinatura no documento @DOCUMENTO@ para o usuário @USUARIO@",
    74: "Cassada credencial de assinatura no documento @DOCUMENTO@ do usuário @USUARIO@",
    75: "Concedida credencial de assinatura no documento @DOCUMENTO@ para o usuário @USUARIO@ (cassada em @DATA_HORA@)",
    76: "Concedida credencial de assinatura no documento @DOCUMENTO@ para o usuário @USUARIO@ (anulada por @USUARIO_ANULACAO@ em @DATA_HORA@)",
    77: "Renúncia de credencial",
    78: "Renúncia de credencial (anulada por @USUARIO_ANULACAO@ em @DATA_HORA@)",
    79: "Credencial concedida para o usuário @USUARIO@ (renunciada em @DATA_HORA@)",
    80: "Transferida credencial para o usuário @USUARIO@ (renunciada em @DATA_HORA@)",
    81: "Concedida credencial de assinatura no documento @DOCUMENTO@ para o usuário @USUARIO@ (utilizada em @DATA_HORA@)",
    82: "Ciência no processo",
    83: "Ciência no documento @DOCUMENTO@",
    84: "Documento(s) #DOCUMENTOS# enviado(s) para notificação de #USUARIOS#. Início do prazo em @DATA_INICIO@ finalizando em @DATA_FIM@.",
    85: "Usuário @USUARIO@ notificado em @DATA@ no(s) documento(s) #DOCUMENTOS#.",
    86: "Liberada assinatura externa para o usuário @USUARIO_EXTERNO_NOME@ (@USUARIO_EXTERNO_SIGLA@) no documento @DOCUMENTO@@VALIDADE@.@VISUALIZACAO@",
    87: "Cancelada liberação de assinatura externa para o usuário @USUARIO_EXTERNO_NOME@ (@USUARIO_EXTERNO_SIGLA@) no documento @DOCUMENTO@. @MOTIVO@",
    88: "Liberada assinatura externa para o usuário @USUARIO_EXTERNO_NOME@ (@USUARIO_EXTERNO_SIGLA@) no documento @DOCUMENTO@@VALIDADE@.@VISUALIZACAO@ (cancelada por @USUARIO@ em @DATA_HORA@)",
    89: "Disponibilizado acesso externo para @DESTINATARIO_NOME@ (@DESTINATARIO_EMAIL@)@VALIDADE@.@VISUALIZACAO@ @MOTIVO@ (cancelada por @USUARIO@ em @DATA_HORA@)",
    90: "Cancelada disponibilização de acesso externo para @DESTINATARIO_NOME@ (@DESTINATARIO_EMAIL@). @MOTIVO@",
    95: "Conclusão do bloco @BLOCO@",
    96: "Reabertura do bloco @BLOCO@",
    97: "Término do prazo para notificação de #USUARIOS# no(s) documento(s) #DOCUMENTOS# em @DATA@.",
    98: "Solicitação Atendida",
    99: "Solicitação não Atendida",
    100: "Cancelada Sinalização de Atendimento",
    101: "Processo @PROCESSO@ anexado",
    102: "Anexado ao processo @PROCESSO@",
    103: "Processo @PROCESSO@ desanexado. @MOTIVO@",
    104: "Desanexado do processo @PROCESSO@. @MOTIVO@",
    105: "Alterado nível de acesso do processo para @NIVEL_ACESSO@",
    106: "Alterado grau de sigilo do processo para @GRAU_SIGILO@",
    107: "Alterada hipótese legal do processo para @HIPOTESE_LEGAL@",
    108: "Alterado nível de acesso do documento @DOCUMENTO@ para @NIVEL_ACESSO@",
    109: "Alterado grau de sigilo do documento @DOCUMENTO@ para @GRAU_SIGILO@",
    110: "Alterada hipótese legal do documento @DOCUMENTO@ para @HIPOTESE_LEGAL@",
    111: "Alterado tipo de conferência do documento @DOCUMENTO@ para @TIPO_CONFERENCIA@",
    112: "Ciência no processo anexado @PROCESSO@",
    113: "Documento @DOCUMENTO@ movido para o processo @PROCESSO@. @MOTIVO@",
    114: "Documento @DOCUMENTO@ movido do processo @PROCESSO@. @MOTIVO@",
    115: "Autenticado Documento @DOCUMENTO@ por @USUARIO@",
    116: "Cancelamento de autenticação do documento @DOCUMENTO@",
    117: "Cancelamento de credencial por Coordenador de Acervo do usuário @USUARIO@ na unidade",
    118: "Ativação de credencial por Coordenador de Acervo para o usuário @USUARIO@",
    119: "Ativação de credencial por Coordenador de Acervo para o usuário @USUARIO@ (cassada em @DATA_HORA@)",
    120: "Ativação de credencial por Coordenador de Acervo para o usuário @USUARIO@ (anulada em @DATA_HORA@)",
    121: "Ativação de credencial por Coordenador de Acervo para o usuário @USUARIO@ (renunciada em @DATA_HORA@)",
    122: "Processo bloqueado",
    123: "Processo desbloqueado",
    124: "Correção de encaminhamento para @ORGAO@ (@PROCESSO@)",
    125: "Cancelado arquivamento do documento @DOCUMENTO@ no localizador @LOCALIZADOR@",
    126: 'Alterado tipo do processo de "@TIPO_PROCESSO_ANTERIOR@" para "@TIPO_PROCESSO_ATUAL@"',
    127: 'Renovada credencial do usuário @USUARIO@"',
    128: 'Alterado número do processo de "@PROTOCOLO_ANTERIOR@" para "@PROTOCOLO_ATUAL@"',
    129: 'Alterada data de autuação do processo de "@DATA_ANTERIOR@" para "@DATA_ATUAL@"',
    134: "Processo enviado para @ORGAO_DESTINATARIO@ por @ORGAO_REMETENTE@ @MOTIVO@",
    135: "Processo enviado para @ORGAO_DESTINATARIO@ por @ORGAO_REMETENTE@ @MOTIVO@ (cancelado por @USUARIO@ em @DATA_HORA@)",
    136: "Cancelado envio para @ORGAO_DESTINATARIO@ por @ORGAO_REMETENTE@ @MOTIVO@",
    1000: "Intimação Eletrônica expedida em @DATA_EXPEDICAO_INTIMACAO@, sobre o Documento Principal @DOCUMENTO@, para @USUARIO_EXTERNO_NOME@",
    1001: "Intimação cumprida em @DATA_CUMPRIMENTO_INTIMACAO@, conforme Certidão @DOC_CERTIDAO_INTIMACAO@, por @TIPO_CUMPRIMENTO_INTIMACAO@, sobre a Intimação expedida em @DATA_EXPEDICAO_INTIMACAO@ e Documento Principal @DOCUMENTO@ para @USUARIO_EXTERNO_NOME@",
    1002: "O Usuário Externo @USUARIO_EXTERNO_NOME@ efetivou Peticionamento @TIPO_PETICIONAMENTO@, tendo gerado o recibo @DOCUMENTO@",
    1003: "Prorrogação Automática do Prazo Externo de possível Resposta a Intimação, relativa à Intimação expedida em @DATA_EXPEDICAO_INTIMACAO@ e ao Documento Principal @DOCUMENTO@, para @DATA_LIMITE_RESPOSTAS@",
    1007: "Documento @DOCUMENTO@ enviado para publicação em @PUBLICATIONSCHEDULE@ no @VEICULO@ (@PUBLICATIONID@). @PUBLICATIONSTATUS@ no caderno @JOURNAL@ na seção @SECTION@ com o tipo de matéria @PUBLICATIONTYPE@",
    1008: "Publicação no @VEICULO@ (@PUBLICATIONID@) foi cancelada. Motivo: @MOTIVO@",
}

# Agrupamento por categoria (para facilitar filtros na UI)
CATEGORIAS_TAREFA: dict[str, list[int]] = {
    "Documentos": [2, 5, 6, 12, 13, 30, 31, 33, 51, 53, 54, 55, 56, 113, 114, 115, 116],
    "Processo": [1, 18, 19, 20, 21, 28, 29, 32, 41, 42, 43, 44, 45, 48, 57, 59, 62, 63, 64, 82, 101, 102, 103, 104, 105, 106, 107, 122, 123, 126, 128, 129],
    "Blocos": [34, 35, 36, 37, 38, 39, 40, 95, 96],
    "Acesso/Credenciais": [50, 52, 58, 61, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 86, 87, 88, 89, 90, 117, 118, 119, 120, 121, 127],
    "Notificações/Intimações": [84, 85, 97, 1000, 1001, 1003],
    "Publicação": [7, 47, 1007, 1008],
    "Peticionamento": [1002],
    "Outros": [24, 26, 27, 60, 65, 83, 98, 99, 100, 108, 109, 110, 111, 112, 124, 125, 134, 135, 136],
}


def nome_tarefa(id_tarefa: int) -> str:
    """Retorna o nome/template legível de uma tarefa pelo ID."""
    return TAREFAS_SEI.get(id_tarefa, f"Tarefa desconhecida ({id_tarefa})")


def categoria_tarefa(id_tarefa: int) -> str:
    """Retorna a categoria de uma tarefa pelo ID."""
    for cat, ids in CATEGORIAS_TAREFA.items():
        if id_tarefa in ids:
            return cat
    return "Outros"
