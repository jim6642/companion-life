@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22.13 or newer, then reopen this file.
  pause
  exit /b 1
)
if not exist config.local.json node scripts\init.mjs --defaults
node scripts\doctor.mjs
if errorlevel 1 (
  pause
  exit /b 1
)
node src\main.mjs
pause
