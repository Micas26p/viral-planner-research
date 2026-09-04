@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"

REM Adicionar Node portatil ao PATH se existir
if exist "%~dp0.node\node.exe" (
    set "PATH=%~dp0.node;%~dp0.node\node_modules\npm\bin;%PATH%"
)

REM Se o executavel Desktop existir, abre ele diretamente
if exist "%~dp0Viral Research.exe" (
    echo Iniciando Viral Research Desktop...
    start "" "%~dp0Viral Research.exe"
    exit /b 0
)

REM Caso contrario, inicia o servidor e abre no navegador padrao
echo Executavel desktop nao encontrado. Iniciando no navegador...
start "" "http://127.0.0.1:4317"
node server.js
