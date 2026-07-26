@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title MindCraft Launcher

where node >nul 2>nul
if errorlevel 1 goto NO_NODE

echo [1/4] Checking keys.json...
if not exist "keys.json" (
    if exist "keys.example.json" copy /Y "keys.example.json" "keys.json" >nul
)

REM Keys are NOT required to boot: the web UI has an API Keys card in the
REM Setup Wizard and the dashboard health banner explains what's missing.
node -e "try{const fs=require('fs');const keys=JSON.parse(fs.readFileSync('keys.json','utf8'));const has=Object.values(keys).some(v=>typeof v==='string'&&v.trim().length>0);if(!has)process.exit(1);}catch(e){process.exit(1);}"
if errorlevel 1 (
    echo [WARN] No API key detected yet. The UI will still start.
    echo        Add a key in the browser: Setup Wizard - API Keys card.
)

echo [2/4] Ensuring dependencies...
if exist "node_modules\mineflayer\package.json" (
    echo        node_modules present - skipping npm install. Delete node_modules to force reinstall.
) else (
    set "NODE_ENV=development"
    call npm install --no-audit --no-fund --progress=false
    if errorlevel 1 goto INSTALL_FAIL
)

echo [3/4] Starting MindCraft UI (port auto-selected, browser opens automatically)...
call npm start
if errorlevel 1 goto START_FAIL

goto DONE

:NO_NODE
echo [ERROR] Node.js not found in PATH.
echo Install Node.js LTS (v18 or v20), then reopen this window.
pause
exit /b 1

:INSTALL_FAIL
echo [ERROR] npm install failed. Check internet and package install logs.
pause
exit /b 1

:START_FAIL
echo [ERROR] MindCraft exited with an error. If this persists, run from shell:
echo    node main.js --help
pause
exit /b 1

:DONE
