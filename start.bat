@echo off
cd /d "%~dp0"
start "" http://localhost:3939
node server.js
