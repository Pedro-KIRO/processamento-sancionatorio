@echo off
:: Inicia os servicos com as janelas minimizadas e abre o navegador.
:: Variante silenciosa do dev.bat, para quando nao se quer as janelas de cmd na
:: frente. A desvantagem: se algo falhar, a mensagem fica escondida na janela
:: minimizada -- para diagnosticar, prefira o dev.bat.
::
:: ATENCAO: existe apenas durante a transicao. O padrao da plataforma manda
:: rodar tudo dentro do WSL, via scripts/dev-start.sh.
::
:: Topologia:
::   Vite (5173) --/api--> NestJS (3001) --nao portado--> FastAPI (8080)
::
:: A porta 8080 e obrigatoria e tem que casar com LEGACY_API_URL no .env. Antes
:: este script omitia --port, o uvicorn subia na 8000 e nenhuma chamada de API
:: respondia.

:: Encerra o que estiver rodando (por porta, que e o unico jeito confiavel:
:: taskkill por titulo de janela nao alcanca processo iniciado de outro jeito).
call "%~dp0parar_site.bat" silencioso

start "" /min cmd /c "title Backend legado (FastAPI 8080) && cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload"

start "" /min cmd /c "title API (NestJS 3001) && cd /d %~dp0 && npm run dev:api"

start "" /min cmd /c "title Frontend (Vite 5173) && cd /d %~dp0 && npm run dev:web"

timeout /t 8 /nobreak >nul
start http://localhost:5173
