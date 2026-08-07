# VorZai 构建与签名方法论

> 版本: 0.2.3 | 基于 0.2.0 成功构建分析提炼 | 2026-08-05

---

## 一、0.2.0 构建成功关键要素分析

### 1.1 环境基准（成功条件）

| 项目 | 成功值 | 失败风险 |
|------|--------|----------|
| Node.js | v22.22.2（≥18） | 使用 v18 以下会报 `ENGINTYPEERROR` |
| npm | 10.9.7 | 使用 yarn/pnpm 不保证 lockfile 兼容 |
| `package-lock.json` | **已提交到 git** | 缺失则 `npm install` 版本飘移 |
| `node_modules/.package-lock.json` | 存在 | npm 内部缓存校验用 |

### 1.2 依赖版本锁定（关键）

```
electron:         33.4.11
electron-builder: 25.1.8
better-sqlite3:   13.0.2
typescript:       5.9.3
vite:             5.4.21
@vitejs/plugin-react: 4.7.0
sharp:            0.35.3
tsx:              4.23.1
```

**关键发现：** `better-sqlite3@13.0.2` 自带 `prebuilds/win32-x64.node`（1.9MB），无需 native rebuild。若 npm 装到的版本没有 prebuilt，构建会因 `node-gyp` 失败。

### 1.3 electron-builder 配置关键点

```json
{
  "build": {
    "appId": "com.vorzai.ecommerce",
    "productName": "Vorzai 电商 Agent",
    "npmRebuild": false,      // ← 关键！跳过 native 模块重新编译
    "directories": { "output": "release" },
    "files": [
      "dist/**/*",
      "electron/**/*",
      "server/dist/**/*",
      "server/src/db/schema.sql"
    ],
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64"] }],
      "icon": "public/icon.png"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "language": "2052"
    }
  }
}
```

**`npmRebuild: false` 是避免 better-sqlite3 重新编译的核心配置。**

### 1.4 签名状态说明

| 产物 | 签名状态 | 说明 |
|------|---------|------|
| `Vorzai 电商 Agent Setup 0.2.0.exe` | **未签名** | 无 codeSignInfo 配置，用户安装时有 SmartScreen 警告 |
| `win-unpacked/Vorzai 电商 Agent.exe` | 未签名 | 同上 |
| electron 二进制（node.dll 等） | 微软预签名 | Windows 系统信任 |

**当前为自签项目，无正式签名证书。签名非阻塞因素。**

### 1.5 产物清单

```
release/
├── Vorzai 电商 Agent Setup 0.2.0.exe        (89.5MB)  ← 主安装包
├── Vorzai 电商 Agent Setup 0.2.0.exe.blockmap (0.1MB)  ← 增量更新指纹
├── latest.yml                                   ← 自动更新配置
├── builder-debug.yml                            ← 调试输出（可忽略）
└── win-unpacked/                                ← 解压目录（分发用）
    └── Vorzai 电商 Agent.exe
```

---

## 二、可复用构建方法论

### 2.1 前置检查清单（构建前必做）

```bash
# 1. 检查锁文件存在
test -f package-lock.json && echo "✅ lockfile OK" || echo "❌ 缺少 package-lock.json"

# 2. 检查 lockfile 与 package.json 版本一致
node -e "const l=require('./package-lock.json'); const p=require('./package.json');
  if(l.version===p.version) console.log('✅ 版本一致:', l.version);
  else console.log('❌ 版本不一致 lockfile='+l.version+' pkg='+p.version);"

# 3. 检查 native 模块 prebuilt
node -e "require('better-sqlite3')" && echo "✅ better-sqlite3 可用"

# 4. 检查 electron binary
test -f node_modules/electron/dist/electron.exe && echo "✅ electron binary OK"

# 5. 检查 electron-builder cache
test -d "$HOME/.cache/electron-builder" && echo "✅ electron-builder cache OK" || echo "⚠️ 缓存为空（首次构建会重新下载）"
```

### 2.2 标准构建流程（5 步）

```
Step 1: tsc --noEmit          → TypeScript 类型检查（快速失败）
Step 2: vite build            → 前端打包（ES2020 target）
Step 3: tsc -p server/tsconfig.json  → 后端打包
Step 4: npm test              → 全量测试（114 cases）
Step 5: electron-builder --win --x64  → NSIS 安装包
```

### 2.3 失败模式与修复方案

| 失败现象 | 根因 | 修复方案 |
|----------|------|----------|
| `cannot find module better_sqlite3.node` | native rebuild 失败 | 确认 `npmRebuild: false`；确保有 `prebuilds/win32-x64.node` |
| `npm install` 后版本飘移 | `package-lock.json` 丢失或被忽略 | 将 lockfile 加入 git；`.gitignore` 仅排除 `node_modules/` |
| `electron-builder: Cannot find module` | `node_modules` 被意外清理 | 构建前执行 `npm ci`（而非 `npm install`） |
| SmartScreen 警告 | 无代码签名证书 | 购买 EV 代码签名证书；或配置 `win.codeSignInfo` |
| Vite `crossorigin` 错误 | Electron file:// 协议下 crossorigin 阻止 ES module | vite.config.ts 的 `removeCrossorigin` 插件（已存在） |
| `node:fs` 路径含中文报错 | Windows Git Bash 路径问题 | 用 PowerShell 或 Node.js 脚本调用 |

### 2.4 环境变量与密钥管理

```bash
# ✅ 应该 gitignore 的文件
.env
.env.local
.env.*.local

# ❌ 不应存在但当前存在的文件
.env  # 含 GITHUB_TOKEN/GITEE_TOKEN → 需加入 .gitignore 并 .env.example 替代
```

**修复动作（本次 0.2.1）：** 将 `.env` 加入 `.gitignore`，创建 `.env.example` 说明。

---

## 三、签名方法论

### 3.1 当前状态：未签名

- 无 `win.codeSignInfo` 配置
- 无 `signtool`（未安装 Windows SDK）
- 无有效代码签名证书

### 3.2 未来签名方案（参考）

```json
{
  "build": {
    "win": {
      "codeSignInfo": {
        "sha1": null,
        "sha256": null,
        "url": "http://timestamp.digicert.com"
      },
      "certificateFile": "C:\\certs\\code-signing.pfx",
      "certificatePassword": "%SIGNING_PASSWORD%"
    }
  }
}
```

**前置条件：**
1. 购买 EV 代码签名证书（DigiCert / GlobalSign）
2. 安装 Windows SDK（提供 `signtool.exe`）
3. 将 `.pfx` 文件加入 `.gitignore`，通过 CI 环境变量注入

### 3.3 自签方案（测试用）

```powershell
# 生成自签证书（仅用于内部测试）
$cert = New-SelfSignedCertificate -DnsName "Vorzai" -CertStoreLocation "Cert:\CurrentUser\My" -KeyUsage DigitalSignature
Export-PfxCertificate -Cert $cert -FilePath "C:\certs\selfsigned.pfx" -Password (ConvertTo-SecureString "password" -AsPlainText -Force)
```

---

## 四、规范化检查清单（发布前执行）

### Pre-Build（构建前）

- [ ] `package-lock.json` 存在且已提交到 git
- [ ] `node_modules/` 已安装（`npm ci` 或 `npm install`）
- [ ] `npx tsc --noEmit` 输出 0 errors
- [ ] `.env` 不含敏感密钥（或使用 `.env.example`）
- [ ] `release/` 不在 git tracked 文件中

### During Build（构建中）

- [ ] `npmRebuild: false` 已配置（避免 native 模块重编译）
- [ ] `better-sqlite3/prebuilds/win32-x64.node` 存在
- [ ] electron-builder cache 目录存在（`$HOME/.cache/electron-builder`）

### Post-Build（构建后）

- [ ] `release/Vorzai 电商 Agent Setup vX.Y.Z.exe` 存在
- [ ] `release/latest.yml` 版本匹配
- [ ] `release/*.blockmap` 存在
- [ ] 安装包可正常运行（双击安装）

### 签名（可选，有证书时）

- [ ] `win.codeSignInfo` 已配置
- [ ] 签名证书 `.pfx` 通过 CI 环境变量注入（不入库）
- [ ] 签名时间戳 URL 有效（`http://timestamp.digicert.com`）

---

## 五、0.2.1 版本内容

### 本次修复

| 项目 | 说明 |
|------|------|
| 版本升级 | 0.2.0 → 0.2.1 |
| 安全修复 | `.env`（含 GITHUB_TOKEN/GITEE_TOKEN）加入 `.gitignore`，创建 `.env.example` |
| 文档补充 | 新增 `BUILD-METHODOLOGY.md` 记录本次分析 |

### 不变内容

- 0.2.0 已修复的全部 R3 审计问题（729ba2c、62211b9、f8e588d、0d7694e 共 4 个 commit）
- 所有功能代码无变更
- `package-lock.json` 版本同步更新
