"""Trilha de auditoria das ações dos usuários (Documentação de Negócio v3.0).

Registra usuário, data, horário, operação e documento afetado. O registro é
feito por middleware em toda requisição que altera dados, e não endpoint a
endpoint: assim rota nova entra na trilha sem ninguém precisar lembrar.

Falha ao auditar **nunca** derruba a requisição. A ação do usuário já foi
executada quando a trilha é escrita; abortar aqui daria erro numa operação que
de fato aconteceu, o que é pior que perder uma linha de log.
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:  # pragma: no cover
    from sqlalchemy.orm import Session

#: Métodos que alteram dados e por isso entram na trilha.
METODOS_AUDITADOS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: Caminhos ignorados: não alteram dado de negócio e só poluiriam a trilha.
#: Escritos sem o prefixo /api porque a comparação é feita depois de removê-lo.
CAMINHOS_IGNORADOS = ("/docs", "/openapi.json", "/health")

#: Prefixo de todas as rotas da API (ver app/main.py).
PREFIXO_API = "/api"

_ID_NO_CAMINHO = re.compile(r"/(\d+)(?:/|$)")


def sem_prefixo(caminho: str) -> str:
    """Caminho sem o ``/api`` da frente.

    Existe porque a entidade da trilha é o primeiro segmento do caminho. Quando a
    API passou a viver sob ``/api``, toda linha da trilha passou a ser gravada com
    entidade ``"api"``, e o filtro por área do endpoint ``GET /api/auditoria``
    deixou de encontrar qualquer coisa.
    """
    if caminho == PREFIXO_API:
        return "/"
    if caminho.startswith(PREFIXO_API + "/"):
        return caminho[len(PREFIXO_API):]
    return caminho


def entidade_do_caminho(caminho: str) -> Optional[str]:
    """Primeiro segmento do caminho (ignorando o /api), para filtrar por área."""
    partes = [p for p in sem_prefixo(caminho).split("/") if p]
    return partes[0] if partes else None


def id_do_caminho(caminho: str) -> Optional[int]:
    """Primeiro id numérico do caminho, quando houver."""
    achado = _ID_NO_CAMINHO.search(caminho)
    return int(achado.group(1)) if achado else None


def deve_auditar(metodo: str, caminho: str) -> bool:
    if metodo.upper() not in METODOS_AUDITADOS:
        return False
    limpo = sem_prefixo(caminho)
    return not any(limpo.startswith(ignorado) for ignorado in CAMINHOS_IGNORADOS)


def registrar(
    db: "Session",
    usuario: Optional[str],
    metodo: str,
    caminho: str,
    status_http: Optional[int] = None,
    documento: Optional[str] = None,
) -> None:
    """Grava uma linha na trilha. Erros são engolidos de propósito."""
    try:
        from app.db import models as m

        db.add(m.Auditoria(
            usuario=usuario,
            operacao=f"{metodo.upper()} {caminho}"[:255],
            metodo=metodo.upper(),
            caminho=caminho[:500],
            entidade=entidade_do_caminho(caminho),
            registro_id=id_do_caminho(caminho),
            documento=documento,
            status_http=status_http,
        ))
        db.commit()
    except Exception:  # noqa: BLE001 - ver docstring do módulo
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
