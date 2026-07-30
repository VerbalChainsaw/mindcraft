@echo off
REM Emergency cleanup: kills Mindcraft Node processes and its uniquely-addressed
REM managed Java server. The Java command uses this absolute jar path so this
REM does not touch unrelated Minecraft servers.
REM Use if "Full Shutdown" in the UI left orphaned processes behind.
echo Stopping Mindcraft and its managed Minecraft server...
powershell -NoProfile -Command "$managedJar=[IO.Path]::GetFullPath((Join-Path '%~dp0' 'server_data\managed-java\server.jar')); Get-CimInstance Win32_Process | Where-Object { ($_.Name -in @('java.exe','javaw.exe')) -and $_.CommandLine -like ('*' + $managedJar + '*') } | ForEach-Object { Write-Host ('  killing managed Java PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*minecraft-companion*' } | ForEach-Object { Write-Host ('  killing Mindcraft Node PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Done.
pause
