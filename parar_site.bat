@echo off
:: Para os servidores do site: backend na 8080 e frontend (Vite) na 5173.
::
:: Este script tinha dois defeitos que o deixavam inofensivo:
::
:: 1) Matava a porta 8000, mas o backend roda na 8080.
:: 2) Lia a coluna 2 do netstat, que e o endereco local (ex.: "0.0.0.0:8080"),
::    e nao o PID. O taskkill recebia um endereco, falhava, e o erro ia para
::    >nul 2>&1 -- ou seja, ele nunca parou nada e nunca reclamou. O PID e a
::    coluna 5.
::
:: O filtro LISTENING nao e detalhe: nesta rede existem dezenas de conexoes de
:: saida para proxies que tambem usam a porta 8080. Sem o filtro, os PIDs delas
:: entrariam na conta e o script mataria programas que nao sao nossos. Linha
:: LISTENING sempre tem endereco remoto 0.0.0.0:0, entao o ":8080 " so pode ser
:: da porta local.
::
:: Chamado com qualquer argumento, termina sem perguntar nada (e o que o
:: dev.bat e o reiniciar_site.bat fazem).

call :matar 8080 Backend
call :matar 5173 Frontend

if "%~1"=="" (
    echo.
    echo Site parado.
    pause
)
exit /b

:matar
for /f "tokens=5" %%p in ('netstat -aon ^| findstr ":%~1 " ^| findstr LISTENING') do (
    taskkill /f /pid %%p >nul 2>&1
    if not errorlevel 1 echo [OK] %~2 encerrado na porta %~1 ^(pid %%p^).
)
exit /b
