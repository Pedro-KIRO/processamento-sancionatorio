@echo off
title CPSAR Dev

:: Ponto de entrada do dia a dia no Windows -- e o que o atalho "CPSAR Dev" da
:: area de trabalho chama.
::
:: ATENCAO: este script existe apenas durante a transicao. O padrao da
:: plataforma manda rodar tudo dentro do WSL, via scripts/dev-start.sh. Quando o
:: ambiente WSL estiver pronto, este arquivo sai junto com os outros .bat.
::
:: Topologia:
::   Vite (5173) --/api--> NestJS (3001) --nao portado--> FastAPI (8080)
::
:: A porta 8080 tem que casar com LEGACY_API_URL no .env. Se mudar aqui, mude
:: lah tambem: a tela abre normalmente e nenhuma chamada de API responde, o que
:: aparece como "a tela nao carrega".
::
:: Encerra sobras antes de subir. Sem isso, clicar duas vezes no atalho deixava
:: processos disputando as mesmas portas, e o segundo par subia em porta
:: diferente sem avisar.
call "%~dp0parar_site.bat" silencioso

:: %~dp0 e a pasta deste arquivo (com barra no fim), para o script continuar
:: funcionando se o projeto mudar de lugar.
start "CPSAR Legado (FastAPI 8080)" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload"

start "CPSAR API (NestJS 3001)" cmd /k "cd /d %~dp0 && npm run dev:api"

start "CPSAR Frontend (Vite 5173)" cmd /k "cd /d %~dp0 && npm run dev:web"

timeout /t 8 /nobreak >nul
start "" "http://localhost:5173"
exit
