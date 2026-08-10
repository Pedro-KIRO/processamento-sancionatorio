@echo off
REM === Executa o levantamento semanal de processos ===
REM Agendado para toda sexta-feira via Agendador de Tarefas do Windows.
REM
REM Para agendar manualmente:
REM   1. Abra o Agendador de Tarefas (taskschd.msc)
REM   2. Criar Tarefa Basica
REM   3. Nome: "Levantamento Semanal Processos"
REM   4. Disparador: Semanalmente, Sexta-feira, horario desejado (ex: 17:00)
REM   5. Acao: Iniciar programa
REM   6. Programa: C:\Users\pedro.hsilva\Downloads\projeto_processamento\backend\agendar_levantamento_semanal.bat
REM   7. Iniciar em: C:\Users\pedro.hsilva\Downloads\projeto_processamento\backend
REM

cd /d C:\Users\pedro.hsilva\Downloads\projeto_processamento\backend
.venv\Scripts\python.exe levantamento_semanal.py

if errorlevel 1 (
    echo ERRO no levantamento semanal!
    echo %date% %time% - ERRO >> levantamento_semanal.log
) else (
    echo %date% %time% - OK >> levantamento_semanal.log
)
