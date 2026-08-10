"""Contagem de prazos e matriz de prazos do processo sancionatório.

Regras de contagem (Lei Estadual nº 10.177/1998, e Documentação de Negócio
v3.0):

1. **Exclui-se o dia inicial e inclui-se o dia final.** O prazo de 15 dias
   iniciado em 01/08 vence em 16/08, não em 15/08.
2. **O vencimento que cair em dia sem expediente é prorrogado** para o primeiro
   dia útil seguinte.
3. **Os prazos são contínuos**: sábados, domingos e feriados no meio da
   contagem contam normalmente. Só o dia do vencimento é que rola para frente.

O que o app fazia antes era só ``data_inicio + timedelta(days=dias)``, sem
prorrogação — um vencimento em domingo era cobrado no domingo, e a certidão de
decurso podia sair antes do prazo legal ter de fato terminado.

O calendário de dias sem expediente vem da tabela ``feriado``. Quais tipos
entram (nacional, estadual, municipal, ponto facultativo) é ponto em aberto no
documento; por ora todo registro da tabela conta como sem expediente, e
``tipos_considerados`` permite restringir sem mexer em quem chama.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import TYPE_CHECKING, Iterable, Optional

if TYPE_CHECKING:  # pragma: no cover - só para tipagem
    from sqlalchemy.orm import Session


# ==============================================================================
# Semáforo de prazos
#
# O mesmo código de cores vale para a tela de prazos e a de cautelares, para a
# urgência ser lida de imediato nas duas.
# ==============================================================================
VERDE = "verde"
AMARELO = "amarelo"
VERMELHO = "vermelho"

#: A partir de quantos dias restantes o prazo é considerado tranquilo.
DIAS_VERDE = 4

ROTULOS_SEMAFORO = {
    VERDE: "No prazo",
    AMARELO: "Vence em breve",
    VERMELHO: "Vencido",
}


def semaforo(dias_restantes: Optional[int]) -> Optional[str]:
    """Cor do prazo a partir dos dias que faltam para o vencimento.

    Verde com 4 dias ou mais; amarelo no dia do vencimento ou até 3 dias antes;
    vermelho depois de vencido. Sem data de vencimento não há cor.
    """
    if dias_restantes is None:
        return None
    if dias_restantes < 0:
        return VERMELHO
    if dias_restantes <= DIAS_VERDE - 1:
        return AMARELO
    return VERDE


def dias_restantes(vencimento: Optional[date], hoje: Optional[date] = None) -> Optional[int]:
    """Dias até o vencimento. Negativo quando já venceu."""
    if vencimento is None:
        return None
    return (vencimento - (hoje or date.today())).days


def rotulo_restante(dias: Optional[int]) -> str:
    """Texto curto do tempo restante, como aparece na coluna da tela."""
    if dias is None:
        return "—"
    if dias < 0:
        return f"{dias} dias" if dias < -1 else "Vencido há 1 dia"
    if dias == 0:
        return "Hoje"
    if dias == 1:
        return "1 dia"
    return f"{dias} dias"


# ==============================================================================
# Dias sem expediente e contagem
# ==============================================================================


def carregar_feriados(
    db: "Session | None",
    tipos_considerados: Optional[Iterable[str]] = None,
) -> set[date]:
    """Datas sem expediente cadastradas. Sem banco, devolve conjunto vazio.

    Falha de leitura não interrompe o cálculo: sem o calendário a contagem
    apenas deixa de prorrogar para dia útil, o que é melhor que derrubar a
    listagem de prazos inteira.
    """
    if db is None:
        return set()
    try:
        from app.db import models as m

        consulta = db.query(m.Feriado.data)
        if tipos_considerados:
            consulta = consulta.filter(m.Feriado.tipo.in_(list(tipos_considerados)))
        return {linha[0] for linha in consulta.all() if linha[0]}
    except Exception:  # noqa: BLE001
        return set()


def e_dia_util(dia: date, feriados: Optional[set[date]] = None) -> bool:
    """Dia com expediente: não é sábado, domingo nem feriado cadastrado."""
    if dia.weekday() >= 5:  # 5 = sábado, 6 = domingo
        return False
    return dia not in (feriados or set())


def proximo_dia_util(dia: date, feriados: Optional[set[date]] = None) -> date:
    """Primeiro dia com expediente a partir de ``dia`` (inclusive).

    O teto de 30 tentativas evita laço infinito caso o calendário venha com um
    intervalo absurdo cadastrado por engano.
    """
    atual = dia
    for _ in range(30):
        if e_dia_util(atual, feriados):
            return atual
        atual += timedelta(days=1)
    return atual


def calcular_vencimento(
    data_inicio: date,
    dias: int,
    db: "Session | None" = None,
    feriados: Optional[set[date]] = None,
) -> date:
    """Vencimento de um prazo em dias corridos, pela regra da Lei 10.177/1998.

    Exclui o dia inicial (a contagem começa no dia seguinte), inclui o dia final
    e prorroga para o primeiro dia útil quando o final cai em dia sem
    expediente.

    ``feriados`` evita uma consulta por prazo quando se calcula em lote; sem
    ele, o calendário é lido de ``db``.
    """
    if feriados is None:
        feriados = carregar_feriados(db)
    return proximo_dia_util(data_inicio + timedelta(days=dias), feriados)


# ==============================================================================
# Matriz consolidada de prazos
#
# Parametrização única: duração, base legal, gatilho de início e o que acontece
# no vencimento. O documento pede que os prazos sejam parametrizáveis para
# adequação futura a alterações normativas — por isso ficam aqui, num lugar só,
# e não espalhados pelas rotas.
# ==============================================================================


@dataclass(frozen=True)
class TipoPrazo:
    chave: str
    rotulo: str
    dias: int
    base_legal: str
    gatilho: str
    no_vencimento: str
    #: Fase do processo à qual o prazo pertence, quando houver uma só.
    fase: Optional[str] = None
    #: Prazo de acompanhamento gerencial, não do rito (não gera certidão).
    gerencial: bool = False


MATRIZ_PRAZOS: tuple[TipoPrazo, ...] = (
    TipoPrazo(
        "defesa_previa", "Defesa prévia", 15, "Art. 63, III",
        "Citação efetiva (visualização ou edital)", "Certidão de decurso",
        fase="aguardando_defesa",
    ),
    TipoPrazo(
        "defesa_previa_edital", "Defesa prévia (edital)", 15, "Art. 63, III",
        "Publicação do edital", "Certidão de decurso",
        fase="aguardando_defesa",
    ),
    TipoPrazo(
        "manifestacao_documentos", "Manifestação sobre documentos da Administração", 7,
        "Art. 63, V", "Intimação", "Certidão de decurso",
    ),
    TipoPrazo(
        "quesitos_assistente", "Quesitos / assistente técnico", 7, "Art. 63",
        "Despacho saneador", "Preclusão",
    ),
    TipoPrazo(
        "alegacoes_finais", "Alegações finais", 7, "Art. 63, VII",
        "Intimação (saneador)", "Certidão de decurso",
        fase="aguardando_alegacoes",
    ),
    TipoPrazo(
        "decisao_instrucao", "Decisão após instrução", 20, "Art. 63",
        "Regularidade certificada", "Alerta interno",
        fase="julgamento", gerencial=True,
    ),
    TipoPrazo(
        "recurso", "Recurso administrativo", 15, "Art. 44",
        "Publicação ou notificação da Decisão I", "Trânsito administrativo",
        fase="recurso",
    ),
    TipoPrazo(
        "reconsideracao", "Reconsideração da autoridade", 7, "Art. 47, VI",
        "Interposição do recurso", "Encaminha à instância recursal",
        fase="recurso",
    ),
    TipoPrazo(
        "julgamento_recurso", "Julgamento do recurso", 30, "Art. 47, VII",
        "Recebimento dos autos", "Alerta interno",
        fase="recurso", gerencial=True,
    ),
    TipoPrazo(
        "maximo_recurso", "Prazo máximo de decisão do recurso", 120, "Art. 50",
        "Protocolo do recurso", "Alerta de estouro",
        fase="recurso", gerencial=True,
    ),
    TipoPrazo(
        "sem_movimentacao", "Processo sem movimentação", 15, "Gestão",
        "Última movimentação", "Alerta de morosidade",
        gerencial=True,
    ),
    TipoPrazo(
        "encerramento_sem_conclusao", "Termo de encerramento sem conclusão", 2, "Gestão",
        "Termo de encerramento assinado", "Alerta de pendência",
        fase="encerramento", gerencial=True,
    ),
)

POR_CHAVE: dict[str, TipoPrazo] = {t.chave: t for t in MATRIZ_PRAZOS}

#: Prazos da medida cautelar (art. 62, § único). Não entram na matriz acima
#: porque a duração é escolhida caso a caso, não fixada por tipo.
PRAZOS_CAUTELAR = (30, 45, 60, 90)


def tipo_por_chave(chave: str) -> Optional[TipoPrazo]:
    return POR_CHAVE.get(chave)


def dias_do_tipo(chave: str, padrao: int = 15) -> int:
    tipo = POR_CHAVE.get(chave)
    return tipo.dias if tipo else padrao


def tipo_por_fase(fase: Optional[str]) -> Optional[TipoPrazo]:
    """Tipo de prazo correspondente à fase, para os prazos já gravados.

    ``PrazoProcesso`` guarda a fase (``aguardando_defesa``,
    ``aguardando_alegacoes``, ``recurso``), não o tipo — este mapa traduz um no
    outro para a tela de prazos poder mostrar rótulo e base legal.
    """
    if not fase:
        return None
    for tipo in MATRIZ_PRAZOS:
        if tipo.fase == fase:
            return tipo
    return None


def rotulo_do_prazo(fase: Optional[str], dias: Optional[int] = None) -> str:
    """Rótulo do prazo para exibição, com a fase como pista principal.

    Quando a fase serve a mais de um tipo (defesa normal e por edital têm a
    mesma fase), a duração desempata; não havendo como decidir, cai no nome da
    fase para não mostrar rótulo errado.
    """
    tipo = tipo_por_fase(fase)
    if tipo and dias is not None and tipo.dias != dias:
        for candidato in MATRIZ_PRAZOS:
            if candidato.fase == fase and candidato.dias == dias:
                return candidato.rotulo
    if tipo:
        return tipo.rotulo
    return (fase or "").replace("_", " ").capitalize() or "Prazo"
