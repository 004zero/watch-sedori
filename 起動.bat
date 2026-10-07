@echo off
cd /d "%~dp0"
start http://localhost:3340
npx -y serve -l 3340 .
