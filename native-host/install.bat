@echo off
setlocal EnableDelayedExpansion

echo Chessist - Native Host Installer
echo ========================================
echo.

:: Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"
set "MANIFEST_PATH=%SCRIPT_DIR%com.chess.live.eval.json"

:: Check if extension ID was provided as argument
if "%~1"=="" (
    echo To find your extension ID:
    echo   1. Open chrome://extensions or brave://extensions
    echo   2. Enable "Developer mode" ^(toggle in top right^)
    echo   3. Find "Chessist" and copy the ID below the name
    echo.
    set /p "EXT_ID=Enter your extension ID: "
) else (
    set "EXT_ID=%~1"
)

:: Validate extension ID
if "!EXT_ID!"=="" (
    echo Error: Extension ID cannot be empty!
    pause
    exit /b 1
)

:: Update manifest with correct path
echo.
echo Updating manifest with your extension ID: !EXT_ID!
set "BAT_PATH=%SCRIPT_DIR%stockfish_host.bat"

:: Create updated manifest (use temp file to avoid issues)
set "TEMP_MANIFEST=%TEMP%\chessist_manifest.json"
(
echo {
echo   "name": "com.chess.live.eval",
echo   "description": "Chessist - Native Stockfish Host",
echo   "path": "%BAT_PATH:\=\\%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://!EXT_ID!/"
echo   ]
echo }
) > "%TEMP_MANIFEST%"

:: Copy to final location
copy /y "%TEMP_MANIFEST%" "%MANIFEST_PATH%" >nul
del "%TEMP_MANIFEST%" 2>nul

:: Register for Chrome and Brave
echo.
echo Registering native messaging host...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.chess.live.eval" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1
reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.chess.live.eval" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1

echo.
echo Installation complete!
echo.
echo Manifest created at: %MANIFEST_PATH%
echo Extension ID: !EXT_ID!
echo.
echo NOTE: You need to have:
echo   1. Python 3 installed and in PATH
echo   2. Stockfish installed ^(in PATH or common locations^)
echo.
echo If Stockfish is not found automatically, set the STOCKFISH_PATH environment variable.
echo.
echo IMPORTANT: Restart your browser after installation!
echo.
endlocal
pause
