"""Rotas de Anotações Internas."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import UsuarioAutenticado, get_current_user
from app.db import models as m
from app.schemas.anotacoes import AnotacaoIn, AnotacaoOut

router = APIRouter(prefix="/caixa-entrada/{item_id}/anotacoes", tags=["Anotações"])


def _verificar_item(item_id: int, db: Session) -> m.CaixaEntrada:
    item = db.get(m.CaixaEntrada, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item da caixa de entrada não encontrado")
    return item


@router.get("", response_model=list[AnotacaoOut])
def listar_anotacoes(
    item_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Lista todas as anotações de um item da caixa de entrada (ordem cronológica)."""
    _verificar_item(item_id, db)
    stmt = (
        select(m.Anotacao)
        .where(m.Anotacao.caixa_entrada_id == item_id)
        .order_by(m.Anotacao.criado_em.asc())
    )
    return db.scalars(stmt).all()


@router.post("", response_model=AnotacaoOut, status_code=201)
def criar_anotacao(
    item_id: int,
    dados: AnotacaoIn,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Cria uma nova anotação interna vinculada a um item da caixa de entrada."""
    _verificar_item(item_id, db)

    anotacao = m.Anotacao(
        caixa_entrada_id=item_id,
        autor=usuario.nome or usuario.email or "Anônimo",
        texto=dados.texto.strip(),
    )
    db.add(anotacao)
    db.commit()
    db.refresh(anotacao)
    return anotacao


@router.delete("/{anotacao_id}", status_code=204)
def excluir_anotacao(
    item_id: int,
    anotacao_id: int,
    db: Session = Depends(get_db),
    usuario: UsuarioAutenticado = Depends(get_current_user),
):
    """Exclui uma anotação. Somente o autor pode excluir."""
    _verificar_item(item_id, db)
    anotacao = db.get(m.Anotacao, anotacao_id)
    if not anotacao or anotacao.caixa_entrada_id != item_id:
        raise HTTPException(status_code=404, detail="Anotação não encontrada")

    # Verificar se o usuário é o autor
    nome_usuario = usuario.nome or usuario.email or "Anônimo"
    if anotacao.autor != nome_usuario:
        raise HTTPException(status_code=403, detail="Somente o autor pode excluir esta anotação")

    db.delete(anotacao)
    db.commit()
