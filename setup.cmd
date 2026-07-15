@echo off
setlocal
set "ROOT=%~dp0"
set "NODE_EXE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%N"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if defined NVM_SYMLINK if exist "%NVM_SYMLINK%\node.exe" set "NODE_EXE=%NVM_SYMLINK%\node.exe"
if not defined NODE_EXE (
  echo Node.js 20 or newer is required. Please install Node.js and run setup.cmd again.
  exit /b 1
)
"%NODE_EXE%" -e "const major=Number(process.versions.node.split('.')[0]); if (major<20) process.exit(1)"
if errorlevel 1 (
  echo Node.js 20 or newer is required. The detected Node.js version is too old.
  exit /b 1
)
cd /d "%ROOT%"
"%NODE_EXE%" "%ROOT%scripts\setup.mjs" %*
exit /b %errorlevel%
