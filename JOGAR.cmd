@echo off
setlocal enabledelayedexpansion
title RISCO DE FRUTA
cd /d "%~dp0"

REM ==============================================================================================
REM  RISCO DE FRUTA - lancador de desktop
REM
REM  O QUE ISTO E, COM HONESTIDADE: o jogo roda sobre WebGL2 (Babylon.js). Isto NAO e um binario
REM  nativo compilado - e o lancador que constroi a versao de producao, sobe o servidor local e
REM  abre o jogo numa JANELA PROPRIA do navegador, sem barra de endereco, abas ou menus. Para quem
REM  clica, o comportamento e o de um executavel: um atalho, uma janela, o jogo.
REM
REM  Empacotar num .exe de verdade (Electron/Tauri) e possivel e da um instalador - custa ~150 MB
REM  de runtime embutido e um passo de build proprio. Se for esse o caminho, e outra tarefa.
REM ==============================================================================================

echo.
echo   ================================================
echo      R I S C O   D E   F R U T A
echo   ================================================
echo.

REM ---- 1. Node -----------------------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  if exist "%~dp0..\tools\node\node.exe" (
    set "PATH=%~dp0..\tools\node;%PATH%"
  ) else (
    echo   [ERRO] Node.js nao encontrado no PATH.
    echo   Instale em https://nodejs.org e rode este arquivo de novo.
    echo.
    pause
    exit /b 1
  )
)

REM ---- 2. Dependencias ---------------------------------------------------------------------
if not exist "node_modules" (
  echo   Primeira execucao: instalando dependencias. Isto demora alguns minutos.
  call npm install || (echo   [ERRO] npm install falhou. & pause & exit /b 1)
)

REM ---- 3. Build ----------------------------------------------------------------------------
REM  Reconstroi so quando nao existe build. Para forcar: JOGAR.cmd /rebuild
if /i "%~1"=="/rebuild" ( if exist "dist" rmdir /s /q "dist" )
if not exist "dist\index.html" (
  echo   Compilando o jogo...
  call npm run build || (echo   [ERRO] a compilacao falhou. & pause & exit /b 1)
)

REM ---- 4. Servidor -------------------------------------------------------------------------
REM  O jogo carrega modelos e texturas por HTTP; abrir o index.html direto do disco quebraria
REM  tudo por CORS. Por isso sobe um servidor local, so na maquina (127.0.0.1).
echo   Subindo o servidor local...
start "servidor-risco-de-fruta" /min cmd /c "npm run preview -- --port 4173 --strictPort"

REM  Espera a porta responder, ate 40 s, em vez de chutar um tempo fixo.
set PORTA_OK=
for /l %%i in (1,1,40) do (
  if not defined PORTA_OK (
    timeout /t 1 /nobreak >nul
    powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient('127.0.0.1',4173)).Close();exit 0}catch{exit 1}" >nul 2>nul
    if not errorlevel 1 set PORTA_OK=1
  )
)
if not defined PORTA_OK (
  echo   [ERRO] o servidor nao respondeu na porta 4173.
  pause
  exit /b 1
)

REM ---- 5. Janela dedicada ------------------------------------------------------------------
REM  --app abre SEM barra de endereco nem abas: a janela do jogo. Tenta Chrome, depois Edge, e
REM  so entao cai no navegador padrao (que abriria numa aba comum).
set "JOGO=http://127.0.0.1:4173/"
set "PERFIL=%LOCALAPPDATA%\RiscoDeFruta\navegador"

set "NAV="
for %%P in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do ( if not defined NAV if exist %%P set "NAV=%%~P" )

if defined NAV (
  echo   Abrindo o jogo...
  start "" "%NAV%" --app="%JOGO%" --user-data-dir="%PERFIL%" --start-maximized --autoplay-policy=no-user-gesture-required
) else (
  echo   Chrome/Edge nao encontrados; abrindo no navegador padrao.
  start "" "%JOGO%"
)

echo.
echo   Jogo aberto. FECHE ESTA JANELA PRETA para encerrar o servidor.
echo.
pause >nul
taskkill /fi "WINDOWTITLE eq servidor-risco-de-fruta*" /t /f >nul 2>nul
endlocal
