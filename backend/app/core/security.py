"""Autenticação via Microsoft Entra ID (validação do token na API).

Em desenvolvimento local, deixe AUTH_ENABLED=false no .env para acessar a API
sem token (retorna um usuário de desenvolvimento). Em produção, AUTH_ENABLED=true
faz a API validar o token JWT emitido pelo Entra ID.
"""
import os
from typing import TYPE_CHECKING

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from pydantic import BaseModel

from app.api.deps import get_db

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

AUTH_ENABLED = os.getenv("AUTH_ENABLED", "false").lower() == "true"
TENANT_ID = os.getenv("ENTRA_TENANT_ID", "")
AUDIENCE = os.getenv("ENTRA_API_AUDIENCE", "")

# ==============================================================================
# Perfis de acesso (Documentação de Negócio v3.0)
#
# O documento define seis perfis com atribuições distintas. Antes existiam só
# "analista" e "coordenador"; os demais eram tratados como analista, o que
# impedia separar quem instrui, quem decide e quem aplica cautelar.
# ==============================================================================
PERFIL_ANALISTA = "analista"
PERFIL_CHEFE_SERVICO = "chefe_servico"
PERFIL_CHEFE_DIVISAO = "chefe_divisao"
PERFIL_COORDENADOR = "coordenador"
PERFIL_COORDENADOR_GERAL = "coordenador_geral"
PERFIL_CONSULTORIA_JURIDICA = "consultoria_juridica"

#: Rótulos para exibição, na ordem hierárquica.
PERFIS: dict[str, str] = {
    PERFIL_ANALISTA: "Conferente / Analista",
    PERFIL_CHEFE_SERVICO: "Chefe de Serviço",
    PERFIL_CHEFE_DIVISAO: "Chefe de Divisão",
    PERFIL_COORDENADOR: "Coordenador",
    PERFIL_COORDENADOR_GERAL: "Coordenador Geral",
    PERFIL_CONSULTORIA_JURIDICA: "Consultoria Jurídica",
}

#: Perfis da Coordenação. A aplicação de cautelar é exclusiva do Coordenador
#: Geral (art. 62, § único), por isso os dois níveis ficam separados.
PERFIS_COORDENACAO = frozenset({PERFIL_COORDENADOR, PERFIL_COORDENADOR_GERAL})

#: Chefias. Conduzem a instrução e redistribuem trabalho na equipe.
PERFIS_CHEFIA = frozenset({PERFIL_CHEFE_SERVICO, PERFIL_CHEFE_DIVISAO})

# Nomes de app role do Entra ID que concedem cada perfil. Aceita a forma curta,
# a capitalizada e a prefixada com "CPSAR." porque as três aparecem nos
# cadastros de aplicação já feitos.
def _variacoes(*nomes: str) -> frozenset[str]:
    saida: set[str] = set()
    for nome in nomes:
        saida.update({nome, nome.capitalize(), nome.title(), f"CPSAR.{nome}", f"CPSAR.{nome.title()}"})
    return frozenset(saida)


ROLES_POR_PERFIL: dict[str, frozenset[str]] = {
    PERFIL_COORDENADOR_GERAL: _variacoes("coordenador_geral", "coordenadorgeral", "CoordenadorGeral"),
    PERFIL_COORDENADOR: _variacoes("coordenador"),
    PERFIL_CHEFE_DIVISAO: _variacoes("chefe_divisao", "chefedivisao", "ChefeDivisao"),
    PERFIL_CHEFE_SERVICO: _variacoes("chefe_servico", "chefeservico", "ChefeServico"),
    PERFIL_CONSULTORIA_JURIDICA: _variacoes(
        "consultoria_juridica", "consultoriajuridica", "ConsultoriaJuridica"
    ),
    PERFIL_ANALISTA: _variacoes("analista", "conferente"),
}

# Mantido pelo nome antigo: era o conjunto usado antes de existirem os seis
# perfis, e continua a valer para quem edita os textos-padrão.
ROLES_COORDENADOR = ROLES_POR_PERFIL[PERFIL_COORDENADOR] | ROLES_POR_PERFIL[PERFIL_COORDENADOR_GERAL]

_bearer = HTTPBearer(auto_error=False)


class UsuarioAutenticado(BaseModel):
    email: str | None = None
    nome: str | None = None
    roles: list[str] = []


def get_current_user(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> UsuarioAutenticado:
    # Modo desenvolvimento: sem token, libera com usuário fictício.
    if not AUTH_ENABLED:
        return UsuarioAutenticado(email="dev@local", nome="Desenvolvimento", roles=["dev"])

    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token de acesso ausente.")

    try:
        jwks = PyJWKClient(
            f"https://login.microsoftonline.com/{TENANT_ID}/discovery/v2.0/keys"
        )
        chave = jwks.get_signing_key_from_jwt(cred.credentials)
        claims = jwt.decode(
            cred.credentials,
            chave.key,
            algorithms=["RS256"],
            audience=AUDIENCE,
            issuer=f"https://login.microsoftonline.com/{TENANT_ID}/v2.0",
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Token invalido: {exc}")

    return UsuarioAutenticado(
        email=claims.get("preferred_username") or claims.get("upn"),
        nome=claims.get("name"),
        roles=claims.get("roles", []),
    )


def _emails_coordenadores() -> set[str]:
    """Coordenadores listados no ``.env`` (``COORDENADORES``).

    Serve enquanto os app roles do Entra ID não estiverem publicados: sem esta
    saída, ninguém conseguiria editar os textos-padrão em produção.
    """
    bruto = os.getenv("COORDENADORES", "")
    return {parte.strip().lower() for parte in bruto.split(",") if parte.strip()}


def e_coordenador(usuario: UsuarioAutenticado, db: "Session | None" = None) -> bool:
    """Diz se o usuário pode editar os textos-padrão.

    Três caminhos, nessa ordem: app role do Entra ID, lista ``COORDENADORES`` do
    ``.env`` e a coluna ``perfil`` da tabela ``usuario``.

    Em desenvolvimento (``AUTH_ENABLED=false``) libera, como o resto da API.
    Com autenticação ligada e nenhuma das três fontes configurada, **nega** —
    é preferível o coordenador pedir a liberação a qualquer pessoa autenticada
    poder trocar o texto de um ato oficial.
    """
    if not AUTH_ENABLED:
        return True

    if ROLES_COORDENADOR & set(usuario.roles or []):
        return True

    email = (usuario.email or "").strip().lower()
    if email and email in _emails_coordenadores():
        return True

    if db is not None and email:
        from app.db import models as m

        registro = (
            db.query(m.Usuario)
            .filter(m.Usuario.email.ilike(email), m.Usuario.ativo.is_(True))
            .first()
        )
        if registro and (registro.perfil or "").strip().lower() == PERFIL_COORDENADOR:
            return True

    return False


def exigir_coordenador(
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db: "Session" = Depends(get_db),
) -> UsuarioAutenticado:
    """Dependência que barra quem não é coordenador."""
    if not e_coordenador(usuario, db):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Apenas o perfil de coordenação pode consultar e editar os "
            "textos-padrão.",
        )
    return usuario


# ==============================================================================
# Resolução de perfil e permissões por tela (Documentação de Negócio v3.0)
# ==============================================================================


def perfil_do_usuario(usuario: UsuarioAutenticado, db: "Session | None" = None) -> str:
    """Perfil efetivo do usuário, resolvido na mesma ordem de ``e_coordenador``.

    App role do Entra ID, depois a lista ``COORDENADORES`` do ``.env``, depois a
    coluna ``perfil`` da tabela ``usuario``. Sem nenhuma das três, vale
    ``analista`` — o menor privilégio.

    Em desenvolvimento (``AUTH_ENABLED=false``) devolve Coordenador Geral, para
    a tela mostrar tudo sem exigir cadastro, como o resto da API já faz.
    """
    if not AUTH_ENABLED:
        return PERFIL_COORDENADOR_GERAL

    papeis = set(usuario.roles or [])
    # Percorre do maior para o menor privilégio: quem acumula papéis fica com o
    # mais alto, senão um coordenador que também é analista perderia acesso.
    for perfil in (
        PERFIL_COORDENADOR_GERAL,
        PERFIL_COORDENADOR,
        PERFIL_CHEFE_DIVISAO,
        PERFIL_CHEFE_SERVICO,
        PERFIL_CONSULTORIA_JURIDICA,
        PERFIL_ANALISTA,
    ):
        if ROLES_POR_PERFIL[perfil] & papeis:
            return perfil

    email = (usuario.email or "").strip().lower()
    if email and email in _emails_coordenadores():
        return PERFIL_COORDENADOR

    if db is not None and email:
        from app.db import models as m

        registro = (
            db.query(m.Usuario)
            .filter(m.Usuario.email.ilike(email), m.Usuario.ativo.is_(True))
            .first()
        )
        if registro:
            gravado = (registro.perfil or "").strip().lower()
            if gravado in PERFIS:
                return gravado

    return PERFIL_ANALISTA


def e_coordenacao(usuario: UsuarioAutenticado, db: "Session | None" = None) -> bool:
    """Coordenador ou Coordenador Geral."""
    return perfil_do_usuario(usuario, db) in PERFIS_COORDENACAO


def e_coordenador_geral(usuario: UsuarioAutenticado, db: "Session | None" = None) -> bool:
    """Só o Coordenador Geral aplica, renova e revoga medida cautelar."""
    return perfil_do_usuario(usuario, db) == PERFIL_COORDENADOR_GERAL


def pode_priorizar(usuario: UsuarioAutenticado, db: "Session | None" = None) -> bool:
    """Quem pode marcar um processo como prioritário para a equipe (★).

    O documento é ambíguo: nas regras transversais a priorização é "exclusiva da
    Coordenação", mas a descrição da coluna ★ da tela de prazos diz
    "coordenadores e chefes de divisão e serviço". Seguimos a segunda, mais
    específica quanto a quem — negar à chefia travaria o trabalho dela. **Ponto
    a confirmar com a área.**
    """
    return perfil_do_usuario(usuario, db) in (PERFIS_COORDENACAO | PERFIS_CHEFIA)


def pode_redistribuir(usuario: UsuarioAutenticado, db: "Session | None" = None) -> bool:
    """Atribuir/redistribuir prazos e processos entre a equipe: chefia para cima.

    O analista continua podendo atribuir a si próprio — isso é verificado em
    quem chama, comparando o destino com o próprio usuário.
    """
    return perfil_do_usuario(usuario, db) in (PERFIS_COORDENACAO | PERFIS_CHEFIA)


def exigir_coordenador_geral(
    usuario: UsuarioAutenticado = Depends(get_current_user),
    db: "Session" = Depends(get_db),
) -> UsuarioAutenticado:
    """Dependência para as ações de competência exclusiva do Coordenador Geral."""
    if not e_coordenador_geral(usuario, db):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Ação de competência exclusiva do Coordenador Geral "
            "(art. 62, parágrafo único, da Lei 10.177/1998).",
        )
    return usuario
