@echo off
setlocal
cd /d "%~dp0"
title Atlas 1.7.4 Alpha - Criar instalador
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
  call "%NODE_HOME%\npm.cmd" run tauri:build
) else (
  call npm.cmd run tauri:build
)
if errorlevel 1 goto build_error
echo.
echo Build concluido. O instalador deve estar em src-tauri\target\release\bundle\nsis\
pause
goto end
:install_error
echo Falha ao instalar dependencias JavaScript.
pause
exit /b 1
:build_error
echo Falha ao compilar. Confira o LEIA-ME.md e a mensagem acima.
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
