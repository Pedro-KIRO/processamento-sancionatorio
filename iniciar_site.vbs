Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
basePath = fso.GetParentFolderName(WScript.ScriptFullName)

WshShell.Run Chr(34) & basePath & "\_iniciar_backend.bat" & Chr(34), 0, False
WScript.Sleep 3000
WshShell.Run Chr(34) & basePath & "\_iniciar_frontend.bat" & Chr(34), 0, False
WScript.Sleep 5000
WshShell.Run "http://localhost:5173", 1, False
