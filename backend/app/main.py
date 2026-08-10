"""Aplicação FastAPI do backend de Processamento Sancionatório (CPSAR)."""
import os
from pathlib import Path

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.routes import anotacoes, advogados, auditoria, biblioteca, busca, caixa_entrada, cautelares, consulta_unificada, despachos, documentos, exportacao, fases, health, me, notificacoes, prazos, processos_andamento, recursos, textos_padroes, usuarios
from app.services import auditoria as trilha_auditoria


def _registrar_na_trilha(request: Request, db: Session = Depends(get_db)) -> None:
    """Grava na trilha de auditoria toda requisição que altera dados.

    É dependência global (e não middleware) por dois motivos: usa a **mesma
    sessão** da rota, respeitando o override de ``get_db`` nos testes, e não
    abre uma segunda conexão por requisição.

    Roda antes do endpoint, então registra a ação tentada. Isso é proposital:
    para auditoria, uma tentativa recusada por falta de permissão importa tanto
    quanto uma concluída.
    """
    caminho = request.url.path
    if not trilha_auditoria.deve_auditar(request.method, caminho):
        return

    usuario = None
    try:
        from fastapi.security import HTTPAuthorizationCredentials

        from app.core.security import AUTH_ENABLED, get_current_user

        if not AUTH_ENABLED:
            usuario = "dev@local"
        else:
            cabecalho = request.headers.get("authorization") or ""
            if cabecalho.lower().startswith("bearer "):
                usuario = get_current_user(
                    HTTPAuthorizationCredentials(
                        scheme="Bearer", credentials=cabecalho.split(" ", 1)[1]
                    )
                ).email
    except Exception:  # noqa: BLE001 - token inválido não impede o registro
        usuario = None

    trilha_auditoria.registrar(db, usuario, request.method, caminho)


app = FastAPI(
    title="Processamento Sancionatório CPSAR - API",
    version="0.1.0",
    # Trilha de auditoria exigida pela Documentação de Negócio v3.0: aplicada a
    # todas as rotas de uma vez, para endpoint novo não escapar da trilha por
    # esquecimento de quem o escreveu.
    dependencies=[Depends(_registrar_na_trilha)],
)


import logging
import traceback
from fastapi import Request
from fastapi.responses import JSONResponse

_logger = logging.getLogger("app")


@app.exception_handler(Exception)
async def _handler_generico(request: Request, exc: Exception):
    _logger.error("Erro não tratado em %s %s:\n%s", request.method, request.url.path, traceback.format_exc())
    return JSONResponse(status_code=500, content={"detail": str(exc)})

_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000,*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _origins if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)




# ==============================================================================
# Rotas da API — todas sob /api.
#
# O prefixo não é enfeite: sem ele, o endereço da tela e o da API são o mesmo
# texto. `/cautelares` era ao mesmo tempo a tela e a lista de dados, e como os
# routers são registrados antes do catch-all da SPA, quem respondia era a API.
# Efeito para o usuário: apertar F5 em oito telas mostrava JSON cru no lugar do
# app. Com o prefixo a colisão deixa de existir por construção.
#
# Endpoint novo entra aqui dentro. Se ficar fora, `tests/test_prefixo_api.py`
# falha — é a trava que garante que ninguém (inclusive eu) esqueça.
# ==============================================================================
API_PREFIXO = "/api"

api = APIRouter(prefix=API_PREFIXO)
api.include_router(health.router)
api.include_router(auditoria.router)
api.include_router(me.router)
api.include_router(caixa_entrada.router)
api.include_router(anotacoes.router)
api.include_router(documentos.router)
api.include_router(despachos.router)
api.include_router(processos_andamento.router)
api.include_router(prazos.router)
api.include_router(recursos.router)
api.include_router(fases.router)
api.include_router(notificacoes.router)
api.include_router(exportacao.router)
api.include_router(busca.router)
api.include_router(consulta_unificada.router)
api.include_router(cautelares.router)
api.include_router(textos_padroes.router)
api.include_router(usuarios.router)
api.include_router(advogados.router)
api.include_router(biblioteca.router)
app.include_router(api)


# ==============================================================================
# Servir frontend estático (build do Vite) quando disponível.
# Para ativar: faça `npm run build` no frontend e copie a pasta `dist/` para
# `backend/static/`. O FastAPI serve os arquivos + fallback para index.html
# (SPA routing).
# ==============================================================================
_STATIC_DIR = Path(__file__).parent.parent / "static"

if _STATIC_DIR.is_dir():
    from fastapi.responses import FileResponse
    from starlette.responses import Response

    # Servir assets estáticos (JS, CSS, imagens)
    app.mount("/assets", StaticFiles(directory=str(_STATIC_DIR / "assets")), name="assets")

    # Catch-all da SPA: qualquer endereço que não seja /api/* devolve o
    # index.html, e o React Router resolve no navegador. É o que faz o F5 e o
    # link direto funcionarem em /cautelares, /prazos e nas demais telas.
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        # /api/* que chega aqui é rota inexistente, não endereço de tela.
        # Sem isto, um erro de digitação no caminho da API receberia o
        # index.html com status 200 e o problema apareceria como "a tela não
        # carrega os dados", em vez de um 404 claro.
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Rota não encontrada.")

        # Se o arquivo existe em static/, serve ele (favicon, manifest, etc.)
        arquivo = _STATIC_DIR / full_path
        if full_path and arquivo.is_file():
            resp = FileResponse(str(arquivo))
        else:
            # Senão, retorna index.html (React Router cuida do resto)
            resp = FileResponse(str(_STATIC_DIR / "index.html"))
        # Evitar cache do navegador para garantir versão atualizada
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp
