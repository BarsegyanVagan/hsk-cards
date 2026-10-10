@echo off
rem Rebuild data\words.json from hsk_2_1_15.txt (just double-click this file)
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\convert.ps1" %*
echo.
pause
