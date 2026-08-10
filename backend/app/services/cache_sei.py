"""Cache persistente de respostas da API do SEI (tabela ``cache_sei``).

Como usar::

    from app.services import cache_sei

    dados = cache_sei.obter(db, "docs:12345", ttl_segundos=300)
    if dados is None:
        dados = ...  # consulta o SEI
        cache_sei.gravar(db, "docs:12345", dados)

Regras de TTL adotadas:

- Conteúdo de documento (``doc:*``): ``TTL_INFINITO`` — um documento assinado
  no SEI não muda mais, então não faz sentido rebaixar.
- Listas de documentos e histórico de andamentos: ``TTL_LISTA`` (5 min) —
  crescem conforme o processo anda. Além do TTL, são invalidadas na hora
  quando o próprio app inclui um documento (ver ``invalidar_processo``).

Falhas de cache nunca propagam: se gravar/ler der erro (banco travado, por
exemplo), a função devolve ``None`` e quem chamou segue direto para o SEI.
"""
from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models as m
from app.db.models import _agora

logger = logging.getLogger(__name__)

TTL_INFINITO = 0
TTL_LISTA = 300  # 5 minutos
TTL_CURTO = 60

# Documentos maiores que isso não são cacheados (evita inflar o banco com
# PDFs grandes; eles continuam sendo baixados sob demanda do SEI).
TAMANHO_MAXIMO_CACHE = 8 * 1024 * 1024  # 8 MB


def chave_documento(numero_doc: str) -> str:
    return f"doc:{numero_doc}"


def chave_lista_documentos(id_procedimento: str) -> str:
    return f"docs:{id_procedimento}"


def chave_historico(id_procedimento: str, modo: str) -> str:
    return f"hist:{id_procedimento}:{modo}"


def obter(db: Session, chave: str, ttl_segundos: int = TTL_LISTA) -> Optional[Any]:
    """Lê uma entrada do cache. Retorna ``None`` se ausente ou expirada."""
    try:
        reg = db.scalars(select(m.CacheSei).where(m.CacheSei.chave == chave)).first()
        if not reg:
            return None
        if ttl_segundos and ttl_segundos > 0:
            idade = _agora() - reg.atualizado_em
            if idade > timedelta(seconds=ttl_segundos):
                return None
        return json.loads(reg.valor_json)
    except Exception:  # noqa: BLE001
        logger.debug("Falha ao ler cache %s (ignorando)", chave, exc_info=True)
        return None


def gravar(db: Session, chave: str, valor: Any) -> None:
    """Grava (ou atualiza) uma entrada do cache. Silencioso em caso de erro."""
    try:
        bruto = json.dumps(valor, ensure_ascii=False, default=str)
        tamanho = len(bruto)
        if tamanho > TAMANHO_MAXIMO_CACHE:
            logger.info("Cache %s ignorado: %d bytes acima do limite", chave, tamanho)
            return
        reg = db.scalars(select(m.CacheSei).where(m.CacheSei.chave == chave)).first()
        if reg:
            reg.valor_json = bruto
            reg.tamanho = tamanho
            reg.atualizado_em = _agora()
        else:
            db.add(m.CacheSei(chave=chave, valor_json=bruto, tamanho=tamanho))
        db.commit()
    except Exception:  # noqa: BLE001
        logger.debug("Falha ao gravar cache %s (ignorando)", chave, exc_info=True)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass


def invalidar(db: Session, chave: str) -> None:
    """Remove uma entrada específica do cache."""
    try:
        reg = db.scalars(select(m.CacheSei).where(m.CacheSei.chave == chave)).first()
        if reg:
            db.delete(reg)
            db.commit()
    except Exception:  # noqa: BLE001
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass


def invalidar_processo(db: Session, id_procedimento: str) -> None:
    """Invalida as listas cacheadas de um processo.

    Chamado depois de o app incluir um documento no SEI — sem isso, a lista de
    documentos ficaria desatualizada até o TTL expirar e o usuário não veria o
    documento que acabou de gerar.
    """
    if not id_procedimento:
        return
    try:
        prefixos = [
            chave_lista_documentos(id_procedimento),
            chave_historico(id_procedimento, "resumido"),
            chave_historico(id_procedimento, "completo"),
        ]
        regs = db.scalars(select(m.CacheSei).where(m.CacheSei.chave.in_(prefixos))).all()
        for reg in regs:
            db.delete(reg)
        if regs:
            db.commit()
    except Exception:  # noqa: BLE001
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass


def limpar_tudo(db: Session) -> int:
    """Remove todas as entradas do cache. Retorna quantas foram removidas."""
    regs = db.scalars(select(m.CacheSei)).all()
    total = len(regs)
    for reg in regs:
        db.delete(reg)
    db.commit()
    return total
