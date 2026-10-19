@echo off
rem ============================================================================
rem  civ6claude.bat  --  Civ6 MCP 项目启动器（Windows 原生 / VS Code + Cline）
rem
rem  作用：检查环境 -> 同步依赖 -> 打开 VS Code（Cline 侧边栏会拉起 MCP server）
rem
rem  可选参数：
rem      --no-lua    设置 CIV_MCP_DISABLE_LUA=1（禁用 run_lua 逃逸工具，
rem                  评测/公平性场景用；日常让 Agent 自由玩就不加）
rem      --sync      强制重新 uv sync
rem      --check     setup 之后直接跑连接自检，再打开 VS Code
rem
rem  ⚠️ 重要：本脚本必须用 Windows 原生 cmd 运行。
rem     项目 README 明确警告「不要从 WSL 运行」—— WSL2 到 Windows 的
rem     TCP 桥接不稳，tuner server 在握手失败后会锁死，只能重启游戏。
rem ============================================================================

setlocal EnableDelayedExpansion
set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "PROJ=%SCRIPT_DIR%\civ6-mcp"

echo.
echo ============================================================
echo   Civ6 MCP  -  Windows 原生启动器
echo ============================================================
echo   项目目录: %PROJ%
echo.

rem ---------------------------------------------------------------------------
rem  [1/6] 目录检查
rem ---------------------------------------------------------------------------
if not exist "%PROJ%\pyproject.toml" (
    echo [X] 找不到 "%PROJ%\pyproject.toml"
    echo     请把这个 bat 放在 CivilizationVI 目录下（与 civ6-mcp 同级）。
    echo.
    pause
    exit /b 1
)
echo [1/6] 项目目录 OK

rem ---------------------------------------------------------------------------
rem  [2/6] uv 检查
rem ---------------------------------------------------------------------------
where uv >nul 2>&1
if errorlevel 1 (
    if exist "%USERPROFILE%\.local\bin\uv.exe" (
        set "PATH=%USERPROFILE%\.local\bin;%PATH%"
    ) else (
        echo [X] 找不到 uv。
        echo.
        echo     你可以二选一：
        echo       a^) PowerShell 里执行:  irm https://astral.sh/uv/install.ps1 ^| iex
        echo       b^) pip install uv
        echo.
        pause
        exit /b 1
    )
)
for /f "delims=" %%v in ('uv --version 2^>nul') do set "UVVER=%%v"
echo [2/6] uv OK  (!UVVER!)

rem ---------------------------------------------------------------------------
rem  [3/6] 依赖同步
rem ---------------------------------------------------------------------------
if exist "%PROJ%\.venv" if /i not "%~1"=="--sync" goto :skip_sync
echo [3/6] 正在 uv sync（首次会比较慢）...
pushd "%PROJ%"
uv sync
set "SYNC_RC=!errorlevel!"
popd
if not "!SYNC_RC!"=="0" (
    echo.
    echo [X] uv sync 失败（exit=!SYNC_RC!）。
    echo     常见原因：网络问题，或本机 Python 低于 3.12。
    echo     本项目要求 Python ^>=3.12；本机当前可能不是 3.12。
    echo.
    pause
    exit /b 1
)
goto :after_sync

:skip_sync
echo [3/6] .venv 已存在，跳过 uv sync（要强制重来请加 --sync）

:after_sync

rem ---------------------------------------------------------------------------
rem  [4/6] 生成 Cline 的 MCP 配置（绝对路径，避免工作目录相对路径的坑）
rem ---------------------------------------------------------------------------
echo [4/6] 写入 Cline / 项目 MCP 配置...
set "DISABLE_LUA="
if /i "%~1"=="--no-lua" set "DISABLE_LUA=1"
where python >nul 2>&1
if errorlevel 1 (
    echo       [!] PATH 里没有 python，跳过自动写配置。
    echo           请手动把下面的片段加到 Cline 的 cline_mcp_settings.json：
    echo           {"mcpServers":{"civ6":{"command":"uv","args":["run","--directory","%PROJ%","civ-mcp"],"disabled":false,"autoApprove":[]}}}
) else (
    if defined DISABLE_LUA (
        python "%SCRIPT_DIR%civ6_mcp_setup.py" --project "%PROJ%" --disable-lua
    ) else (
        python "%SCRIPT_DIR%civ6_mcp_setup.py" --project "%PROJ%"
    )
    if errorlevel 1 echo       [!] 写配置时出错，但你仍可手动添加（见上面的 JSON 片段）。
)

rem ---------------------------------------------------------------------------
rem  [5/6] 环境变量
rem ---------------------------------------------------------------------------
if defined DISABLE_LUA (
    set "CIV_MCP_DISABLE_LUA=1"
    echo [5/6] CIV_MCP_DISABLE_LUA=1（run_lua 逃逸工具已禁用）
) else (
    echo [5/6] CIV_MCP_DISABLE_LUA 未设置（Lua 工具可用）
)

rem ---------------------------------------------------------------------------
rem  [6/6] 连接自检（可选）
rem ---------------------------------------------------------------------------
if /i "%~2"=="--check" (
    echo [6/6] 连接自检...
    pushd "%PROJ%"
    uv run python scripts\test_connection.py
    popd
    echo.
    echo   期望看到握手成功 + Lua 状态列表（GameCore_Tuner / InGame 等）。
    echo   如果失败：先确认游戏已启动、已读档、Tuner 已开启，然后重启游戏。
    echo.
    pause
)

rem ---------------------------------------------------------------------------
rem  打开 VS Code
rem ---------------------------------------------------------------------------
echo.
echo ============================================================
echo   启动前检查清单（缺一个就连不上）
echo ============================================================
echo   [ ] Steam 里已安装 "Sid Meier's Civilization VI SDK"
echo       （FireTuner 属于 SDK，不在游戏本体里）
echo   [ ] 游戏内已开启 Tuner（设置 - 游戏选项 - "Tuner (disables achievements)"）
echo   [ ] 已关闭 FireTuner.exe（游戏只允许一个 tuner 连接）
echo   [ ] Auto End Turn 已关闭（否则会干扰 blocker 处理流程）
echo   [ ] 游戏已启动并已读档（不是主菜单）
echo   [ ] 没有从 WSL 运行任何东西
echo.
echo   [i] 首次在 Cline 里用：打开左侧 Cline 侧边栏 -^> MCP Servers，
echo       确认 "civ6" 已出现并能连上；必要时点一下 Restart。
echo.
echo ------------------------------------------------------------
echo   接下来让 Cline 执行（可直接粘贴）：
echo.
echo     Play my Civ 6 game. Start by getting an overview, then
echo     check units and cities, and play through the turn.
echo.
echo ------------------------------------------------------------
echo.

pushd "%PROJ%"
code .
popd

echo 已发出打开 VS Code 的请求。本窗口可以关闭。
echo （MCP server 由 Cline 拉起，不要手动在这个窗口里跑 civ-mcp）
echo.
pause
endlocal
