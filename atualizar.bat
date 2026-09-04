@echo off
setlocal
chcp 65001 >nul

cd /d "%~dp0"

echo ============================================================
echo   VIRAL RESEARCH - ATUALIZADOR AUTOMATICO VIA GITHUB
echo ============================================================
echo.

where git >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Git nao encontrado no sistema. Nao foi possivel puxar atualizacoes.
    pause
    exit /b 1
)

echo [1/3] Puxando alteracoes mais recentes do GitHub...
git pull origin main
if %ERRORLEVEL% NEQ 0 (
    echo [AVISO] Houve uma falha ao sincronizar com o repositorio remoto.
)

echo.
echo [2/3] Atualizando dependencias...
call npm install --no-audit --no-fund

echo.
echo [3/3] Recompilando o executavel desktop...
call npm run desktop:dist

echo.
echo ============================================================
echo   ATUALIZACAO CONCLUIDA COM SUCESSO!
echo ============================================================
echo.
pause
