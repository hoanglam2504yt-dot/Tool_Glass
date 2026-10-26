@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "GLASS_DIR=X:\INPUT\GLASS"
set "VBS_FILE=L:\Glass\Tool_Glass\Glass.vbs"
set "PASSWORD=8806"

title Auto Run Glass

:login
cls
echo ==========================================
echo LOGIN
echo ==========================================
echo.

for /f "delims=" %%P in ('powershell -Command "$p=Read-Host ''Password'' -AsSecureString; $B=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($p); [Runtime.InteropServices.Marshal]::PtrToStringAuto($B)"') do (
    set "INPUT=%%P"
)

if not "!INPUT!"=="%PASSWORD%" (
    echo.
    echo Sai Password.
    timeout /t 2 /nobreak >nul
    goto login
)

:loop

call :count_images

cls
echo ==========================================
echo Hien tai trong Glass co !IMG_COUNT! file anh
echo ==========================================

if !IMG_COUNT! EQU 0 (
    echo.
    echo Khong con file anh nao trong thu muc Glass.
    echo Dun
    echo.
    pause
    exit /b
)

echo.
echo Running Glass.vbs...
echo.

cscript //nologo "%VBS_FILE%"

echo.
echo ==========================================
echo Da chay xong. Dang cho lan tiep theo...
echo ==========================================
echo.

for /l %%S in (30,-1,0) do (
    call :count_images
    cls
    echo ==========================================
    echo Hien tai trong Ceramic co !IMG_COUNT! file anh
    echo ==========================================
    echo.
    echo Dang cho lan tiep theo...
    echo.
    echo Con lai: %%S giay...
    timeout /t 1 /nobreak >nul
)

goto loop


:count_images
set /a IMG_COUNT=0
for %%E in (png jpg jpeg tif tiff bmp psd) do (
    for %%F in ("%GLASS_DIR%\*.%%E") do (
        if exist "%%F" (
            set /a IMG_COUNT+=1
        )
    )
)
exit /b
