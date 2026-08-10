"""Travas do prefixo /api.

Estes testes existem por causa de um bug que apareceu três vezes para o usuário:
apertar F5 na tela de Cautelares (e em sete outras) mostrava JSON cru no lugar
do app. A causa era o endereço da tela e o da API serem o mesmo texto —
``/cautelares`` era ao mesmo tempo a tela e a lista de dados — e, como os
routers são registrados antes do catch-all da SPA, quem respondia era a API.

A correção foi mover toda a API para ``/api``. Estes dois testes garantem que
ela não volte:

1. ``test_toda_rota_da_api_esta_sob_prefixo``: endpoint novo criado fora do
   prefixo derruba a suíte, com o nome do caminho na mensagem.
2. ``test_endereco_de_tela_nao_responde_dado_da_api``: se algum endereço de tela
   voltar a ser atendido pela API, o teste falha apontando qual.

O segundo depende de ``backend/static/`` existir (é lá que fica o build do
frontend). Quando não existe, o catch-all da SPA não é registrado e o teste é
pulado — mas o primeiro continua valendo, e é ele que impede a causa raiz.
"""
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import API_PREFIXO, app

#: Único caminho que existe fora do prefixo por natureza: o catch-all que serve a
#: SPA. A documentação gerada pelo FastAPI (/docs, /redoc, /openapi.json) e o
#: mount de /assets não entram no esquema, então não aparecem nesta conta.
FORA_DO_PREFIXO_POR_DESIGN = {"/{full_path}"}

#: Endereços das telas do app (ver frontend/src/App.tsx). Os oito primeiros são
#: exatamente os que colidiam com rotas da API antes do prefixo.
ROTAS_DA_SPA = [
    "/caixa-entrada",
    "/consulta-unificada",
    "/prazos",
    "/cautelares",
    "/textos-padroes",
    "/advogados",
    "/biblioteca",
    "/usuarios",
    "/processos",
    "/analise/1",
    "/processos/1",
]

_STATIC = Path(__file__).parent.parent / "static"


def test_toda_rota_da_api_esta_sob_prefixo():
    """Nenhuma rota da API pode ficar fora de /api.

    A conta sai do esquema OpenAPI, e **não** de ``app.routes``: nesta versão do
    FastAPI o ``include_router`` é preguiçoso e guarda um ``_IncludedRouter`` em
    vez de copiar os caminhos para a lista do app. Com ``app.routes`` a
    verificação encontrava 7 entradas, nenhuma delas de API, e portanto passava
    por vazio — dava a impressão de proteger sem proteger nada. O esquema expande
    os 107 caminhos reais.
    """
    caminhos = app.openapi()["paths"].keys()
    assert len(caminhos) > 50, (
        f"Só {len(caminhos)} caminhos no esquema: a verificação perdeu o alcance "
        "e passaria por vazio. Confira como as rotas são registradas no main.py."
    )

    fugitivas = sorted(
        c for c in caminhos
        if not c.startswith(API_PREFIXO) and c not in FORA_DO_PREFIXO_POR_DESIGN
    )
    assert not fugitivas, (
        f"Estas rotas ficaram fora de {API_PREFIXO}: {fugitivas}. Inclua o router "
        "em `api` no main.py — fora do prefixo o caminho colide com o endereço de "
        "uma tela e o F5 passa a devolver JSON."
    )


def test_prefixo_responde_de_fato():
    """Garante que o prefixo está montado, e não só declarado."""
    cliente = TestClient(app)
    assert cliente.get(f"{API_PREFIXO}/health").status_code == 200


def test_api_inexistente_devolve_404_e_nao_a_tela():
    """Caminho errado sob /api tem que dar 404, não index.html.

    Sem esta regra, um erro de digitação no caminho receberia o HTML da SPA com
    status 200, e o sintoma apareceria como "a tela não carrega os dados" em vez
    de um 404 claro.
    """
    if not _STATIC.is_dir():
        pytest.skip("catch-all da SPA só é registrado quando backend/static existe")

    resposta = TestClient(app).get(f"{API_PREFIXO}/rota-que-nao-existe")
    assert resposta.status_code == 404
    assert "text/html" not in resposta.headers.get("content-type", "")


@pytest.mark.parametrize("caminho", ROTAS_DA_SPA)
def test_endereco_de_tela_nao_responde_dado_da_api(caminho: str):
    """F5 e link direto nas telas têm que receber o app, não JSON."""
    if not _STATIC.is_dir():
        pytest.skip("catch-all da SPA só é registrado quando backend/static existe")

    resposta = TestClient(app).get(
        caminho, headers={"Accept": "text/html", "Sec-Fetch-Mode": "navigate"}
    )
    tipo = resposta.headers.get("content-type", "")
    assert resposta.status_code == 200, f"{caminho} respondeu {resposta.status_code}"
    assert "text/html" in tipo, (
        f"{caminho} devolveu {tipo!r} em vez do index.html. É a colisão entre "
        "endereço de tela e rota da API voltando: quem abrir esta tela e apertar "
        "F5 vai ver JSON cru."
    )
