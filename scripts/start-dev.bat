@echo off
chcp 65001 >nul
title Vorzai 电商 Agent · 启动器
setlocal

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║   Vorzai 电商 Agent · 开发环境一键启动         ║
echo  ║   行业专项 workbuddy 助手 · 100%% 原创         ║
echo  ╚══════════════════════════════════════════════╝
echo.

cd /d "%~dp0\.."

REM ── 1. 检查 node_modules ──
if not exist "node_modules" (
    echo [1/4] 首次启动，正在安装依赖（约 1~3 分钟）...
    call npm install
    if errorlevel 1 (
        echo.
        echo  ✗ 依赖安装失败，请检查网络后重试
        pause
        exit /b 1
    )
) else (
    echo [1/4] 依赖已就绪
)

REM ── 2. 类型检查（可选，跳过不阻塞启动） ──
echo [2/4] 检查类型（跳过不阻塞）...
REM call npm run typecheck

REM ── 3. 启动 Vite + Electron ──
echo [3/4] 启动 Vite + Electron ...
echo       提示：窗口将自动打开，按 Ctrl+C 可结束
echo.

REM 使用 concurrently 同时启动 Vite 与 Electron，wait-on 确保 Vite 就绪
call npx concurrently -k -n VITE,ELECTRON -c blue,magenta "vite" "wait-on http://localhost:3000 && cross-env NODE_ENV=development electron ."

REM ── 4. 退出 ──
echo.
echo [4/4] Vorzai 已退出
pause
endlocal
