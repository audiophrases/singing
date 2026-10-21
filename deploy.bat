@echo off
rem Singing deployment menu. Launch from any working directory.
setlocal DisableDelayedExpansion
call "%~dp0tools\deploy-launcher.bat" menu
exit /b %ERRORLEVEL%
