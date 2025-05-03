@echo off
setlocal enabledelayedexpansion

REM Path to rclone
set RCLONE=D:\setup\bin\rclone.exe

REM Remote path
set REMOTE=b2:cdncreaticodecom/scratch-gui-projects

REM Temporary file for file listing
set FILELIST=files.json

REM Get JSON list of files
REM %RCLONE% lsjson %REMOTE% --files-only > %FILELIST%

REM Read each file path from JSON and apply metadata
for /f "usebackq tokens=*" %%A in (`type %FILELIST%`) do (
    set "LINE=%%A"
    REM Extract path using basic string matching (JSON lines contain "Path": "filename")
    for /f "tokens=2 delims=:" %%P in ("!LINE!") do (
        set "PART=%%P"
        set "PART=!PART:~1,-2!"  REM remove quotes and comma
        if not "!PART!"=="" (
            echo Applying Cache-Control to: !PART!
            %RCLONE% backend metadata %REMOTE%/!PART! set Cache-Control "public,max-age=131536000,immutable"
        )
    )
)

del %FILELIST%
echo Done.
pause
