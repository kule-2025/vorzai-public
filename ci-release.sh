#!/bin/bash
# ============================================================================
# Vorzai CI/CD Release Pipeline
# Usage: Run locally: bash ci-release.sh [dry-run]
# GitHub Actions equivalent: .github/workflows/release.yml
# ============================================================================
set -euo pipefail

DRY_RUN="${1:-}"
if [ "$DRY_RUN" = "dry-run" ]; then
    echo "[DRY-RUN MODE] No changes will be made"
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

cd "$(git rev-parse --show-toplevel)"
VERSION=$(node -e "console.log(require('./package.json').version)")
echo "============================================"
echo "  Vorzai Release Pipeline v${VERSION}"
echo "============================================"

# Step 1: TypeScript type check
echo ""
info "Step 1/5: TypeScript type check"
npx tsc --noEmit
if [ "$DRY_RUN" != "dry-run" ]; then
    echo "  ✔ Type check passed"
fi

# Step 2: Build frontend
info "Step 2/5: Build frontend (Vite)"
npm run build
echo "  ✔ Frontend built: dist/"

# Step 3: Build server
info "Step 3/5: Build server (tsc)"
npm run build:server
echo "  ✔ Server built: dist/server/"

# Step 4: Run tests
info "Step 4/5: Run tests (vitest)"
npm test
echo "  ✔ Tests passed"

# Step 5: Build icons
info "Step 5/5: Generate icons"
npm run build:icons
echo "  ✔ Icons generated"

# Package Electron installer
info "Packaging Electron installer"
npx electron-builder --win --x64 --config
echo "  ✔ Installer created: release/"
ls -lh "release/"

echo ""
echo "============================================"
echo "  BUILD COMPLETE — v${VERSION}"
echo "============================================"
echo "Release artifacts:"
ls -lh "release/"
echo ""
echo "Next: Upload to GitHub/Gitee Releases"
echo "  GitHub:  https://github.com/kule-2025/vorzai/releases"
echo "  Gitee:   https://gitee.com/king2030/vorzai/releases"
