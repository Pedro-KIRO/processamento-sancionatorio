"""Histórico de andamentos do processo SEI (resumido / completo).

Replica a lógica dos fluxos `consultaAndamento` (resumido) e
`consultaAndamentoCompleto` do app original em Power Automate.

Diferença entre os modos:
- Resumido (tipoHistorico=R): só andamentos principais (remessas, recebimentos,
  conclusões) — o que aparece no "Consultar Andamento" resumido do SEI.
- Completo (tipoHistorico=T): TODOS os andamentos (incluindo geração de
  documentos, assinaturas, etc.) — o que aparece no "Consultar Andamento"
  completo do SEI.

Ambos usam tarefas=48 (tarefa genérica de andamento de processo).
"""
import logging

from pydantic import BaseModel

from app.core.config import sei_settings
from app.integrations.sei.client import SeiClient

logger = logging.getLogger(__name__)


class AndamentoOut(BaseModel):
    id_andamento: str
    descricao: str
    data: str
    hora: str
    unidade_sigla: str
    unidade_descricao: str
    usuario_nome: str | None = None
    usuario_sigla: str | None = None


def _get_sei_client() -> SeiClient:
    """Cliente SEI compartilhado (reaproveita o token entre requests)."""
    from app.core.sei_shared import get_sei_client
    return get_sei_client(timeout=30)


def listar_historico_andamentos(
    id_procedimento: str,
    id_unidade: str,
    modo: str = "resumido",
    sei: SeiClient | None = None,
    db=None,
) -> list[AndamentoOut]:
    """Lista andamentos de um processo no SEI.

    modo: "resumido" (tipoHistorico=R) ou "completo" (tipoHistorico=T).

    Se ``db`` for informado, usa o cache persistente (``cache_sei``) com TTL
    curto — o histórico é uma das consultas mais caras (loop paginado) e é
    refeita a cada troca de aba no frontend.
    """
    if db is not None:
        from app.services import cache_sei as _cache
        cacheado = _cache.obter(db, _cache.chave_historico(id_procedimento, modo), _cache.TTL_LISTA)
        if cacheado is not None:
            return [AndamentoOut(**a) for a in cacheado]

    sei = sei or _get_sei_client()
    tipo_historico = "R" if modo == "resumido" else "T"

    andamentos: list[AndamentoOut] = []
    start = 0

    while True:
        try:
            resp = sei.listar_andamentos(
                id_procedimento, id_unidade,
                tipo_historico=tipo_historico,
                tarefas="48",
                start=start,
                limit=90,
            )
        except Exception as e:
            logger.warning("Erro ao listar histórico (proc %s, start %d): %s", id_procedimento, start, e)
            break

        lista = resp.get("Andamentos", [])
        if not lista:
            break

        for a in lista:
            unidade = a.get("unidade", {})
            usuario = a.get("usuario", {})
            andamentos.append(AndamentoOut(
                id_andamento=a.get("idAndamento", ""),
                descricao=a.get("descricao", ""),
                data=a.get("data", ""),
                hora=a.get("hora", ""),
                unidade_sigla=unidade.get("sigla", ""),
                unidade_descricao=unidade.get("descricao", ""),
                usuario_nome=usuario.get("nome"),
                usuario_sigla=usuario.get("sigla"),
            ))

        if len(lista) < 90:
            break
        start += 1

    if db is not None and andamentos:
        from app.services import cache_sei as _cache
        _cache.gravar(
            db,
            _cache.chave_historico(id_procedimento, modo),
            [a.model_dump() for a in andamentos],
        )

    return andamentos
