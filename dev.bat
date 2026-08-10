@echo off
title CPSAR Dev

:: Ponto de entrada do dia a dia -- e o que o atalho "CPSAR Dev" da area de
:: trabalho chama. Sobe o backend na 8080, o Vite na 5173 e abre o navegador.
::
:: A porta 8080 tem que casar com o proxy em frontend/vite.config.ts. Se mudar
:: aqui, mude lah tambem: a tela abre normalmente e nenhuma chamada de API
:: responde, o que aparece como "a tela nao carrega".
::
:: Encerra sobras antes de subir. Sem isso, clicar duas vezes no atalho deixava
:: dois uvicorn e dois Vite disputando as mesmas portas, e o segundo par subia
:: em porta diferente sem avisar.
call "%~dp0parar_site.bat" silencioso

:: %~dp0 e a pasta deste arquivo (com barra no fim), para o script continuar
:: funcionando se o projeto mudar de lugar. Sem aspas porque o caminho atual nao
:: tem espacos e o cmd /k nao lida bem com aspas aninhadas.
start "CPSAR Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload"

start "CPSAR Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"
exit
