@echo off
title Stop VerifyIt Server
echo ========================================================
echo   Stopping VerifyIt Server (Port 8000)...
echo ========================================================
echo.
powershell -Command "Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host 'Server on port 8000 stopped successfully.' -ForegroundColor Green"
echo.
pause
