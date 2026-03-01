@echo off
:: ══════════════════════════════════════════════════════════════
::  CMDB Plus Ultra — Script de Inicialização (Windows)
::  Clique duplo ou rode: start.bat [porta]
:: ══════════════════════════════════════════════════════════════

set PORTA=%1
if "%PORTA%"=="" set PORTA=8080

:: Verifica py
py --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] py nao encontrado.
    echo Instale em: https://www.py.org/downloads/
    echo Marque "Add py to PATH" durante a instalacao.
    pause
    exit /b 1
)

:: Verifica Flask
py -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Flask nao encontrado. Instalando...
    pip install flask
)

:: Info sobre SSH (opcional)
echo.
echo ============================================================
echo  CMDB PLUS ULTRA v2
echo ============================================================
echo  Para usar SSH no terminal integrado, certifique-se que
echo  o OpenSSH esta instalado:
echo    Configuracoes ^> Apps ^> Recursos Opcionais ^> OpenSSH
echo  Ou via PowerShell (admin):
echo    Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
echo ============================================================
echo.
echo Iniciando na porta %PORTA%...
echo Acesse: http://localhost:%PORTA%
echo Pressione Ctrl+C para parar
echo.

cd /d "%~dp0"
set CMDB_PORT=%PORTA%

:: Abre o browser automaticamente apos 2 segundos
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%PORTA%"

py server.py

pause

