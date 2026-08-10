# Registra a varredura SEI no Agendador de Tarefas do Windows (executa a cada 5 min).
# Uso: Execute este script como Administrador (ou com permissão para criar tarefas).
#   powershell -ExecutionPolicy Bypass -File registrar_tarefa.ps1

$NomeTarefa = "ProcessamentoSancionario_VarreduraSEI"
$PastaBackend = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$PythonExe = Join-Path $PastaBackend ".venv\Scripts\python.exe"
$Argumento = "-m automacoes.varredura_sei"

# Remove tarefa existente (se houver)
$existing = Get-ScheduledTask -TaskName $NomeTarefa -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false
    Write-Host "Tarefa anterior removida."
}

# Ação: executar python -m automacoes.varredura_sei
$Action = New-ScheduledTaskAction -Execute $PythonExe -Argument $Argumento -WorkingDirectory $PastaBackend

# Gatilho: a cada 5 minutos, repetindo indefinidamente
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)

# Configurações: permitir rodar com bateria, não parar se demorar
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

# Registrar (roda com o usuário atual, sem precisar de senha se logado)
Register-ScheduledTask -TaskName $NomeTarefa -Action $Action -Trigger $Trigger -Settings $Settings -Description "Varredura automática do SEI para o Processamento Sancionatório (a cada 5 min)" -RunLevel Limited

Write-Host ""
Write-Host "Tarefa '$NomeTarefa' registrada com sucesso!"
Write-Host "  Executa: $PythonExe $Argumento"
Write-Host "  Pasta:   $PastaBackend"
Write-Host "  Intervalo: a cada 5 minutos"
Write-Host ""
Write-Host "Para verificar: Get-ScheduledTask -TaskName '$NomeTarefa'"
Write-Host "Para remover:   Unregister-ScheduledTask -TaskName '$NomeTarefa'"
