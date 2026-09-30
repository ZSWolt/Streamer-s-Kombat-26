@echo off
chcp 65001 >nul
title STREAM KOMBAT 26 - Server
cd /d "%~dp0"
if not exist node_modules (
  echo Installing packages...
  call npm install
)
echo Building the game...
call npx vite build --logLevel error
node server\index.ts
pause
