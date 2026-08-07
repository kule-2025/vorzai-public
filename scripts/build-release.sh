#!/usr/bin/env bash
set -euo pipefail

# Vorzai 电商 Agent — 本地构建发布脚本
# 用法: bash scripts/build-release.sh [--bump=patch|minor|major]

BUMP="${1#--bump=}"
VERSION=$(node -e "console.log(require('./package.json').version)")

echo "=== Vorzai v${VERSION} — 本地构建发布 ==="

# Step 1: TypeScript 严格模式检查
echo "[1/5] TypeScript 类型检查..."
npx tsc --noEmit

# Step 2: 前端构建
echo "[2/5] 构建前端 (Vite)..."
npm run build

# Step 3: Server 构建
echo "[3/5] 构建后端..."
npm run build:server

# Step 4: 运行测试
echo "[4/5] 运行测试套件..."
npm test

# Step 5: 打包 Electron 安装包
echo "[5/5] 打包 Electron installer..."
npx electron-builder --win --x64 --config

echo ""
echo "=== 构建完成 ==="
echo "产物目录: release/"
ls -lh release/ | grep -v "^total\|^d"
