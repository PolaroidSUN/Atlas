@echo off
setlocal
cd /d "%~dp0"
title Atlas 1.7.4 Alpha - Desktop
set "NODE_HOME=C:\Program Files\nodejs"
if exist "%NODE_HOME%\node.exe" set "PATH=%NODE_HOME%;%PATH%"
where cargo >nul 2>nul
if errorlevel 1 goto rust_error
if not exist "node_modules\.bin\vite.cmd" goto install_deps
if not exist "node_modules\.bin\tauri.cmd" goto install_deps
goto dependencies_ready
:install_deps
echo Instalando dependencias JavaScript do Atlas. A primeira instalacao exige internet...
if exist "%NODE_HOME%\npm.cmd" (call "%NODE_HOME%\npm.cmd" install) else (call npm.cmd install)
if errorlevel 1 goto install_error
:dependencies_ready
if exist "%NODE_HOME%\npm.cmd" (
  call "%NODE_HOME%\npm.cmd" run tauri:dev
) else (
  call npm.cmd run tauri:dev
)
if errorlevel 1 goto desktop_error
goto end
:install_error
echo.
echo Falha ao instalar dependencias. Confira a mensagem acima.
pause
exit /b 1
:desktop_error
echo.
echo O Atlas desktop nao conseguiu iniciar. Verifique os pre-requisitos do Rust/Tauri no LEIA-ME.md.
pause
exit /b 1
:rust_error
echo.
echo Rust/Cargo nao foi encontrado. Instale Rust com rustup (toolchain stable-msvc), feche e abra o terminal e tente novamente.
echo Consulte LEIA-ME.md para os pre-requisitos do Tauri no Windows.
pause
exit /b 1
:end
endlocal
