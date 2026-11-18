@echo off
chcp 65001 >nul
setlocal
set "ROOT=D:\greenhouse"
set "PORT=8090"

cd /d "%ROOT%"

netstat -ano | findstr /c:"LISTENING" | findstr /c:":%PORT% " >nul 2>nul
if %errorlevel%==0 (
  echo [1/2] Port %PORT% already listening, reuse it.
  goto open
)

echo [1/2] Starting local server on http://localhost:%PORT% ...

where py >nul 2>nul
if %errorlevel%==0 (
  start "greenhouse-server" /min py -3 -m http.server %PORT% --directory "%ROOT%"
  goto open
)

where node >nul 2>nul
if %errorlevel%==0 (
  start "greenhouse-server" /min node "%ROOT%\server.mjs" %PORT%
  goto open
)

echo Python or Node not found. Please install one of them and retry.
pause
exit /b 1

:open
timeout /t 2 >nul
echo [2/2] Opening big screen ...

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --kiosk --disable-pinch --overscroll-history-navigation=0 "http://localhost:%PORT%/web/index.html"
) else (
  start "" "http://localhost:%PORT%/web/index.html"
)
exit /b 0
