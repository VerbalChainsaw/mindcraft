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

if not exist "keys.json" goto MISSING_KEYS

node -e "const fs=require('fs');const keys=JSON.parse(fs.readFileSync('keys.json','utf8'));const has=Object.values(keys).some(v=>typeof v==='string'&&v.trim().length>0);if(!has){console.error('[ERROR] keys.json exists but has no API key values. Fill one of OPENAI_API_KEY, GEMINI_API_KEY, etc.');process.exit(1);}" 
if errorlevel 1 goto NO_KEYS

echo [2/4] Ensuring dependencies (this keeps dev-time patches available)...
set "NODE_ENV=development"
call npm install --no-audit --no-fund --progress=false
if errorlevel 1 goto INSTALL_FAIL

echo [3/4] Starting MindCraft UI on localhost:8080...
call npm start
if errorlevel 1 goto START_FAIL

goto DONE

:NO_NODE
echo [ERROR] Node.js not found in PATH.
echo Install Node.js LTS (v18 or v20), then reopen this window.
pause
exit /b 1

:MISSING_KEYS
echo [ERROR] keys.json is missing and could not be created.
echo Place a keys.json file in this directory and add at least one API key.
pause
exit /b 1

:NO_KEYS
echo [ERROR] No API key detected in keys.json.
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