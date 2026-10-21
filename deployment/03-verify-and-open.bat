@echo off
rem Check the private bucket and public API, then open Singing.
setlocal DisableDelayedExpansion
call "%~dp0..\tools\deploy-launcher.bat" verify
exit /b %ERRORLEVEL%
