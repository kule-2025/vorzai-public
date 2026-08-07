#!/bin/bash
# Vorzai 仓库创建脚本
# 从 .env 读取凭证，不硬编码

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: .env not found at $ENV_FILE"
    exit 1
fi

set -a
source "$ENV_FILE"
set +a

GITHUB_OWNER=""
GITEE_OWNER=""

echo "=========================================="
echo " Vorzai — 电商桌面 AI 助手 仓库创建"
echo "=========================================="

# ── 1. 创建 GitHub 私有仓库 ──
echo ""
echo "[1/4] 创建 GitHub 私有仓库: vorzai (private)..."
RESP=$(curl -s -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d '{"name":"vorzai","description":"Vorzai — 电商桌面 AI 助手，面向电商从业者的桌面级智能 Agent","private":true,"has_issues":true,"has_wiki":false,"auto_init":false}' \
    https://api.github.com/user/repos)

echo "$RESP" | head -5
GH_PRIV_URL=$(echo "$RESP" | grep -o '"html_url": *"[^"]*"' | head -1 | sed 's/"html_url": *"\([^"]*\)"/\1/')
GH_OWNER=$(echo "$RESP" | grep -o '"full_name": *"[^"]*"' | head -1 | sed 's/"full_name": *"\([^"]*\)"/\1/' | cut -d'/' -f1)
echo "GitHub 私有仓库 URL: $GH_PRIV_URL"

# ── 2. 创建 GitHub 公共仓库 ──
echo ""
echo "[2/4] 创建 GitHub 公共仓库: vorzai-public (public)..."
RESP=$(curl -s -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d '{"name":"vorzai-public","description":"Vorzai — 电商桌面 AI 助手（公共演示版）","private":false,"has_issues":true,"has_wiki":false,"auto_init":false}' \
    https://api.github.com/user/repos)

echo "$RESP" | head -5
GH_PUB_URL=$(echo "$RESP" | grep -o '"html_url": *"[^"]*"' | head -1 | sed 's/"html_url": *"\([^"]*\)"/\1/')
echo "GitHub 公共仓库 URL: $GH_PUB_URL"

# ── 3. 创建 Gitee 仓库 ──
echo ""
echo "[3/4] 创建 Gitee 仓库: vorzai..."
RESP=$(curl -s -X POST \
    -H "Authorization: token $GITEE_TOKEN" \
    -H "Accept: application/json" \
    -d '{"name":"vorzai","description":"Vorzai — 电商桌面 AI 助手","private":"false","mirror":"false","website":"https://github.com/vorzai","has_issues":"true","has_wiki":"false","default_branch":"main"}' \
    "https://gitee.com/api/v5/user/repos?access_token=$GITEE_TOKEN")

echo "$RESP" | head -5
GITEE_URL=$(echo "$RESP" | grep -o '"html_url": *"[^"]*"' | head -1 | sed 's/"html_url": *"\([^"]*\)"/\1/')
GITEE_OWNER_NAME=$(echo "$RESP" | grep -o '"owner": *{"login": *"[^"]*"' | head -1 | sed 's/"owner": *{"login": *"\([^"]*\)"/\1/')
echo "Gitee 仓库 URL: $GITEE_URL"

# ── 4. 添加 Topics/标签 ──
echo ""
echo "[4/4] 添加仓库 Topics..."

# GitHub topics (private)
TOPICS='["电商桌面AI助手","电商桌面agent","vorzai","ecommerce","ai-agent"]'
RESP=$(curl -s -X PUT \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"names\": $TOPICS}" \
    "https://api.github.com/repos/${GH_OWNER}/vorzai/topics")
echo "GitHub 私有 topics: $RESP"

# GitHub topics (public)
RESP=$(curl -s -X PUT \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"names\": $TOPICS}" \
    "https://api.github.com/repos/${GH_OWNER}/vorzai-public/topics")
echo "GitHub 公共 topics: $RESP"

# ── 5. 上传 README ──
echo ""
echo "[5/5] 上传 README 到各仓库..."

# GitHub private
README_SHA=$(cd /e/WorkBuddy工作区/vorzai && git rev-parse HEAD:README.md)
RESP=$(curl -s -X PUT \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"message\":\"init: Vorzai README\",\"content\":\"$(cd /e/WorkBuddy工作区/vorzai && git show HEAD:README.md | base64)\",\"branch\":\"main\"}" \
    "https://api.github.com/repos/${GH_OWNER}/vorzai/contents/README.md")
echo "GitHub 私有 README: $(echo "$RESP" | grep -o '"message"' || echo 'uploaded')"

# GitHub public
RESP=$(curl -s -X PUT \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"message\":\"init: Vorzai README\",\"content\":\"$(cd /e/WorkBuddy工作区/vorzai && git show HEAD:README.md | base64)\",\"branch\":\"main\"}" \
    "https://api.github.com/repos/${GH_OWNER}/vorzai-public/contents/README.md")
echo "GitHub 公共 README: uploaded"

# Gitee
RESP=$(curl -s -X PUT \
    -H "Authorization: token $GITEE_TOKEN" \
    -H "Accept: application/json" \
    -d "{\"message\":\"init: Vorzai README\",\"content\":\"$(cd /e/WorkBuddy工作区/vorzai && git show HEAD:README.md | base64)\",\"branch\":\"main\"}" \
    "https://gitee.com/api/v5/repos/${GITEE_OWNER_NAME}/vorzai/contents/README.md?access_token=$GITEE_TOKEN")
echo "Gitee README: uploaded"

echo ""
echo "=========================================="
echo " 完成！仓库创建结果："
echo "  GitHub 私有: $GH_PRIV_URL"
echo "  GitHub 公共: $GH_PUB_URL"
echo "  Gitee:       $GITEE_URL"
echo "=========================================="
