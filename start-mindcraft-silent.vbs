' Mindcraft silent launcher — runs start-mindcraft.bat with no console window.
' Double-click this (or a shortcut to it) instead of the .bat for a clean app feel.
' Logs still go to launcher.log next to this file.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
shell.Run "cmd /c ""start-mindcraft.bat > launcher.log 2>&1""", 0, False
