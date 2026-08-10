"""Regras de negocio: limpeza de numero SEI e calculo de datas e fase."""

# Fuso de Brasilia (sem horario de verao desde 2019): UTC-03:00.
OFFSET_BRASILIA = "T00:00:00-03:00"


def limpar_numero_sei(numero):
    if not numero:
        return ""
    resultado = str(numero)
    for ch in [".", "/", "-", " "]:
        resultado = resultado.replace(ch, "")
    return resultado


def _data_br_para_iso(data_br):
    if not data_br:
        return ""
    partes = data_br.split("/")
    if len(partes) != 3:
        return ""
    dia, mes, ano = partes
    return f"{ano}-{mes}-{dia}"


def _data_br_para_sharepoint(data_br):
    iso = _data_br_para_iso(data_br)
    if not iso:
        return ""
    return iso + OFFSET_BRASILIA


def calcular_data_situacao(andamentos):
    if not andamentos:
        return ""
    return _data_br_para_sharepoint(andamentos[0].get("data", ""))


def calcular_fase_pa(andamentos):
    if not andamentos:
        return ""
    descricao = andamentos[0].get("descricao", "")
    if "(" not in descricao or ")" not in descricao:
        return ""
    return descricao.split("(")[1].split(")")[0]


def calcular_data_instauracao(andamentos, descricoes_doc):
    descricoes = [d for d in descricoes_doc if d]
    for andamento in andamentos:
        descricao = andamento.get("descricao", "")
        if "(" not in descricao or ")" not in descricao:
            continue
        if any(doc in descricao for doc in descricoes):
            return _data_br_para_sharepoint(andamento.get("data", ""))
    return ""