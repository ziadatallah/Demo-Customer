@echo off
findstr /C:"edition" "%~dp0EDITION.json" | findstr /C:"demo" >nul 2>&1
if not errorlevel 1 (
    title Demo ISAF
    echo.
    echo   Demo ISAF v5.3.38
    echo   SOI 1 Demonstration App
    echo.
) else (
    title ISAF (Integrated Standards Assurance Framework)
    echo.
    echo   ISAF (Integrated Standards Assurance Framework) v5.3.38
    echo   Certification Document Generation Engine
    echo.
)

cd /d "%~dp007_Web_Service"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   Node.js is not installed.
    echo   Download it from https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo   Node.js %%i

if not exist "node_modules" (
    echo.
    echo   First run - installing dependencies...
    npm install --production
    echo.
)

echo.
echo   Starting server...
echo   Open your browser to: http://localhost:3000
echo.
echo   Press Ctrl+C to stop the server.
echo.

start "" http://localhost:3000
node server.js
pause
