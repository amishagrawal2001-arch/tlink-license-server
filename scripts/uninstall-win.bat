@echo off
setlocal

REM Tlink License Server - Windows Uninstaller
REM Run as Administrator

set INSTALL_DIR=C:\Program Files\Tlink License Server
set SERVICE_NAME=TlinkLicenseServer

echo ============================================
echo   Tlink License Server - Windows Uninstaller
echo ============================================
echo.

REM Check for admin privileges
net session >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: This script must be run as Administrator.
    echo Right-click and select "Run as administrator".
    pause
    exit /b 1
)

echo [1/2] Stopping and removing Windows Service...
sc query %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% equ 0 (
    sc stop %SERVICE_NAME% >nul 2>&1
    timeout /t 3 /nobreak >nul
    sc delete %SERVICE_NAME% >nul 2>&1
    echo   -^> Service stopped and removed
) else (
    echo   -^> Service not found, skipping
)

echo [2/2] Removing installation directory...
if exist "%INSTALL_DIR%" (
    rmdir /S /Q "%INSTALL_DIR%"
    echo   -^> Removed "%INSTALL_DIR%"
) else (
    echo   -^> Installation directory not found, skipping
)

echo.
echo ============================================
echo   Uninstallation Complete!
echo ============================================
echo.
echo   Tlink License Server has been removed.
echo ============================================
echo.
pause
