"""Normalização dos nomes de agente regulado.

O app de fiscalização (``listaDesignacao``) usa nomes detalhados por
credenciamento: "Centros de formação de condutores – CFC B", "Empresas
credenciadas de vistoria – Remota", "Clínica de Medicina do Tráfego". Para o
processamento sancionatório essas distinções não importam: o que interessa é a
classe do agente, porque é ela que define unidade, tipo de procedimento, bloco
de assinatura e modelo de documento.

Sem essa consolidação, o filtro de agente regulado da Consulta Unificada trazia
mais de vinte opções, várias sinônimas entre si.

Há também classes que não pertencem ao processamento sancionatório e não devem
aparecer no app — ``normalizar`` devolve ``None`` para elas.
"""
from __future__ import annotations

import re
import unicodedata

# Classes usadas no app, na forma canônica.
AUTOESCOLA = "Autoescola"
PERITO = "Perito"
DESMONTE = "Desmonte"
DESPACHANTE = "Despachante"
ECV = "ECV"
ESTAMPADORA = "Estampadora"

CLASSES = (AUTOESCOLA, PERITO, DESMONTE, DESPACHANTE, ECV, ESTAMPADORA)

# Classes que saem do app: não são objeto de processo sancionatório aqui.
# "Médicos e psicólogos" é resquício de um cadastro antigo (poucos registros) e
# não deve ser confundido com "Médicos"/"Psicólogos", que viram Perito.
# "Instituição de ensino" aparece no singular e no plural nas tabelas de
# configuração; as duas formas saem.
DESCARTADOS = (
    "patio", "pátio", "renave", "medicos e psicologos",
    "instituicoes de ensino", "instituicao de ensino",
)

# Palavras que identificam cada classe, avaliadas em ordem. A primeira regra que
# casar decide, então o que é mais específico vem antes.
REGRAS: tuple[tuple[tuple[str, ...], str], ...] = (
    # Vistoria: presencial ou remota, ambas ECV
    (("empresas credenciadas de vistoria", "vistoria", "ecv"), ECV),
    # Estampadoras e EPIV
    (("estampadora", "epiv", "placa"), ESTAMPADORA),
    # Desmanches, desmontes e comércio de peças
    (("desmonte", "desmanche", "comercio"), DESMONTE),
    # Despachantes
    (("despachante",), DESPACHANTE),
    # Autoescolas e centros de formação de condutores
    (("autoescola", "centros de formacao de condutores", "cfc"), AUTOESCOLA),
    # Peritos: clínicas, médicos, psicólogos e Poupatempo
    (("clinica", "medico", "psicolog", "perito", "poupatempo"), PERITO),
)


def _normalizar_texto(valor: str) -> str:
    """Minúsculas, sem acento e com espaços colapsados, para comparar."""
    sem_acento = "".join(
        c for c in unicodedata.normalize("NFD", valor) if unicodedata.category(c) != "Mn"
    )
    # O travessão dos nomes da listaDesignacao ("– Remota") vira espaço
    return re.sub(r"\s+", " ", sem_acento.replace("–", " ").replace("-", " ")).strip().lower()


# Subclasses de Perito. O SEI não tem um tipo de procedimento único para perito:
# a instauração exige escolher entre Clínica (100002002), Médico (100002001) e
# Psicólogo (100002006) — confirmado em ``GET /processos/tipos``. Por isso a
# classe consolidada não basta para instaurar, e o nome original do agente
# precisa ser preservado (``CaixaEntrada.agente_origem``).
SUBCLASSE_CLINICA = "Clínica"
SUBCLASSE_MEDICO = "Médico"
SUBCLASSE_PSICOLOGO = "Psicólogo"

SUBCLASSES_PERITO: tuple[tuple[tuple[str, ...], str], ...] = (
    # Clínica primeiro: os nomes de clínica contêm "medicina"/"psicologia" e
    # cairiam nas regras seguintes.
    (("clinica",), SUBCLASSE_CLINICA),
    (("medico", "medicina"), SUBCLASSE_MEDICO),
    (("psicolog",), SUBCLASSE_PSICOLOGO),
)


def subclasse(agente: str | None) -> str | None:
    """Subclasse de Perito do agente, ou ``None`` quando não se aplica.

    Só Perito tem subclasse. Para as demais classes a instauração usa um único
    tipo de procedimento, então não há o que distinguir.
    """
    if normalizar(agente) != PERITO:
        return None

    texto = _normalizar_texto(agente or "")
    for palavras, nome in SUBCLASSES_PERITO:
        if any(p in texto for p in palavras):
            return nome
    return None


def normalizar(agente: str | None) -> str | None:
    """Classe canônica do agente, ou ``None`` quando não pertence ao app.

    ``None`` tem dois significados na prática, ambos levando à exclusão do
    registro: a classe está na lista de descartados, ou o nome é vazio.
    """
    if not agente:
        return None

    texto = _normalizar_texto(agente)
    if not texto:
        return None

    # Já está na forma canônica
    for classe in CLASSES:
        if texto == _normalizar_texto(classe):
            return classe

    if any(termo in texto for termo in (_normalizar_texto(d) for d in DESCARTADOS)):
        return None

    for palavras, classe in REGRAS:
        if any(_normalizar_texto(p) in texto for p in palavras):
            return classe

    # Nome desconhecido: preserva como veio, para não sumir com dado sem aviso.
    # Aparece no filtro e sinaliza que a regra precisa de mais um caso.
    return agente.strip()
