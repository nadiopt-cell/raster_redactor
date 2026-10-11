@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ====================================================
echo   Редактор сканов карт - установка зависимостей
echo ====================================================
echo.

rem --- 1. Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Node.js не найден.
  echo Установите Node.js LTS с сайта https://nodejs.org/ и запустите install.bat снова.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
echo [OK] Node.js !NODE_VER!

rem --- Требования Vite 7: Node 20.19+ или 22.12+ ---
node -e "const v=process.versions.node.split('.').map(Number);process.exit((v[0]>22||(v[0]===22&&v[1]>=12)||(v[0]===20&&v[1]>=19))?0:1)" 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Требуется Node.js 20.19+ или 22.12+. Лучше поставьте свежий LTS с https://nodejs.org/
  echo Сейчас установлен: !NODE_VER!
  pause
  exit /b 1
)

rem --- 2. pnpm 10 ---
set "PNPM_OK=0"
where pnpm >nul 2>nul
if not errorlevel 1 (
  for /f "delims=" %%v in ('pnpm -v') do set "PNPM_VER=%%v"
  if "!PNPM_VER:~0,3!"=="10." set "PNPM_OK=1"
  echo [OK] pnpm !PNPM_VER!
)
if "!PNPM_OK!"=="0" (
  echo Устанавливаю pnpm 10 через npm...
  call npm install -g pnpm@10
  if errorlevel 1 (
    echo [ОШИБКА] Не удалось установить pnpm. Проверьте интернет и права доступа.
    pause
    exit /b 1
  )
  for /f "delims=" %%v in ('pnpm -v') do set "PNPM_VER=%%v"
  echo [OK] pnpm !PNPM_VER!
)

rem --- 3. Зависимости монорепозитория ---
echo.
echo Устанавливаю зависимости монорепозитория. Это может занять несколько минут...
echo.
call pnpm install
if errorlevel 1 (
  echo [ОШИБКА] pnpm install завершился с ошибкой, подробности выше.
  pause
  exit /b 1
)

rem --- 4. Production-сборка редактора ---
echo.
echo Собираю production-версию редактора...
echo.
call pnpm --filter @workspace/map-scan-repair build
if errorlevel 1 (
  echo [ОШИБКА] Сборка не удалась, подробности выше.
  pause
  exit /b 1
)

echo.
echo ====================================================
echo   Готово. Для запуска редактора используйте start.bat
echo ====================================================
echo.
pause
