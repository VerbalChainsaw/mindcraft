@echo off
REM Emergency cleanup: kills every node.exe running from this folder tree.
REM Use if "Full Shutdown" in the UI left orphaned processes behind.
echo Stopping all Mindcraft node processes...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*minecraft-companion*' } | ForEach-Object { Write-Host ('  killing PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Done.
pause
