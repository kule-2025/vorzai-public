#!/bin/bash
set -euo pipefail

echo "=== VorZai v0.2.4 构建发布 ==="

# Step 1: TypeScript 检查
echo "[1/4] TypeScript 类型检查..."
npx tsc --noEmit
npx tsc -p server/tsconfig.json --noEmit

# Step 2: 构建前端
echo "[2/4] 构建前端 (Vite)..."
npm run build

# Step 3: 构建服务端
echo "[3/4] 构建服务端..."
npm run build:server

# Step 4: 测试
echo "[4/4] 运行测试..."
npm test

echo ""
echo "=== 构建完成 ==="
ls -lh release/ 2>/dev/null | grep -v "^total\|^d" || echo "运行 electron-builder 生成安装包..."
