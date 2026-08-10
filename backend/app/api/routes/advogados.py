"""Rotas de Advogados / Procuradores.

CRUD de advogados que representam os interessados nos processos. A busca por
OAB é a chave de deduplicação: se o analista informar uma OAB que já existe,
o sistema retorna o cadastro existente em vez de criar duplicado.
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m

router = APIRouter(prefix="/advogados", tags=["Advogados"])


# ==============================================================================
# Schemas
# ==============================================================================


class AdvogadoIn(BaseModel):
    nome: str
    oab: str
    email: str | None = None


class AdvogadoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str
    oab: str
    email: str | None = None
    criado_em: datetime | None = None


class AdvogadoProcessoOut(BaseModel):
    id: int
    advogado_id: int
    caixa_entrada_id: int
    advogado: AdvogadoOut | None = None


class VincularAdvogadoIn(BaseModel):
    advogado_id: int
    caixa_entrada_id: int


# ==============================================================================
# Rotas
# ==============================================================================


@router.get("", response_model=list[AdvogadoOut])
def listar(
    busca: str | None = Query(None, description="Busca por nome ou OAB"),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista advogados cadastrados com busca opcional por nome ou OAB."""
    stmt = select(m.Advogado)
    if busca:
        termo = f"%{busca.strip()}%"
        from sqlalchemy import or_, func
        stmt = stmt.where(
            or_(
                func.lower(m.Advogado.nome).like(termo.lower()),
                m.Advogado.oab.like(termo),
                func.lower(m.Advogado.email).like(termo.lower()),
            )
        )
    stmt = stmt.order_by(m.Advogado.nome).limit(limit)
    return db.scalars(stmt).all()


@router.get("/buscar-oab")
def buscar_por_oab(
    oab: str = Query(..., description="Número da OAB para busca exata"),
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Busca um advogado pelo número exato da OAB.

    Retorna o advogado se existir, ou null. Usado na tela para evitar
    cadastro duplicado: se já existe, mostra os dados e oferece vincular.
    """
    registro = db.scalars(
        select(m.Advogado).where(m.Advogado.oab == oab.strip())
    ).first()
    if not registro:
        return {"encontrado": False, "advogado": None}
    return {"encontrado": True, "advogado": AdvogadoOut.model_validate(registro)}


@router.post("", response_model=AdvogadoOut, status_code=201)
def criar(
    dados: AdvogadoIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Cria um advogado. Se a OAB já existir, retorna o existente (idempotente)."""
    oab_limpa = dados.oab.strip().upper()
    existente = db.scalars(
        select(m.Advogado).where(m.Advogado.oab == oab_limpa)
    ).first()
    if existente:
        # Atualiza o nome se vier diferente (correção de digitação)
        if dados.nome.strip() and dados.nome.strip() != existente.nome:
            existente.nome = dados.nome.strip()
        if dados.email is not None and dados.email.strip() != (existente.email or ''):
            existente.email = dados.email.strip() or None
        db.commit()
        db.refresh(existente)
        return existente

    novo = m.Advogado(nome=dados.nome.strip(), oab=oab_limpa, email=(dados.email or '').strip() or None)
    db.add(novo)
    db.commit()
    db.refresh(novo)
    return novo


@router.put("/{advogado_id}", response_model=AdvogadoOut)
def atualizar(
    advogado_id: int,
    dados: AdvogadoIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Atualiza nome e/ou OAB de um advogado."""
    registro = db.get(m.Advogado, advogado_id)
    if not registro:
        raise HTTPException(404, "Advogado não encontrado.")

    oab_limpa = dados.oab.strip().upper()
    # Verificar se a nova OAB já pertence a outro registro
    if oab_limpa != registro.oab:
        conflito = db.scalars(
            select(m.Advogado).where(m.Advogado.oab == oab_limpa)
        ).first()
        if conflito:
            raise HTTPException(409, f"OAB {oab_limpa} já está cadastrada para {conflito.nome}.")

    registro.nome = dados.nome.strip()
    registro.oab = oab_limpa
    registro.email = (dados.email or '').strip() or None
    db.commit()
    db.refresh(registro)
    return registro


@router.delete("/{advogado_id}", status_code=204)
def excluir(
    advogado_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Exclui um advogado e seus vínculos com processos."""
    registro = db.get(m.Advogado, advogado_id)
    if not registro:
        raise HTTPException(404, "Advogado não encontrado.")

    # Remover vínculos
    db.execute(
        select(m.AdvogadoProcesso)
        .where(m.AdvogadoProcesso.advogado_id == advogado_id)
    )
    vinculos = db.scalars(
        select(m.AdvogadoProcesso).where(m.AdvogadoProcesso.advogado_id == advogado_id)
    ).all()
    for v in vinculos:
        db.delete(v)

    db.delete(registro)
    db.commit()


# ==============================================================================
# Vínculos advogado ↔ processo
# ==============================================================================


@router.post("/vincular", response_model=AdvogadoOut)
def vincular_a_processo(
    dados: VincularAdvogadoIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Vincula um advogado a um processo (caixa_entrada_id).

    Se já existir vínculo, não duplica. Retorna o advogado.
    """
    advogado = db.get(m.Advogado, dados.advogado_id)
    if not advogado:
        raise HTTPException(404, "Advogado não encontrado.")

    item = db.get(m.CaixaEntrada, dados.caixa_entrada_id)
    if not item:
        raise HTTPException(404, "Processo não encontrado.")

    # Verificar se já existe vínculo
    existente = db.scalars(
        select(m.AdvogadoProcesso).where(
            m.AdvogadoProcesso.advogado_id == dados.advogado_id,
            m.AdvogadoProcesso.caixa_entrada_id == dados.caixa_entrada_id,
        )
    ).first()
    if not existente:
        vinculo = m.AdvogadoProcesso(
            advogado_id=dados.advogado_id,
            caixa_entrada_id=dados.caixa_entrada_id,
        )
        db.add(vinculo)
        db.commit()

    return advogado


@router.get("/processo/{caixa_entrada_id}", response_model=list[AdvogadoOut])
def listar_por_processo(
    caixa_entrada_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista advogados vinculados a um processo específico."""
    stmt = (
        select(m.Advogado)
        .join(m.AdvogadoProcesso, m.AdvogadoProcesso.advogado_id == m.Advogado.id)
        .where(m.AdvogadoProcesso.caixa_entrada_id == caixa_entrada_id)
        .order_by(m.Advogado.nome)
    )
    return db.scalars(stmt).all()


@router.delete("/processo/{caixa_entrada_id}/{advogado_id}", status_code=204)
def desvincular(
    caixa_entrada_id: int,
    advogado_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Remove o vínculo de um advogado com um processo."""
    vinculo = db.scalars(
        select(m.AdvogadoProcesso).where(
            m.AdvogadoProcesso.advogado_id == advogado_id,
            m.AdvogadoProcesso.caixa_entrada_id == caixa_entrada_id,
        )
    ).first()
    if not vinculo:
        raise HTTPException(404, "Vínculo não encontrado.")
    db.delete(vinculo)
    db.commit()
