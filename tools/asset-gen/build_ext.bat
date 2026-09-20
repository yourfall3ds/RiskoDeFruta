@echo off
REM build_ext.bat - Compila as extensoes nativas do Hunyuan3D (texgen).
REM
REM Por que um .bat e nao uma linha de comando:
REM   Em `cmd /c "call vcvars && set PATH=x;%PATH% && ..."` o %PATH% e expandido
REM   no parse, ANTES do vcvars rodar - o resultado sobrescreve o ambiente do
REM   compilador e o cl.exe some. Num .bat cada linha expande na sua vez.
REM
REM Uso:
REM   tools\asset-gen\build_ext.bat <dir_da_extensao> <python.exe>

setlocal

set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set "CUDA_HOME=C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v12.4"

if not exist "%VCVARS%" (
    echo ERRO: vcvars64.bat nao encontrado em "%VCVARS%"
    exit /b 1
)
if not exist "%CUDA_HOME%\bin\nvcc.exe" (
    echo ERRO: nvcc nao encontrado em "%CUDA_HOME%\bin"
    exit /b 1
)

call "%VCVARS%" >nul
if errorlevel 1 exit /b 1

REM torch exige isso quando o ambiente VC ja esta ativo, senao aborta o build.
set DISTUTILS_USE_SDK=1
set "CUDA_PATH=%CUDA_HOME%"
set "PATH=%CUDA_HOME%\bin;%PATH%"

where cl.exe >nul 2>&1 || (echo ERRO: cl.exe fora do PATH apos vcvars & exit /b 1)

cd /d "%~1" || exit /b 1
"%~2" -m pip install . --no-build-isolation
exit /b %errorlevel%
