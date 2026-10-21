@echo off
rem Routine Singing-only update using the existing cloud setup.
setlocal DisableDelayedExpansion
call "%~dp0tools\deploy-launcher.bat" update
exit /b %ERRORLEVEL%
