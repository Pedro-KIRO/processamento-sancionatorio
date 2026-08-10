@echo off
REM === Script de deploy para teste local ===
REM Faz build do frontend e copia para backend/static/ para servir tudo junto.
REM Após rodar, inicie com: backend\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
REM Os usuários acessam: http://SEU-IP:8000

echo [1/3] Fazendo build do frontend...
cd frontend
set VITE_API_URL=
call npm run build
if errorlevel 1 (
    echo ERRO no build do frontend!
    pause
    exit /b 1
)

echo [2/3] Copiando build para backend/static/...
cd ..
if exist backend\static rmdir /s /q backend\static
xcopy /e /i /q frontend\dist backend\static

echo [3/3] Pronto! Inicie o servidor com:
echo.
echo   cd backend
echo   .venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
echo.
echo Os usuarios acessam: http://SEU-IP:8000
echo (descubra seu IP com: ipconfig)
echo.
pause
