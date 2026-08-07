#!/usr/bin/env bash
# Vorzai 电商 Agent · 开发环境一键启动（macOS / Linux）
set -e

cd "$(dirname "$0")/.."

echo
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   Vorzai 电商 Agent · 开发环境一键启动         ║"
echo "  ║   行业专项 workbuddy 助手 · 100% 原创         ║"
echo "  ╚══════════════════════════════════════════════╝"
echo

# 1. 依赖检查
if [ ! -d "node_modules" ]; then
    echo "[1/4] 首次启动，正在安装依赖..."
    npm install
fi

# 2. 启动
echo "[2/4] 启动 Vite + Electron ..."
echo "      提示：窗口将自动打开，按 Ctrl+C 结束"
echo

NODE_ENV=development npx concurrently -k -n VITE,ELECTRON -c blue,magenta \
  "vite" \
  "wait-on http://localhost:3000 && electron ."

echo
echo "[4/4] Vorzai 已退出"
