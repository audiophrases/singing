@echo off
rem Routine Singing-only update without a typed confirmation.
setlocal DisableDelayedExpansion
call "%~dp0tools\deploy-launcher.bat" update --yes
exit /b %ERRORLEVEL%
