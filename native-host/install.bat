@echo off
echo Chessist - Native Host Installer
echo ========================================
echo.

:: Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"
set "MANIFEST_PATH=%SCRIPT_DIR%com.chess.live.eval.json"

:: Update manifest with correct path
echo Updating manifest with correct paths...
set "BAT_PATH=%SCRIPT_DIR%stockfish_host.bat"

:: Create updated manifest
echo {> "%MANIFEST_PATH%"
echo   "name": "com.chess.live.eval",>> "%MANIFEST_PATH%"
echo   "description": "Chessist - Native Stockfish Host",>> "%MANIFEST_PATH%"
echo   "path": "%BAT_PATH:\=\\%",>> "%MANIFEST_PATH%"
echo   "type": "stdio",>> "%MANIFEST_PATH%"
echo   "allowed_origins": [>> "%MANIFEST_PATH%"
echo     "chrome-extension://ibdofmpbjmkbbffodhbfojahdeklnbgj/">> "%MANIFEST_PATH%"
echo   ]>> "%MANIFEST_PATH%"
echo }>> "%MANIFEST_PATH%"

:: Register for Chrome
echo.
echo Registering native messaging host for Chrome/Brave...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.chess.live.eval" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f
reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.chess.live.eval" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f

echo.
echo Installation complete!
echo.
echo NOTE: You need to have:
echo   1. Python 3 installed and in PATH
echo   2. Stockfish installed (in PATH or common locations)
echo.
echo If Stockfish is not found automatically, set the STOCKFISH_PATH environment variable.
echo.
pause
