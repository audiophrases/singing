@echo off
rem Prepare, provision and release. The helper asks for confirmation before writes.
setlocal DisableDelayedExpansion
call "%~dp0..\tools\deploy-launcher.bat" deploy
exit /b %ERRORLEVEL%
