"""Rotas de gestão de usuários e acessos.

Acesso restrito ao perfil de coordenação. Permite listar, criar, editar
e desativar usuários do sistema, bem como definir perfil e unidade.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, exigir_coordenador
from app.db import models as m

router = APIRouter(prefix="/usuarios", tags=["Usuários"])


# ==============================================================================
# Schemas
# ==============================================================================


class UsuarioIn(BaseModel):
    email: str
    nome: str | None = None
    #: Um dos seis perfis de ``app.core.security.PERFIS``.
    perfil: str | None = None
    id_unidade: str | None = None
    ativo: bool = True


class UsuarioOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    email: str
    nome: str | None = None
    perfil: str | None = None
    id_unidade: str | None = None
    ativo: bool = True


# ==============================================================================
# Rotas
# ==============================================================================


@router.get("/perfis")
def listar_perfis(
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
) -> list[dict]:
    """Perfis aceitos, na ordem hierárquica, para o seletor da tela."""
    from app.core.security import PERFIS

    return [{"valor": valor, "rotulo": rotulo} for valor, rotulo in PERFIS.items()]


@router.get("", response_model=list[UsuarioOut])
def listar(
    busca: str | None = Query(None, description="Busca por nome ou email"),
    somente_ativos: bool = Query(True, description="Apenas usuários ativos"),
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
):
    """Lista todos os usuários cadastrados."""
    stmt = select(m.Usuario)
    if somente_ativos:
        stmt = stmt.where(m.Usuario.ativo.is_(True))
    if busca:
        from sqlalchemy import or_, func
        termo = f"%{busca.strip()}%"
        stmt = stmt.where(
            or_(
                func.lower(m.Usuario.email).like(termo.lower()),
                func.lower(m.Usuario.nome).like(termo.lower()),
            )
        )
    stmt = stmt.order_by(m.Usuario.nome, m.Usuario.email)
    return db.scalars(stmt).all()


@router.post("", response_model=UsuarioOut, status_code=201)
def criar(
    dados: UsuarioIn,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
):
    """Cria um novo usuário. Se o email já existir, retorna erro."""
    email_limpo = dados.email.strip().lower()
    existente = db.scalars(
        select(m.Usuario).where(m.Usuario.email == email_limpo)
    ).first()
    if existente:
        raise HTTPException(409, f"Email {email_limpo} já está cadastrado.")

    novo = m.Usuario(
        email=email_limpo,
        nome=(dados.nome or "").strip() or None,
        perfil=(dados.perfil or "").strip().lower() or None,
        id_unidade=(dados.id_unidade or "").strip() or None,
        ativo=dados.ativo,
    )
    db.add(novo)
    db.commit()
    db.refresh(novo)
    return novo


@router.put("/{usuario_id}", response_model=UsuarioOut)
def atualizar(
    usuario_id: int,
    dados: UsuarioIn,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
):
    """Atualiza um usuário existente."""
    registro = db.get(m.Usuario, usuario_id)
    if not registro:
        raise HTTPException(404, "Usuário não encontrado.")

    email_limpo = dados.email.strip().lower()
    # Verificar se email mudou e se já pertence a outro
    if email_limpo != registro.email:
        conflito = db.scalars(
            select(m.Usuario).where(m.Usuario.email == email_limpo)
        ).first()
        if conflito:
            raise HTTPException(409, f"Email {email_limpo} já está cadastrado para outro usuário.")

    registro.email = email_limpo
    registro.nome = (dados.nome or "").strip() or None
    registro.perfil = (dados.perfil or "").strip().lower() or None
    registro.id_unidade = (dados.id_unidade or "").strip() or None
    registro.ativo = dados.ativo
    db.commit()
    db.refresh(registro)
    return registro


@router.delete("/{usuario_id}", status_code=204)
def desativar(
    usuario_id: int,
    db: Session = Depends(get_db),
    _usuario: UsuarioAutenticado = Depends(exigir_coordenador),
):
    """Desativa um usuário (não exclui, apenas marca como inativo)."""
    registro = db.get(m.Usuario, usuario_id)
    if not registro:
        raise HTTPException(404, "Usuário não encontrado.")
    registro.ativo = False
    db.commit()
