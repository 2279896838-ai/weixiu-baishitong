@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo   Weixiu Baishitong - Demo Launcher
echo ============================================
python --version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python 3 not found in PATH.
  echo Install Python 3 from https://www.python.org/downloads/ and retry.
  pause
  exit /b 1
)
if /i "%~1"=="--check" (
  echo CHECK OK
  exit /b 0
)
echo [1/3] Stopping old server on port 8787 if any ...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8787" ^| findstr "LISTENING"') do taskkill /PID %%p /F >nul 2>nul
echo [2/3] Starting local server on port 8787 ...
start "Weixiu Baishitong Server" cmd /k "python demo\server.py --port 8787"
timeout /t 3 /nobreak >nul
echo [3/3] Opening browser ...
start "" "http://127.0.0.1:8787"
echo.
echo Console:    http://127.0.0.1:8787
echo Agent:      http://127.0.0.1:8787/agent
echo If /agent returns NOT_FOUND, close all server windows and rerun this script.
echo.
pause
