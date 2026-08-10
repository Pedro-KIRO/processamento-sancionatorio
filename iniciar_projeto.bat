@echo off
title Processamento Sancionatorio - Backend

echo ======================================================
echo    Processamento Sancionatorio CPSAR
echo    Iniciando servidor...
echo ======================================================
echo.

cd /d "%~dp0backend"

:: Ativa o ambiente virtual
call .venv\Scripts\activate.bat

:: Verifica se a porta 8080 ja esta em uso por outro processo nosso
netstat -ano | findstr ":8080 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [!] A porta 8080 ja esta em uso.
    echo     Pode ser que o backend ja esta rodando.
    echo     Abrindo o navegador...
    echo.
    timeout /t 2 /nobreak >nul
    start "" "http://localhost:8080"
    echo Pressione qualquer tecla para fechar esta janela.
    pause >nul
    exit /b
)

:: Abre o navegador apos 4 segundos (em paralelo)
start "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:8080"

echo [OK] Subindo o servidor na porta 8080...
echo [OK] O navegador abrira em instantes.
echo.
echo ------------------------------------------------------
echo  Para parar: feche esta janela ou pressione Ctrl+C
echo ------------------------------------------------------
echo.

:: Sobe o backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8080

:: Se chegou aqui, o uvicorn parou
echo.
echo [X] O servidor parou. Pressione qualquer tecla para fechar.
pause >nul
