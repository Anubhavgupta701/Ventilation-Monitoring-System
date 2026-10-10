@echo off
REM Mine Ventilation Monitoring Dashboard — one-click start (Windows)
REM Pehli baar: Node.js 18+ install hona chahiye (https://nodejs.org)

title Mine Ventilation Dashboard
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js nahi mila. Pehle https://nodejs.org se Node.js 18+ install karo.
  pause
  exit /b 1
)

if not exist "server\node_modules" (
  echo [1/3] Packages install ho rahe hain (pehli baar 2-4 min lag sakte hain)...
  call npm run install:all
  if errorlevel 1 (
    echo [ERROR] Install fail ho gaya.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Packages pehle se installed hain, skip.
)

echo [2/3] Database seed ho rahi hai...
call npm run seed

echo [3/3] Server start ho raha hai...
echo.
echo   Dashboard: http://localhost:5174
echo   Login: admin / admin123
echo.
echo   Band karne ke liye Ctrl+C dabao.
echo.
call npm run dev
pause
