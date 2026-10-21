@echo off
setlocal DisableDelayedExpansion
set "SINGING_ACTION="
if "%~1"=="menu" set "SINGING_ACTION=menu"
if "%~1"=="prepare" set "SINGING_ACTION=prepare"
if "%~1"=="deploy" set "SINGING_ACTION=deploy"
if "%~1"=="update" set "SINGING_ACTION=update"
if "%~1"=="verify" set "SINGING_ACTION=verify"
if "%~1"=="google" set "SINGING_ACTION=google"
if not defined SINGING_ACTION exit /b 2
pushd "%~dp0.." || exit /b 1
set "SINGING_EXIT_CODE=1"
where node >nul 2>nul
if errorlevel 1 goto missing_node
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)"
if errorlevel 1 goto missing_node
node "%~dp0deploy-dependencies.cjs"
if not errorlevel 1 goto run_helper
where npm >nul 2>nul
if errorlevel 1 goto missing_npm
echo Installing the project's locked dependencies...
call npm ci --include=dev
if errorlevel 1 goto install_failed
:run_helper
node "%~dp0deploy-cli.mjs" "%SINGING_ACTION%"
set "SINGING_EXIT_CODE=%ERRORLEVEL%"
goto finish
:missing_node
echo Install Node.js 22 or later from https://nodejs.org/ and run this file again.
goto finish
:missing_npm
echo npm was not found. Reinstall Node.js with npm included and run this file again.
goto finish
:install_failed
echo Dependency installation failed. Check the npm error above and retry.
:finish
popd
if "%SINGING_DEPLOY_NO_PAUSE%"=="1" goto return_code
echo.
pause
:return_code
exit /b %SINGING_EXIT_CODE%
