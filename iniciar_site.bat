@echo off
:: Inicia backend e frontend com as janelas minimizadas e abre o navegador.
:: Variante silenciosa do dev.bat, para quando nao se quer as janelas de cmd na
:: frente. A desvantagem: se algo falhar, a mensagem fica escondida na janela
:: minimizada -- para diagnosticar, prefira o dev.bat.
::
:: A porta 8080 e obrigatoria e tem que casar com o proxy do
:: frontend/vite.config.ts. Antes este script omitia --port, o uvicorn subia na
:: 8000 e nenhuma chamada de API respondia.

:: Encerra o que estiver rodando (por porta, que e o unico jeito confiavel:
:: taskkill por titulo de janela nao alcanca processo iniciado de outro jeito).
call "%~dp0parar_site.bat" silencioso

start "" /min cmd /c "title Backend API && cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --reload"

start "" /min cmd /c "title Frontend Dev && cd /d %~dp0frontend && npm run dev"

timeout /t 5 /nobreak >nul
start http://localhost:5173
