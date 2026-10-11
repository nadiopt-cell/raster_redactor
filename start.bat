@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem Порт можно переопределить перед запуском: set PORT=8080
if "%PORT%"=="" set "PORT=3000"

echo ====================================================
echo   Редактор сканов карт - запуск
echo ====================================================
echo.

where pnpm >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] pnpm не найден. Сначала запустите install.bat
  pause
  exit /b 1
)

rem Необязательный аргумент: start.bat dev  -  режим разработки с хот-перезагрузкой
if /i "%~1"=="dev" goto :dev

rem --- Production-режим: сборка при необходимости, затем локальный сервер ---
if not exist "artifacts\map-scan-repair\dist\public\index.html" (
  echo Production-сборка не найдена - собираю. Это займёт около минуты...
  call pnpm --filter @workspace/map-scan-repair build
  if errorlevel 1 (
    echo [ОШИБКА] Сборка не удалась. Попробуйте сначала запустить install.bat
    pause
    exit /b 1
  )
)

netstat -ano | find ":%PORT% " | find "LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo [ОШИБКА] Порт %PORT% уже занят другим процессом.
  echo Закройте его или задайте другой порт и запустите заново:
  echo   set PORT=8080
  echo   start.bat
  pause
  exit /b 1
)

echo.
echo Запускаю сервер: http://localhost:%PORT%
echo Остановить сервер: Ctrl+C в этом окне.
echo Если Windows спросит про брандмауэр - разрешите доступ.
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:%PORT%"
call pnpm --filter @workspace/map-scan-repair serve
goto :eof

:dev
echo.
echo Режим разработки: http://localhost:%PORT%
echo Остановить сервер: Ctrl+C в этом окне.
echo Если Windows спросит про брандмауэр - разрешите доступ.
echo.
start "" cmd /c "timeout /t 6 /nobreak >nul & start "" http://localhost:%PORT%"
call pnpm --filter @workspace/map-scan-repair dev
goto :eof
