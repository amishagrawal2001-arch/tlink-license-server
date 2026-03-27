@echo off
setlocal enabledelayedexpansion

REM Tlink License Server - Windows Installer
REM Run as Administrator
REM Idempotent: safe to run multiple times

set INSTALL_DIR=C:\Program Files\Tlink License Server
set SERVICE_NAME=TlinkLicenseServer
set DISPLAY_NAME=Tlink License Server
set PORT=4000

echo ============================================
echo   Tlink License Server - Windows Installer
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

REM Determine script directory
set SCRIPT_DIR=%~dp0
set SCRIPT_DIR=%SCRIPT_DIR:~0,-1%

REM Find executable
set EXECUTABLE=
if exist "%SCRIPT_DIR%\tlink-license-server-win.exe" (
    set EXECUTABLE=%SCRIPT_DIR%\tlink-license-server-win.exe
) else if exist "%SCRIPT_DIR%\tlink-license-server.exe" (
    set EXECUTABLE=%SCRIPT_DIR%\tlink-license-server.exe
) else (
    echo ERROR: Cannot find the tlink-license-server executable.
    echo Make sure the .exe is in the same directory as this script.
    pause
    exit /b 1
)

echo [1/6] Creating installation directory...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
if not exist "%INSTALL_DIR%\data" mkdir "%INSTALL_DIR%\data"

echo [2/6] Copying executable...
copy /Y "%EXECUTABLE%" "%INSTALL_DIR%\tlink-license-server.exe" >nul

REM Copy static assets if present
if exist "%SCRIPT_DIR%\admin" (
    xcopy /E /I /Y "%SCRIPT_DIR%\admin" "%INSTALL_DIR%\admin" >nul
)
if exist "%SCRIPT_DIR%\docs" (
    xcopy /E /I /Y "%SCRIPT_DIR%\docs" "%INSTALL_DIR%\docs" >nul
)

echo [3/6] Creating default configuration...
if not exist "%INSTALL_DIR%\.env" (
    if exist "%SCRIPT_DIR%\.env.example" (
        copy /Y "%SCRIPT_DIR%\.env.example" "%INSTALL_DIR%\.env" >nul
    ) else (
        (
            echo PORT=4000
            echo JWT_SECRET=change-me-to-a-random-string
            echo KEY_SALT=change-me-to-another-random-string
            echo ADMIN_USERNAME=admin
            echo ADMIN_PASSWORD=admin123
            echo CORS_ORIGINS=http://localhost:*
            echo DATABASE_PATH=./data/licenses.db
        ) > "%INSTALL_DIR%\.env"
    )
    echo   -^> Created default .env ^(edit "%INSTALL_DIR%\.env" to configure^)
) else (
    echo   -^> .env already exists, skipping
)

echo [4/6] Seeding database...
pushd "%INSTALL_DIR%"
tlink-license-server.exe --seed 2>nul || echo   -^> Seed skipped ^(may already be seeded or seed flag not supported^)
popd

echo [5/6] Creating Windows Service...
REM Stop and remove existing service if present
sc query %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo   -^> Stopping existing service...
    sc stop %SERVICE_NAME% >nul 2>&1
    timeout /t 3 /nobreak >nul
    sc delete %SERVICE_NAME% >nul 2>&1
    timeout /t 2 /nobreak >nul
)

sc create %SERVICE_NAME% ^
    binPath= "\"%INSTALL_DIR%\tlink-license-server.exe\"" ^
    DisplayName= "%DISPLAY_NAME%" ^
    start= auto ^
    obj= "LocalSystem" >nul

if %ERRORLEVEL% neq 0 (
    echo   -^> WARNING: Failed to create Windows service.
    echo   -^> You can run the server manually: "%INSTALL_DIR%\tlink-license-server.exe"
) else (
    sc description %SERVICE_NAME% "Tlink License Management Server" >nul 2>&1
    sc failure %SERVICE_NAME% reset= 86400 actions= restart/5000/restart/10000/restart/30000 >nul 2>&1
)

echo [6/6] Starting service...
sc start %SERVICE_NAME% >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   -^> WARNING: Service may not have started. Check with: sc query %SERVICE_NAME%
)

echo.
echo ============================================
echo   Installation Complete!
echo ============================================
echo.
echo   Server URL:      http://localhost:%PORT%
echo   Admin Dashboard: http://localhost:%PORT%/admin
echo   API Docs:        http://localhost:%PORT%/docs
echo.
echo   Install path:    %INSTALL_DIR%
echo   Config file:     %INSTALL_DIR%\.env
echo.
echo   Service commands:
echo     sc stop %SERVICE_NAME%
echo     sc start %SERVICE_NAME%
echo     sc query %SERVICE_NAME%
echo.
echo   To uninstall: Run scripts\uninstall-win.bat as Administrator
echo ============================================
echo.
pause
