@echo off
rem M4.5.2 / M4.9.1: graceful stop for the Quiver API on Windows without PowerShell (cmd + curl.exe, built into Windows 10+).
rem Usage:  scripts\ops\stop-api.cmd [PORT] [TASKNAME] [TOKENFILE]
rem Port/task come from args, else env QUIVER_PORT / QUIVER_TASK, else the VPS defaults 8987 / QuiverApi.
rem The ops token is read from a file (arg 3, else env QUIVER_OPS_TOKEN_FILE, else C:\quiver\secrets\ops_token),
rem never from the command line or an env var, so it never shows in the process list: the header goes to curl via a
rem short-lived --config file in %%TEMP%% (written by cmd's built-in echo, deleted right after the request).
rem Waits with "ping -n 2 127.0.0.1" (about 1 s) because "timeout" fails without a console (WinRM / remote shells).
rem Falls back to schtasks /end only if the API is still listening after about 10 s (hard kill: no flush).
setlocal EnableExtensions DisableDelayedExpansion
set "PORT=%~1"
if "%PORT%"=="" set "PORT=%QUIVER_PORT%"
if "%PORT%"=="" set "PORT=8987"
set "TASK=%~2"
if "%TASK%"=="" set "TASK=%QUIVER_TASK%"
if "%TASK%"=="" set "TASK=QuiverApi"
set "TOKFILE=%~3"
if "%TOKFILE%"=="" set "TOKFILE=%QUIVER_OPS_TOKEN_FILE%"
if "%TOKFILE%"=="" set "TOKFILE=C:\quiver\secrets\ops_token"
if not exist "%TOKFILE%" (echo ops token file not found: %TOKFILE% 1>&2 & exit /b 2)
set "TOK="
set /p TOK=<"%TOKFILE%"
if not defined TOK (echo ops token file is empty: %TOKFILE% 1>&2 & exit /b 2)
set "CFG=%TEMP%\quiver-stop-%RANDOM%%RANDOM%.curl"
> "%CFG%" echo header = "Authorization: Bearer %TOK%"
set "TOK="
curl.exe -s -S -m 5 -X POST --config "%CFG%" "http://127.0.0.1:%PORT%/v1/ops/shutdown"
set "RC=%errorlevel%"
del /q "%CFG%" >nul 2>&1
if not "%RC%"=="0" (echo WARNING: shutdown request failed 1>&2) else (echo. & echo shutdown accepted)
for /l %%i in (1,1,10) do (
  ping -n 2 127.0.0.1 >nul
  netstat -ano -p tcp | findstr /r /c:":%PORT% .*LISTENING" >nul || (echo API stopped cleanly & exit /b 0)
)
echo WARNING: API still listening after 10 s; falling back to schtasks /end (hard kill, no flush) 1>&2
schtasks /end /tn "%TASK%"
exit /b 1
