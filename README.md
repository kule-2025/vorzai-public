# Vorzai — HR 洞察 × 电商 业绩倍增平台

<div align="center">

**Vorzai** 是一款面向电商企业的桌面级 **HR × 业务** 协同智能体。以 **HR 洞察** 为核心引擎，深度嵌入电商各业务场景，实时发现组织痛点、自动生成解决方案、精准归因激励回报，实现 **"人效即业绩"** 的倍增效应。

**核心理念**：不是 HR 管业务，而是 HR 洞察 × 业务数据双引擎驱动增长。

[![Version](https://img.shields.io/badge/version-0.2.43-blue.svg)](https://github.com/kule-2025/vorzai-public/releases/tag/v0.2.43)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)
[![Tests](https://img.shields.io/badge/tests-708%20passed-brightgreen.svg)](#)
[![Coverage](https://img.shields.io/badge/dual--source-GitHub%20%7C%20Gitee-purple.svg)](#)

</div>

---

## 🚀 快速开始

### 下载安装

**Windows**: [下载最新安装包 (v0.2.43)](https://github.com/kule-2025/vorzai-public/releases/download/v0.2.43/vorzai-ecommerce%20Setup%200.2.43.exe) (SHA512 见 Release 页面摘要文件)

**macOS/Linux**: [查看所有 Release 版本](https://github.com/kule-2025/vorzai-public/releases)

> ⚠️ **重要说明**：安装包位于 GitHub Releases 页面，不在代码仓库目录中。请点击上方链接或访问 [Releases](https://github.com/kule-2025/vorzai-public/releases) 下载。
>
> **完整性校验（fail-closed）**：每次更新均附带 Minisign Ed25519 签名与 SHA-512/SHA-256 摘要，客户端在校验全部通过前拒绝应用更新。

### 双源下载

| 源 | 状态 | 下载地址 |
|---|------|---------|
| **GitHub（主源）** | ✅ 正常（安装包托管） | [Releases · v0.2.43](https://github.com/kule-2025/vorzai-public/releases/tag/v0.2.43) |
| **Gitee raw（回退源 1）** | ✅ 元数据回退，注入主源直链 | `gitee.com/king2030/vorzai/raw/main/latest.yml` |
| **Gitee Release API（回退源 2）** | ✅ 版本元数据三级回退 | `gitee.com/api/v5/repos/king2030/vorzai/releases/tags/v0.2.43` |

> 客户端按 `GitHub Release → Gitee raw → Gitee API` 三级依次尝试，任一成功即完成更新。

---

## ✨ 核心能力

**传统 HR 管"人"，Vorzai HR 管"人效 × 业绩"**

我们将人力资源能力从"成本中心"转变为"利润中心"，通过深度嵌入电商业务场景，实现从 **痛点洞察 → 解决方案 → 业绩倍增** 的完整闭环。

---

### 🔍 业务痛点智能洞察

| 电商场景 | 典型痛点 | Vorzai 解决方案 |
|---------|---------|----------------|
| **直播电商** | 大促期间主播排班混乱、话术违规无法实时发现、主播绩效只看销量忽略转化 | 智能排班引擎、话术合规实时检查、多维度主播绩效模型（GMV × 转化率 × 好评率） |
| **跨境电商** | 多语种人才错配、物流报关合规风险高、多币种薪酬核算复杂 | 多语种人才自动匹配、报关合规人才画像、多币种自动薪酬核算 |
| **传统电商** | 客服绩效"大锅饭"、大促临时人力不足、订单驱动的激励无法精准归因 | 订单驱动的客服绩效引擎、大促人力智能预测与储备、个人级激励精准归因 |
| **供应链** | 采购质检岗位胜任力模糊、损耗率与人效脱节、采购激励缺失 | 采购/质检岗位胜任力模型、损耗率与人效联动分析、采购绩效激励引擎 |

---

### 🚀 业绩倍增引擎（Doubling Lab）

**核心路径：基线分析 → 缺口分解 → 增编建议 → 激励预算 → ROI 预测**

1. **基线诊断**：自动采集当前组织的人均 GMV、成本效率、团队结构、技能分布
2. **缺口三杠杆分解**：将业绩缺口分解为 **编制缺口 × 人效缺口 × 客单价缺口**（恒等总缺口）
3. **分岗位增编建议**：基于岗位模型和业务目标，精确建议各岗位增编数量
4. **激励预算规划**：根据岗位绩效模型，计算激励预算与预期 ROI
5. **风险预警**：自动识别团队士气、技能缺口、工作负载等风险点

> 📖 详见 [hrService.ts](server/src/services/hrService.ts) · [HR Insight 前端](src/views/HRMS/HRInsight.tsx)

---

### 📊 人效数据驱动业务决策

- **实时人效监控**：人均 GMV、人均订单、客服响应时长、主播场观转化率
- **岗位差异化绩效模型**：运营/客服/主播/跨境/HR 5 类岗位差异化权重，无匹配自动回退默认模型
- **个人级激励归因**：打破"大锅饭"，按 `personal_gmv` / `performance_score` / `attendance_rate` 精准归因
- **OGSM 目标联动**：HR 考核结果自动回写 OGSM，形成业务目标 → 考核 → 激励的完整闭环

---

### 🌐 全链路电商业务域

| 业务域 | 核心能力 |
|--------|---------|
| **跨境电商** | 报关单追踪、国际物流监控、币种汇率管理、订单履约闭环 |
| **直播电商** | 主播绩效分析、话术库管理、合规报告、实时大屏指标 |
| **传统电商** | 订单→发货→售后全流程、营销 ROI 分析、评价管理 |
| **线上线下联动** | 门店库存同步、到店核销、会员通兑、渠道归因 |
| **供应链体系** | 采购订单管理、供应商评估、入库质检、损耗分析 |

---

### 🤖 AI 与数据智能

- **多平台数据聚合**：驾驶舱（Cockpit）实时监控跨渠道核心指标
- **LLM 驱动的决策支持**：商品选品、定价建议、营销文案自动生成
- **智能营销自动化**：活动规划 → 投放执行 → 效果归因全流程
- **订单与库存自动化**：低库存预警、自动补货建议、智能调度
- **知识库 + 工作流引擎**：可编排业务 Agent，实现复杂业务场景自动化

---

### 🛡️ 企业级安全保障

- **会话安全**：JWT 会话吊销机制（token_version + 黑名单），改密/登出立即失效
- **数据隔离**：多租户数据隔离、RBAC 角色权限、越权访问拦截（IDOR）
- **注入防护**：XSS/SQL 注入防护、请求级输入清理
- **日志三级降级**：显式目录 → Electron userData → 临时目录，可写探测后落地
- **端口自动管理**：端口 19527 残留进程自动清理与重试启动
- **完整性校验**：Minisign Ed25519 签名 + SHA-512/256 fail-closed 校验

---

## 🛠 技术栈

- **桌面框架**：Electron 33 + React 18 + TypeScript 5
- **后端服务**：Express + SQLite（node:sqlite 原生驱动），数据库初始化失败自动降级 HTTP 就绪模式
- **数据访问**：原生 SQL 聚合，参数化查询，热路径索引，缓存（LRU + 命名空间批量失效）
- **鉴权层**：bcrypt 密码 + JWT access/refresh token + token_version 会话吊销 + IP/UA 节流
- **AI 引擎**：LLM Adapter 架构（多模型/多供应商切换）
- **数据存储**：本地 SQLite（离线可用），用户级路径自动回退
- **CI/CD**：GitHub Actions（门禁→Windows 构建→签名→双源发布）+ 本地一键发布管线
- **更新机制**：无感自动更新（GitHub/Gitee 三源回退 + minisign 签名 + SHA-512/256 完整性校验 fail-closed）
- **测试框架**：Vitest（708 全量），TSC 类型检查，ESLint 规则集

---

## 📦 构建与开发

```bash
# 克隆私有仓库（需权限）
git clone git@github.com:kule-2025/vorzai.git
cd vorzai

# 安装依赖
npm install --legacy-peer-deps

# 开发模式（前端 + 后端 + Electron 热更新）
npm run dev:full

# 生产构建（后端编译 + Vite 打包 + NSIS 安装包 + minisign 签名）
npm run build:electron

# 全量测试（前端 + 后端）
npm run test          # 全量 708 用例（46 套件：前端 + 后端）
npm run test:server   # 仅后端
npm run typecheck     # TS 类型检查
npm run lint          # ESLint

# 一键发布（门禁 → 构建 → 签名 → 双源上传 → 一致性校验）
# 需要环境变量：GH_PAT / GITEE_TOKEN / MINISIGN_PRIVATE_KEY / MINISIGN_PUBLIC_KEY
node scripts/local-ci.mjs --publish

# 或分阶段发布（CI 已完成构建后补发 Release 资产）
node scripts/release/publish-github.mjs --version 0.2.27 --dir release
node scripts/release/publish-gitee.mjs  --version 0.2.27 --download-url "<github url>" --dir release
node scripts/verify-dual-source.mjs     --version 0.2.27
```

详细发布流程与降级策略见 [双源部署 SOP](docs/dual-source-deployment-sop.md)。

---

## 🔐 双源部署架构

```
应用启动 → checkForUpdate()
    ↓
尝试 GitHub Release API（主源）                    ─┐
    ↓ ✅ 命中 → 跟随 3xx 重定向 → 下载               │
    ↓ ❌ 失败（限流 / 阻断 / 404）                  │
尝试 Gitee raw/main/latest.yml（回退源 1）            │ 三级回退
    ↓ ✅ 命中 → 解析内置 downloadUrl（指向主源）       │
    ↓ ❌ 失败                                        │
尝试 Gitee Release API（回退源 2）                    │
    ↓ ✅ 命中 → 下载                                 │
    ↓ ❌ 失败 → 提示用户手动检查                     ─┘
    ↓
下载完成 → 完整性校验（fail-closed：必须命中 SHA-512 或 SHA-256 + minisign 签名）
    ↓ ✅
写入 pending → 通知前端 → 下次启动备份→替换→自校验→失败自动回滚
```

**关键源码**：
- 无感更新主流程：[`electron/updater.js`](electron/updater.js)
- 主源发布：[`scripts/release/publish-github.mjs`](scripts/release/publish-github.mjs)
- 备源同步：[`scripts/release/publish-gitee.mjs`](scripts/release/publish-gitee.mjs)
- 一致性验证：[`scripts/verify-dual-source.mjs`](scripts/verify-dual-source.mjs)

---

## 📝 更新日志

### v0.2.43（2026-08-28）

**P1业务闭环CRUD补全（财务中心）：**

- **财务中心-交易流水新增功能**：新增交易记录模态框（日期/类型/分类/金额/描述/关联单号），支持收入/支出类型，表单校验必填项
- **财务中心-交易流水导出功能**：支持导出当前筛选结果为CSV文件（含BOM头，Excel兼容中文）
- **后端API补全**：新增 `POST /api/finance/transactions` 路由，支持新增交易记录，含参数校验和租户隔离
- **前端API补全**：`api.finance.createTransaction()` 方法添加，完整前后端链路打通
- **P1业务闭环审计启动**：覆盖左侧导航栏全部子功能，优先补全缺少交互编辑页（CRUD、导入导出、保存）的子功能

### v0.2.42（2026-08-28）

**模型选择器增强与品牌图标替换（多角色专家团交付）：**

- **模型选择器全量可管理**：所有模型（含默认模型/大模型平台同步模型/自定义模型）均支持删除/隐藏，默认模型隐藏后可一键恢复，localStorage 持久化用户偏好
- **桌面应用图标替换**：应用图标从默认 Electron 原子图标替换为 Vorzai 品牌 logo（橙色 V 字设计），生成 16/32/48/64/128/256/512/1024 全尺寸图标，桌面快捷方式与安装包统一品牌视觉
- **公共仓库源码排查**：GitHub/Gitee 公共仓库全量排查，确认仅含 README.md 与 latest.yml，无源码泄漏
- **双源部署方法论升级**：新增最高执行规则第一条——每次版本发布必须同步更新 GitHub 和 Gitee 双仓库 README，版本号与下载链接强制对齐

### v0.2.41（2026-08-28）

**P0四项任务闭环与应用内更新体验优化（多角色专家团交付）：**

- **P0-1 全局合规扫描**：全量扫描应用代码，确认无 workbuddy/trae/windsurf 等第三方名称残留，100% 原创品牌表述
- **P0-2 历史会话持久化修复**：修复 `loadConversations` 字段映射（snake_case→camelCase），修复 `loadConversationMessages` 时间戳映射，发送消息后自动刷新会话列表，对话内容完整留存恢复
- **P0-3 模型双向同步**：对话框模型选择器新增从大模型平台（`api.llm.list()`）同步配置模型，去重合并默认+平台+自定义模型，大模型平台配置即时生效
- **P0-4 对话框自定义模型**：对话框内支持添加/删除自定义模型（API端点+Key），保存到 localStorage 持久化，与大模型平台模型合并展示
- **关于页面侵权表述修复**：移除"对标钉钉账号权限"等侵权表述，改为原创"全链路账号权限管理 + 多平台协作连接器预留"
- **应用内更新超时优化**：更新请求超时从 20s 提升至 60s，改善弱网环境下 GitHub Release 访问体验，双源三级回退（GitHub→Gitee raw→Gitee API）保持生效
- **双源部署方法论升级**：新增最高执行规则第一条——每次版本发布必须同步更新 GitHub 和 Gitee 双仓库 README，版本号与下载链接强制对齐

### v0.2.27（2026-08-23）

**生产级全功能键审计与多角色专家团修复（Phase J 交付）：**

- **功能键交互闭环修复（P0）**：
  - `GET /business/products/:id` 商品详情路由缺失 → 新增路由，消除 404
  - HR 模块 3 处 `datetime("now")` 双引号→单引号，修复 `PUT /hr/policies|incentives|pilots/:id` 500（根因：SQLite 将双引号字符串解析为列名）
  - `PUT /business/tickets/:id/escalate` 升级工单 500 → `status='escalated'` 违反 CHECK 约束 + `escalate_reason` 列不存在，改为 `priority='urgent'` 并将升级原因追加至 description，保留原状态
- **安全加固（延续 Phase J）**：Owner 自删除 SQL 双引号修复、Admin 密码 bcrypt 哈希、Admin 自提权拦截、Workflow 创建 RBAC 守卫、JSON fallback 无 WHERE fail-fast
- **回归验证**：vitest 708/708 全绿（server 529 + renderer 179），TSC 前后端 0 错误

### v0.2.26（2026-08-22）

**登录态闭环与 LLM 卡片重设计（多角色专家团交付）：**

- **登录态与登出闭环（会话失效强制回登录页）**：
  - `api/client.ts`：重构 401 处理——令牌刷新失败 / 无刷新令牌时清理本地会话并回调登出，消除「假登录态反复 401」；新增 `translateAuthError` 将后端技术性报错（已过期 / 已撤销 / 无效 / 缺少）翻译为用户可读文案
  - `App.tsx`：订阅 `auth:session-expired` 事件，令牌失效时强制回到登录页
  - `appStore.ts`：`logout()` 结束广播 `auth:session-expired`；模块加载时注册 `setAuthFailureHandler`，令牌无法恢复即清理用户态并广播会话过期
  - `electron/main.js`：主进程菜单新增「退出登录」项（`menu:logout`）；`AppLayout` 接住该事件调用 `logout`
  - `Sidebar.tsx`：用户区新增「退出登录」按钮；头像 / 名称 fallback 改进（`email` 首字母 / 「未命名用户」）
  - `AuthView.tsx`：用户名 fallback 改进（displayName -> username -> name -> 邮箱前缀 -> 「未命名用户」）
- **多租户本地化（#412）**：`plan` 代码本地化为「免费版 / 专业版 / 团队版 / 商业版 / 企业版」标签；「套餐」改为「当前版本」；「资源限制」改为「容量规划」，明确本地存储产品无云端存储额度与 API 调用计费限制，移除存储空间 / API 调用量展示
- **LLM 平台文案与卡片重设计（#413 / #403 N4）**：
  - `describeLlmError()` 本地化连接测试错误（401 / 无效密钥 / 模型不存在 / 连接失败 / 限额），替代原技术性原始报错
  - `ModelCard` 视觉重设计：激活态改用品牌琥珀金描边 + 光晕；模型列表改为可换行 chip（前 3 个 + 「+N」）；移除堆叠的 Base URL + 模型明细大块，信息层级收敛、减少页面占用，对齐品牌调性
- **测试**：TSC 前后端 0 错误

### v0.2.24（2026-08-21）

**版本更新系统重构与全栈优化（多角色专家团交付）：**

- **HR 洞察业务场景痛点解决方案**（核心定位）：
  - 直播电商：主播排班引擎、话术合规实时检查、GMV×转化率×好评率多维绩效模型
  - 跨境电商：多语种人才自动匹配、报关合规人才画像、多币种薪酬核算
  - 传统电商：订单驱动客服绩效引擎、大促人力智能预测、个人级激励精准归因
  - 供应链：采购质检胜任力模型、损耗率与人效联动、采购绩效激励引擎
- **版本更新系统三合一修复**：
  - 启动自动弹窗：新增 `onCheck` 回调，发现新版本时立即发送 `update:available` 事件触发弹窗（原逻辑仅下载完成后才发 `update:downloaded`，导致弹窗时机过晚且 'deferred'/'up-to-date' 误触发）
  - "检查更新"按钮：`api.checkForUpdate()` → 设置 store → 显示 UpdateNotification + toast 反馈，完整链路已验证
  - "立即更新"按钮：`handleInstallNow` 改为直接使用 store 中 `updateAvailable` 缓存数据（不再重新 fetch 避免 Release 构建中失败），通过 `ipcRenderer.invoke` 触发 `update:download` → `update:install` 完整安装链
- **顶部下拉菜单清理**：移除 5 个无实现的功能键（open-file/export/save/shortcuts/feedback），仅保留有完整数据流的核心功能（new-chat/navigate/toggle-sidebar/check-update）
- **版本号统一升级**：`package.json` / `.env` / `vite.config.ts` / `Settings.tsx` 全部对齐为 0.2.24
- **SHA256 校验链完善**：`UpdateInfo` 类型新增 `sha256` 字段，`setUpdateAvailable` 三处调用点全部传递，`triggerUpdate` 使用 `invoke` 替代 `send` 确保主进程 handler 被正确触发
- **测试**：TSC 0 错误

### v0.2.22（2026-08-20）

**PRO 功能完善与费用文案清理（多角色专家团交付）：**

- Settings 主密码管理 / API Key 加密存储（AES-GCM + PBKDF2） / 审计日志 / 计费升级模态框（免费→专业→企业版对比）全面接线
- LLM 平台费用说明文案清理：移除"套餐内含基础调用量"等误导性表述，统一标注"免费"或"本地部署"
- 多租户资源限制区简化：移除"API 调用量与存储空间按实际消耗扣除"等模糊表述

### v0.2.12（2026-08-17）

**启动崩溃热修复（多角色专家团诊断交付）：**

- **P0 修复：安装后点击无反应**：根因定位为 `better-sqlite3@13.x` prebuild 二进制与 Electron 33（内置 Node 20.18，N-API 符号覆盖不全）不兼容——模块可加载，但首次 `new Database()` 在原生层直接崩溃，进程无声退出（无 JS 异常、try/catch 无法捕获）。0.2.11 携带的新 prebuild 恰好触发该路径
- **驱动安全降级机制**：主进程在打包环境 + Electron < 35 时自动设置 `VORZAI_DISABLE_BETTER_SQLITE3=1`，数据库驱动链降级为 sql.js（WASM，零原生依赖，完整 SQL 支持），开发环境（Node 25）不受影响
- **解除条件**：升级 Electron ≥ 35 并实测 better-sqlite3 兼容后移除该禁用逻辑
- **诊断方法沉淀**：构建 --dir 产物 + 无沙箱计划任务复现 + 主进程落盘插桩探针，完整取证链定位原生崩溃点

### v0.2.11（2026-08-17）

**PostgreSQL 数据库迁移与无感更新对齐（多角色专家团交付）：**

- **PostgreSQL 适配器重构**：将数据库适配器从 SQLite 迁移至 PostgreSQL，使用 pg 库通过子进程通信模式解决 Windows 中文环境编码问题
- **Boolean 字段类型转换**：实现 `adaptSqlForPg` 函数，自动将 SQLite 的 0/1 整数值转换为 PostgreSQL 的 TRUE/FALSE 布尔值
- **参数化查询优化**：在 `pgRunner.ts` 中实现 `convertBooleanParams` 函数，根据 SQL 列名自动转换参数类型
- **SQL 语法兼容**：`adaptSqlForPg` 函数处理占位符（`?` → `$1, $2, ...`）、日期函数（`datetime('now')` → `NOW()`）等 SQLite/PostgreSQL 语法差异
- **双源发布机制**：实现 GitHub（主源）+ Gitee（备源）双源发布，支持三级回退策略（GitHub Release → Gitee raw → Gitee Release API）
- **无感更新对齐**：应用内无感更新流程与版本号对齐，启动时自动检查、后台下载、下次启动应用，支持更新提醒
- **全链路验证**：注册、登录、用户信息 API 全链路通过 PostgreSQL 验证
- **代码质量**：修复 `authService.ts`、`seed.ts` 等文件中的 boolean 字段硬编码问题

### v0.2.10（2026-08-17）

**HR 业务洞察模块与版本升级（多角色专家团交付）：**

- **HR 业务洞察服务**：新增三大能力支柱——业务场景信息采集、业务洞察分析、痛点解决方案
  - 场景采集：自动识别电商大促、新品类拓展、客服压力等业务场景
  - 洞察分析：人效差距、团队结构、技能缺口、工作负载均衡四维度分析
  - 痛点方案：电商行业痛点知识库（大促用工、客服高压、新品培训、团队士气、绩效差距）
- **后端服务修复**：修复健康检查 API 路径双重 `/api` 问题，版本号动态读取 package.json
- **Logo 与 UI**：重新生成 V 形渐变 Logo 图标，支持所有尺寸
- **交互增强**：密码输入框显示/隐藏切换功能
- **版本号统一**：前后端版本号同步为 0.2.10，修复多处硬编码版本号
- **数据库优化**：HR 洞察相关表结构（business_scenarios/hr_insights/pain_point_solutions）
- **代码质量**：TypeScript 类型修复，全量 `tsc --noEmit` 零错误，708 测试全绿

### v0.2.9（2026-08-17）

**UI/UX 全面升级与视觉增强（多角色专家团交付）：**

- **主题系统 v2.1 升级**：新增噪声纹理（SVG feTurbulence）、渐变网格背景、细粒度骨架屏、玻璃态进阶版（glass-soft/glass-panel）、琥珀金强光晕、涟漪/上浮/按压缩放微交互、浮动/极光/文字光扫动画
- **登录页重构**：渐变网格背景 + 极光柔光球双装饰 + 玻璃面板卡片 + 品牌 Slogan + 文字光扫标题 + 版本标识
- **工作台增强**：Hero 区极光装饰 + 文字光扫动画 + 4 KPI 骨架占位（无假数据） + 业务线卡片 fade-in-up 入场
- **组件交互优化**：Topbar 所有按钮 hover-lift 微交互 + 连接器徽章 pulse-glow；Sidebar 导航项 ripple-effect 涟漪反馈 + Logo fade-in 入场 + 在线状态 pulse 脉冲
- **RightPanel 数据真实化**：彻底移除 DEFAULT_CONNECTORS/DEFAULT_AGENTS mock 数据，改用 useAppStore 真实 connectors/agents；指标卡骨架屏 loading 占位；告警区动态统计
- **构建与测试**：`tsc --noEmit` 零错误；`vite build` 成功；708/708 测试全绿

### v0.2.8（2026-08-16）

**全维度评测 Debug：导航落地 / LLM 全链路打通 / HR 业绩倍增闭环（4 路并行专家交付）：**

- **左侧导航落地**：补齐 `/aftersales` viewMap 断链（store 状态覆盖 Bug）；新增「工作台」「大模型平台」导航入口（原孤立视图 UI 不可达）；「知识库/技能」双高亮合并；Topbar 页面标题 23 视图全覆盖（Record 编译期防漏）；Logo 可点击返回工作台；路由冒烟测试重写为单一事实源一致性断言（9 用例）
- **大模型平台全链路打通**：修复「UI 落库密钥无人消费」架构断层——`resolveRuntimeLLM` 平台优先/环境变量回退，chat 与对话引擎真实消费加密落库密钥；新增 `POST /api/llm/health-test` 与 `POST /api/llm/:id/health` 实测端点（8s 超时、404 自动降级最小对话探测、Anthropic 独立协议 x-api-key + /v1/messages）；连接前先验证密钥、失败不落库；补齐智谱 GLM / Moonshot 卡片；Electron CSP 补 4 个供应商域名；`.env.example` 补全 LLM 配置段与 `VORZAI_CRED_KEY` 说明
- **HR 为电商业绩倍增提供解决方案**：激励引擎个人归因 v2（`personal_gmv`/`performance_score`/`attendance_rate` 按员工采集，`achievement_rate` 从硬编码 0 改为真实 OGSM 达成率）；绩效计算岗位模型驱动（5 类电商岗位差异化权重，无匹配回退默认并标记来源）；新增业绩倍增实验室（`GET /api/hr/doubling-plan` + 倍增实验室 Tab：真实基线 → 缺口三杠杆分解（编制×人效×客单价，恒等总缺口）→ 分岗位增编建议 → 激励预算与 ROI → 风险清单）；RACI 矩阵前后端打通（弃用本地 IndexedDB 双轨，后端为单一事实源）
- **冗余清理**：删除 64 个无引用文件（根目录 13 项一次性脚本/目录快照/builder 变体 + scripts/ 51 个历史脚本），删除前逐批引用复核；`perf:baseline`/`perf:seed` 接入 npm scripts；`Modules/index.ts` barrel 补齐 4 个缺失导出
- **测试**：`46 套件 708 用例`全绿（新增 LLM 健康检测 17 例、HR 倍增方案 12 例、个人归因 7 例、岗位模型绩效 7 例）；TSC 前后端 0 错误；ESLint 0 错误；updater 30 项回归全绿

### v0.2.7（2026-08-16）

**多角色专家团全量评测修复（7 大任务并行完成）：**

- **安全加固**：JWT 会话吊销机制落地（`users.token_version` + `access_token_blacklist` 表），登出/改密使旧令牌立即失效；输入/日志注入清洗；端口占用自动清理；数据库路径三级降级
- **16 端点闭环修复**：500×5 根因（SQL 列名错误、参数绑定、空值分支）、404×4 新端点（跨境订单、直播主播绩效/话术/合规、商业分析）、8 条契约路由接线补全
- **性能优化**：N+1 查询修复，DB 索引补齐，高频数据 LRU 缓存，前端请求去重与响应缓存，启动时剔除种子数据阻塞加载
- **管线缺陷修复**：ESLint 门禁改用 JSON 精确计数（解决 `/error/gi` 把 warning 文本里的 `AuthorizationError` 等标识符误计为错误），`runSilent` 缓冲 1MB→64MB（解决 ESLint JSON 输出被截断）
- **双源发布**：健康端点版本号 `0.2.4`→`0.2.7` 对齐；v0.2.7 Release 重建（删旧建新型），6 件资产（exe / blockmap / sig / sha512 / sha256 / latest.yml）上传+回读校验通过；Gitee `latest.yml` 注入主源直链
- **类型与接口统一**：API client 契约对齐，TypeScript 泛型补齐；前端 `checkBackend` 双前缀 bug 修复；`tickets` 方法签名对齐
- **清理**：种子模块死代码、调试残留文件（_v.js / verify.js / simple-module / simple-ts / with-interface）、dist-cleanup 旧产物
- **测试**：`675 前端 + 487 后端 = 1162` 测试全绿；TSC 0 错误；ESLint 0 错误；updater 模块 30 项回归全绿

### v0.2.6（2026-08-14）
- Minisign Ed25519 签名体系集成（安装包完整性校验）
- 双源更新链路：GitHub Release → Gitee Release API → Gitee raw URL 三级回退
- Gitee Content API 自动同步 latest.yml
- GitHub Actions 发布流水线：签名 → 验证 → 上传 → 双源同步
- 仓库执行规则自动化：发布前自动清理公共仓库泄露分支

### v0.2.5（2026-08-14）
- 修复双源部署配置错误
- 应用内自动更新机制优化
- 配置修正

### v0.2.4（2026-08-06）
- 修复双源部署问题
- 安全加固

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 私有仓库（或在公共仓提交 Issue 反馈）
2. 创建特性分支（`git checkout -b feature/AmazingFeature`）
3. 通过质量门禁（`npm run typecheck && npm run lint && npm run test`）
4. 提交更改（`git commit -m 'Add some AmazingFeature'`）
5. 推送到分支（`git push origin feature/AmazingFeature`）
6. 开启 Pull Request

---

## 📄 许可证

[MIT License](LICENSE)

---

## 📞 联系方式

- 公共仓主页：<https://github.com/kule-2025/vorzai-public>
- 下载发布：<https://github.com/kule-2025/vorzai-public/releases>
- Issue 反馈：<https://github.com/kule-2025/vorzai-public/issues>
- 双源回退仓：<https://gitee.com/king2030/vorzai>

---

<div align="center">

**Made with ❤️ by Vorzai Team**

</div>



