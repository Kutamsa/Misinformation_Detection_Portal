@echo off
title VerifyIt Local Server (Port 8000)
echo ========================================================
echo   Starting VerifyIt Misinformation Detection Server
echo   Host: http://127.0.0.1:8000/
echo ========================================================
echo.
echo Tip: Press CTRL+C in this window whenever you want to STOP the server.
echo.
timeout /t 1 >nul
start http://127.0.0.1:8000/
python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
pause
