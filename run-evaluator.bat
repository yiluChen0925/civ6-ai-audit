@echo off
rem ============================================================================
rem  run-evaluator.bat  --  离线跑「评估器 + 前端」，全程不需要启动《文明6》
rem
rem  适用场景：只想看/改 data\collected 里那 102 个回合快照的分析与可视化。
rem  不适用场景：让 Agent 真的下棋（那必须有游戏 + FireTuner，见 civ6claude.bat）。
rem
rem  做的事：起 Java API(:8080) + 静态前端(:8000)，然后打开浏览器。
rem  编译策略：有 Maven 就 mvn compile；没有就直接用 javac + 本机 .m2 里的
rem            Jackson jar 编译。
rem ============================================================================

setlocal EnableDelayedExpansion
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo.
echo ============================================================
echo   离线评估器（不需要启动游戏）
echo ============================================================
echo   项目目录: %ROOT%
echo.

rem ---------------------------------------------------------------------------
rem  [1/4] Java 检查
rem ---------------------------------------------------------------------------
where java >nul 2>&1
if errorlevel 1 (
    echo [X] 找不到 java。请装 JDK 17+（本机已有 17.0.8 的话，把 java 加进 PATH）。
    pause
    exit /b 1
)
for /f "delims=" %%v in ('java -version 2^>^&1 ^| findstr /i "version"') do set "JAVAVER=%%v"
echo [1/4] Java OK  (!JAVAVER!)

rem ---------------------------------------------------------------------------
rem  [2/4] 编译评测器
rem ---------------------------------------------------------------------------
rem ---------------------------------------------------------------------------
rem  Jackson jar 位置（Maven 分支和 javac 分支都需要，所以先解析好）
rem ---------------------------------------------------------------------------
set "JACKSON=%USERPROFILE%\.m2\repository\com\fasterxml\jackson"
set "J1=%JACKSON%\core\jackson-databind\2.16.1\jackson-databind-2.16.1.jar"
set "J2=%JACKSON%\core\jackson-core\2.16.1\jackson-core-2.16.1.jar"
set "J3=%JACKSON%\core\jackson-annotations\2.16.1\jackson-annotations-2.16.1.jar"
set "J4=%JACKSON%\datatype\jackson-datatype-jsr310\2.16.1\jackson-datatype-jsr310-2.16.1.jar"

where mvn >nul 2>&1
if not errorlevel 1 (
    echo [2/4] 检测到 Maven，使用 mvn compile ...
    pushd evaluator
    call mvn -q compile
    set "RC=!errorlevel!"
    popd
    if not "!RC!"=="0" (
        echo.
        echo [X] mvn compile 失败（exit=!RC!）。可改用 javac 方式，或检查网络/依赖。
        pause
        exit /b 1
    )
    set "CP=evaluator\target\classes;%J1%;%J2%;%J3%;%J4%"
    goto :classpath_done
)

echo [2/4] 没有 Maven，改用 javac + 本机 .m2 里的 Jackson ...
for %%J in ("%J1%" "%J2%" "%J3%" "%J4%") do (
    if not exist "%%~J" (
        echo.
        echo [X] 缺少依赖: %%~J
        echo     说明本机 Maven 本地仓库里没有这个 jar。
        echo     二选一：装 Maven 后跑 mvn compile；或补齐上面的 jar。
        pause
        exit /b 1
    )
)
if not exist "evaluator\target\classes" mkdir "evaluator\target\classes"
set "CP=evaluator\target\classes;%J1%;%J2%;%J3%;%J4%"
javac -encoding UTF-8 -cp "%CP%" -d "evaluator\target\classes" ^
    evaluator\src\main\java\com\civ\eval\*.java ^
    evaluator\src\main\java\com\civ\eval\analyzer\*.java ^
    evaluator\src\main\java\com\civ\eval\loader\*.java ^
    evaluator\src\main\java\com\civ\eval\model\*.java
if errorlevel 1 (
    echo.
    echo [X] javac 编译失败。若报「拒绝访问」，说明是文件权限/杀软占用，不是代码问题。
    pause
    exit /b 1
)
echo       编译完成。

:classpath_done

rem ---------------------------------------------------------------------------
rem  [3/4] 启动 API 服务（工作目录必须是项目根，数据目录默认取 data\collected）
rem ---------------------------------------------------------------------------
echo [3/4] 启动 API 服务 http://localhost:8080 ...
start "civ6-eval-api" cmd /k "cd /d "%ROOT%" && java -cp "%CP%" com.civ.eval.ApiServer"

rem ---------------------------------------------------------------------------
rem  [4/4] 启动静态前端
rem ---------------------------------------------------------------------------
where python >nul 2>&1
if errorlevel 1 (
    echo [4/4] [!] 找不到 python，跳过前端。API 仍可直接访问。
) else (
    echo [4/4] 启动前端 http://localhost:8000/frontend/ ...
    start "civ6-eval-web" cmd /k "cd /d "%ROOT%" && python -m http.server 8000 --bind 127.0.0.1"
)

echo.
echo ------------------------------------------------------------
echo   验证一下（等 2~3 秒后）：
echo     http://localhost:8080/api/turns
echo     http://localhost:8000/frontend/
echo.
echo   数据目录：%ROOT%\data\collected （102 个回合，T039-T140）
echo   要换数据目录：设置环境变量 CIV6_DATA_DIR，或加 -Dciv6.eval.dataDir=...
echo.
echo   注意：这里完全不碰游戏。想真的下棋才需要 civ6claude.bat + 游戏 + FireTuner。
echo ------------------------------------------------------------
echo.
pause
endlocal
