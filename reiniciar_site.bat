@echo off
title CPSAR Reiniciar

:: Use este atalho quando a pagina abrir com a tela escura cheia de texto de
:: erro, ou quando as alteracoes nao aparecerem por mais que recarregue.
::
:: Aquela tela escura e o aviso de erro do Vite, o servidor de desenvolvimento:
:: ele nao conseguiu compilar algum arquivo e mostra a mensagem por cima da
:: pagina. Normalmente se resolve sozinho, mas quando o problema pega arquivo de
:: configuracao (vite.config.ts, tailwind.config.js) ou o cache de dependencias
:: dele, so reiniciar o processo resolve -- era por isso que fechar as janelas de
:: cmd e abrir de novo funcionava.

echo ======================================================
echo    CPSAR - reiniciando o site
echo ======================================================
echo.

echo [1/3] Parando backend e frontend...
call "%~dp0parar_site.bat" silencioso

echo [2/3] Limpando o cache do Vite...
:: node_modules\.vite guarda as dependencias ja compiladas. Quando esse cache
:: fica inconsistente, o navegador recebe pedaco antigo com pedaco novo e a tela
:: de erro volta a cada recarga. Apagar custa alguns segundos na primeira
:: abertura e evita o diagnostico errado de "a alteracao nao foi aplicada".
if exist "%~dp0frontend\node_modules\.vite" (
    rmdir /s /q "%~dp0frontend\node_modules\.vite"
    echo      cache removido.
) else (
    echo      nada a limpar.
)

echo [3/3] Subindo tudo de novo...
echo.
call "%~dp0dev.bat"
