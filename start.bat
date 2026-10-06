@echo off
title BTC Futures Simulator
echo ========================================================
echo         BTC FUTURES SIMULATOR - PRO BLIND BACKTESTER
echo ========================================================
echo.

if exist "%USERPROFILE%\Downloads\BTCUSDT-5m-merged-all-months.csv" (
    echo [OK] Found your 80MB historical BTC data in Downloads:
    echo      %USERPROFILE%\Downloads\BTCUSDT-5m-merged-all-months.csv
    echo.
    echo Simply Drag and Drop it into the simulator window!
    echo It will parse in ~1 second and cache in your browser.
) else (
    echo Drag and drop any 5M BTC CSV into the simulator window.
)

echo.
echo Launching simulator in your default web browser...
start "" "%~dp0index.html"
echo.
echo Enjoy your trading practice!
timeout /t 4 >nul
