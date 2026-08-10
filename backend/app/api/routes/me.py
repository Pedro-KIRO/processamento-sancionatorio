"""Rota do usuário autenticado (saudação e permissões do frontend)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.security import (
    PERFIS,
    UsuarioAutenticado,
    e_coordenacao,
    e_coordenador,
    e_coordenador_geral,
    get_current_user,
    perfil_do_usuario,
    pode_priorizar,
    pode_redistribuir,
)

router = APIRouter(tags=["usuario"])


class UsuarioResposta(UsuarioAutenticado):
    """O usuário com o que o frontend precisa saber para montar a tela.

    As permissões vêm resolvidas de uma vez para a tela não ter que deduzir
    regra a partir do perfil — a autorização de verdade continua nos endpoints;
    esconder botão é só para não oferecer o que vai ser recusado.
    """

    coordenador: bool = False
    perfil: str | None = None
    perfil_rotulo: str | None = None
    coordenacao: bool = False
    coordenador_geral: bool = False
    pode_priorizar: bool = False
    pode_redistribuir: bool = False


@router.get("/me", response_model=UsuarioResposta)
def me(
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UsuarioResposta:
    perfil = perfil_do_usuario(usuario, db)
    return UsuarioResposta(
        **usuario.model_dump(),
        coordenador=e_coordenador(usuario, db),
        perfil=perfil,
        perfil_rotulo=PERFIS.get(perfil),
        coordenacao=e_coordenacao(usuario, db),
        coordenador_geral=e_coordenador_geral(usuario, db),
        pode_priorizar=pode_priorizar(usuario, db),
        pode_redistribuir=pode_redistribuir(usuario, db),
    )
