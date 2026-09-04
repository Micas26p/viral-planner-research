@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

cd /d "%~dp0"

echo ============================================================
echo   VIRAL RESEARCH NICHE FINDER - INSTALADOR AUTOMATICO
echo ============================================================
echo.

REM 1. Verificar Node.js
where node >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
    echo [OK] Node.js detectado no sistema: !NODE_VERSION!
) else (
    if exist "%~dp0.node\node.exe" (
        set "PATH=%~dp0.node;%~dp0.node\node_modules\npm\bin;%PATH%"
        echo [OK] Usando Node.js portatil local em .node\
    ) else (
        echo [AVISO] Node.js nao foi encontrado no sistema.
        echo [INFO] Baixando Node.js LTS portatil automaticamente...
        if not exist ".node_tmp" mkdir ".node_tmp"
        
        curl.exe -L -o ".node_tmp\node.zip" "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip"
        if !ERRORLEVEL! NEQ 0 (
            echo [ERRO] Falha ao baixar o Node.js portatil.
            echo Por favor, instale o Node.js manualmente em https://nodejs.org
            pause
            exit /b 1
        )
        
        echo [INFO] Extraindo arquivos do Node.js...
        tar.exe -xf ".node_tmp\node.zip" -C ".node_tmp"
        move ".node_tmp\node-v20.18.0-win-x64" "%~dp0.node" >nul
        rmdir /s /q ".node_tmp" >nul 2>&1
        
        set "PATH=%~dp0.node;%~dp0.node\node_modules\npm\bin;%PATH%"
        echo [OK] Node.js portatil configurado com sucesso!
    )
)

echo.
REM 2. Configurar .env
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [OK] Arquivo de configuracoes .env criado a partir de .env.example
    ) else (
        type nul > ".env"
        echo [OK] Arquivo .env inicializado.
    )
) else (
    echo [OK] Arquivo .env ja existente.
)

echo.
REM 3. Instalar Dependencias
echo [1/2] Instalando dependencias necessarias via npm...
call npm install --no-audit --no-fund
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Ocorreu uma falha ao instalar as dependencias via npm.
    pause
    exit /b 1
)

echo.
REM 4. Gerar Executavel Desktop
echo [2/2] Compilando e gerando o aplicativo portatil executavel (Viral Research.exe)...
call npm run desktop:dist
if %ERRORLEVEL% NEQ 0 (
    echo [AVISO] Nao foi possivel compilar o executavel portatil. O modo Web continua disponivel.
) else (
    echo [OK] Aplicativo desktop 'Viral Research.exe' compilado com sucesso!
)

echo.
echo ============================================================
echo   TUDO PRONTO! INSTALACAO CONCLUIDA COM SUCESSO!
echo ============================================================
echo.
echo Voce pode abrir o Viral Research de duas formas:
echo   1. Dando duplo clique em 'iniciar.bat'
echo   2. Dando duplo clique direto em 'Viral Research.exe'
echo.

choice /C SN /M "Deseja abrir o Viral Research agora? (S/N)"
if %ERRORLEVEL% EQU 1 (
    if exist "%~dp0iniciar.bat" (
        call "%~dp0iniciar.bat"
    ) else (
        if exist "%~dp0Viral Research.exe" (
            start "" "%~dp0Viral Research.exe"
        ) else (
            start "" "http://127.0.0.1:4317"
            call npm start
        )
    )
)

exit /b 0
