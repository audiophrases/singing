@echo off
rem Tests and dry runs only; no production changes.
setlocal DisableDelayedExpansion
call "%~dp0..\tools\deploy-launcher.bat" prepare
exit /b %ERRORLEVEL%
