@echo off
rem Singing: start a local web server and open the karaoke maker.
rem (WebGPU, which the karaoke maker needs, only works from localhost or https,
rem  so the page cannot simply be opened as a file.)
rem Close this window to stop the server.

setlocal
cd /d "%~dp0"
set "PORT=8080"
set "PAGE=lab/karaoke.html"
set "URL=http://localhost:%PORT%/%PAGE%"

rem Pick a web server: Python if installed, otherwise Node's npx http-server.
set "SERVER="
where python >nul 2>nul && set "SERVER=python -m http.server %PORT% --bind 127.0.0.1"
if not defined SERVER where py >nul 2>nul && set "SERVER=py -m http.server %PORT% --bind 127.0.0.1"
if not defined SERVER where npx >nul 2>nul && set "SERVER=npx --yes http-server -p %PORT% -a 127.0.0.1 -c-1 ."
if not defined SERVER (
  echo Neither Python nor Node.js is installed, so there is no web server to run.
  echo Install one of them ^(python.org or nodejs.org^) and try again.
  pause
  exit /b 1
)

echo.
echo   Karaoke maker:  %URL%
echo   Singing app:    http://localhost:%PORT%/#/studio
echo.
echo   Use Chrome or Edge (they have WebGPU). Keep this window open while you work;
echo   close it to stop.
echo.

rem Open the browser once the server has had a moment to start.
if not "%NOBROWSER%"=="1" start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" "%URL%""

%SERVER%
