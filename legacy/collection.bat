@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo   Civ6 数据采集脚本
echo ========================================
echo.

:: ============================================================
:: 路径配置：默认按"脚本所在目录的上一级"推导，也可用环境变量覆盖
:: ============================================================
for %%I in ("%~dp0..") do set "PROJECT_ROOT=%%~fI"
set "DATA_DIR=%PROJECT_ROOT%\data"
if not defined GAME_LOGS set "GAME_LOGS=%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VI\Logs"
if not defined CLINE_DIR set "CLINE_DIR=%USERPROFILE%\.cline\data\sessions\YOUR_SESSION_ID"
:: 注意：CLINE_DIR 需指向你自己的 Cline 会话目录（...\sessions\<会话id>），否则会跳过对话采集
:: ============================================================

:: 检查项目目录是否存在
if not exist "%PROJECT_ROOT%" (
    echo   [错误] 找不到 Civ6 目录！
    echo   路径: %PROJECT_ROOT%
    echo.
    pause
    exit /b
)

:: ===== 让用户输入存档名称 =====
set /p SAVE_NAME=请输入存档名称（如：存档1、波兰档等）:
if "%SAVE_NAME%"=="" set SAVE_NAME=未命名存档

:: ===== 生成时间戳（使用 VBS，兼容性最好）=====
echo wscript.echo year(now) ^& right("0" ^& month(now),2) ^& right("0" ^& day(now),2) ^& "_" ^& right("0" ^& hour(now),2) ^& minute(now) ^& second(now) > "%TEMP%\gettimestamp.vbs"
for /f "delims=" %%a in ('cscript //nologo "%TEMP%\gettimestamp.vbs"') do set TIMESTAMP=%%a
del "%TEMP%\gettimestamp.vbs" 2>nul

:: ===== 创建存档主文件夹 =====
set SAVE_DIR=%DATA_DIR%\%SAVE_NAME%
mkdir "%SAVE_DIR%" 2>nul

:: ===== 创建本次运行的子文件夹 =====
set RUN_DIR=%SAVE_DIR%\run_%TIMESTAMP%
mkdir "%RUN_DIR%" 2>nul

echo [1] 采集游戏日志...
echo.

:: ===== 检查游戏日志目录 =====
if not exist "%GAME_LOGS%" (
    echo   [错误] 找不到游戏日志目录！
    echo   路径: %GAME_LOGS%
    pause
    exit /b
)

:: ===== 需要采集的文件列表 =====
set FILES=Player_Stats.csv Player_Stats_2.csv AI_Research.csv AI_CityBuild.csv AI_Planning.csv AI_Military.csv AI_Operation.csv AI_Diplomacy.csv AI_UnitEfficiency.csv AI_Governors.csv AI_Knowledge.csv UnitOperations.log

:: ===== 复制文件到本次运行子文件夹 =====
set count=0
for %%f in (%FILES%) do (
    if exist "%GAME_LOGS%\%%f" (
        copy "%GAME_LOGS%\%%f" "%RUN_DIR%\%%f" >nul 2>&1
        echo   ✓ %%f
        set /a count+=1
    ) else (
        echo   - %%f (文件不存在，跳过)
    )
)

echo.
echo   已复制 %count% 个文件到: %RUN_DIR%

:: ===== 采集 Cline 对话记录 =====
echo.
echo [2] 采集 Cline 对话记录...

if not exist "%CLINE_DIR%" (
    echo   [错误] 找不到 Cline 目录！
    echo   路径: %CLINE_DIR%
    pause
    exit /b
)

:: ===== 找到最新的 *.messages.json 文件 =====
set latest_file=
for /f "delims=" %%f in ('dir /b /o-d "%CLINE_DIR%\*.messages.json" 2^>nul') do (
    if not defined latest_file (
        set "latest_file=%%f"
    )
)

if defined latest_file (
    copy "%CLINE_DIR%\%latest_file%" "%SAVE_DIR%\cline_conversation.json" >nul 2>&1
    echo   ✓ 最新对话已保存到存档根目录: %latest_file%
    copy "%CLINE_DIR%\%latest_file%" "%RUN_DIR%\cline_conversation.json" >nul 2>&1
    echo   ✓ 已备份到本次运行文件夹
) else (
    echo   - 未找到 .messages.json 文件
)

:: ===== 更新 latest 快捷文件夹 =====
echo.
echo [3] 更新最新副本...

set LATEST_DIR=%DATA_DIR%\latest
mkdir "%LATEST_DIR%" 2>nul

for %%f in (%FILES%) do (
    if exist "%RUN_DIR%\%%f" (
        copy "%RUN_DIR%\%%f" "%LATEST_DIR%\%%f" >nul 2>&1
    )
)
if exist "%RUN_DIR%\cline_conversation.json" (
    copy "%RUN_DIR%\cline_conversation.json" "%LATEST_DIR%\cline_conversation.json" >nul 2>&1
)

echo   ✓ latest 已更新

:: ===== 完成 =====
echo.
echo ========================================
echo   采集完成！
echo.
echo   存档文件夹: %SAVE_DIR%
echo   本次运行: %RUN_DIR%
echo   最新副本: %LATEST_DIR%
echo ========================================
echo.
pause