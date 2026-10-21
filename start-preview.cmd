@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先从 https://nodejs.org/ 安装 Node.js，然后重新打开此脚本。
  pause
  exit /b 1
)
set "PASS_NODE=node"
set "PASS_OPEN_BROWSER=1"
if exist "scripts\preview.cjs" (
  "%PASS_NODE%" scripts\preview.cjs dist
) else (
  "%PASS_NODE%" preview.cjs .
)
if errorlevel 1 pause
