@echo off
rem Show the app origin and open the existing Google OAuth client's settings.
setlocal DisableDelayedExpansion
call "%~dp0..\tools\deploy-launcher.bat" google
exit /b %ERRORLEVEL%
