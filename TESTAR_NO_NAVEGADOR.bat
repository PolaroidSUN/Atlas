@echo off
setlocal
cd /d "%~dp0"
title Atlas 1.7.4 Alpha - Teste de movimento de imagens

rem Garante que a pasta padrao do Node.js esteja no PATH desta janela.
set "NODE_HOME=C:\Program Files\nodejs"
if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"

rem Verifica o Node.js usando o caminho completo, se disponivel.
if exist "%NODE_HOME%\node.exe" (
  "%NODE_HOME%\node.exe" -v >nul 2>nul
  if errorlevel 1 goto node_error
) else (
  where node >nul 2>nul
  if errorlevel 1 goto node_error
)

rem Usa npm.cmd pelo caminho completo para evitar problemas de PATH.
if exist "%NODE_HOME%\npm.cmd" (
  set "NPM_CMD=%NODE_HOME%\npm.cmd"
) else (
  for /f "delims=" %%N in ('where npm.cmd 2^>nul') do if not defined NPM_CMD set "NPM_CMD=%%N"
)
if not defined NPM_CMD goto npm_error

if not exist "node_modules\.bin\vite.cmd" goto install_deps
if not exist "node_modules\@tiptap\react\package.json" goto install_deps
if not exist "node_modules\@xyflow\react\package.json" goto install_deps
if not exist "node_modules\@tauri-apps\api\package.json" goto install_deps
goto dependencies_ready

:install_deps
echo Instalando dependencias do Atlas. Isso pode levar alguns minutos...
call "%NPM_CMD%" install
if errorlevel 1 (
  echo.
  echo Falha ao instalar dependencias. Leia a mensagem de erro acima.
  echo Verifique a conexao e tente executar este arquivo novamente.
  pause
  exit /b 1
)

:dependencies_ready

rem Abre o servidor de desenvolvimento em uma janela separada.
start "Atlas - servidor" /D "%~dp0" cmd /k ""%NPM_CMD%" run dev"
timeout /t 3 >nul

rem Tenta abrir no Vivaldi; se nao encontrar, usa o navegador padrao do Windows.
if exist "%LOCALAPPDATA%\Vivaldi\Application\vivaldi.exe" (
  start "" "%LOCALAPPDATA%\Vivaldi\Application\vivaldi.exe" "http://127.0.0.1:1420"
  goto done
)
if exist "%ProgramFiles%\Vivaldi\Application\vivaldi.exe" (
  start "" "%ProgramFiles%\Vivaldi\Application\vivaldi.exe" "http://127.0.0.1:1420"
  goto done
)
if exist "%ProgramFiles(x86)%\Vivaldi\Application\vivaldi.exe" (
  start "" "%ProgramFiles(x86)%\Vivaldi\Application\vivaldi.exe" "http://127.0.0.1:1420"
  goto done
)
start "" "http://127.0.0.1:1420"
goto done

:node_error
echo Node.js nao conseguiu ser executado. Verifique a instalacao em C:\Program Files\nodejs.
pause
exit /b 1

:npm_error
echo npm.cmd nao foi encontrado. Verifique a instalacao do Node.js.
pause
exit /b 1

:done
endlocal
