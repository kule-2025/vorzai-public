# Vorzai — 电商企业全员一体化智能办公与经营平台

> 一套系统覆盖全员办公、业务经营与人效管理，让考勤审批高效协同、让利润人效一目了然、让每个岗位的贡献可衡量。

## 解决的核心痛点

- **系统割裂**：OA 考勤、HR 人事、电商业务、财务数据分散在多个工具，信息不通、重复录入
- **人效看不清**：员工贡献无法归因到具体订单与利润，人力投入与业绩产出脱钩
- **经营管不全**：订单、库存、采购、财务分散在多平台，全局经营状态无法一眼掌握
- **操作效率低**：排班、算薪、绩效、复盘依赖手工表格，审批流程线下跑，耗时且易出错
- **决策靠经验**：选品、定价、人力配置缺乏数据支撑，试错成本高

## 核心能力

- **全员办公协同（OA）**：考勤打卡、审批流程、日程任务、公告通知，覆盖从老板到一线员工的日常办公
- **人力全链路**：员工档案、排班调休、薪酬绩效、招聘培训一体化管理
- **业务全闭环**：选品组盘、订单履约、库存采购、售后财务全流程打通
- **人效倍增**：人效驾驶舱实时洞察，瓶颈归因到岗，激励方案 ROI 可预测
- **AI 智能助手**：蜂群多专家协作、记忆进化洞察、智能问答、自动化工作流

## 技术栈

| 层级 | 技术选型 |
|------|----------|
| 桌面框架 | Electron 33 |
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 5 |
| 状态管理 | Zustand |
| 路由 | React Router v6 |
| 后端框架 | Express 4 + TypeScript |
| 数据库 | SQLite（sql.js WASM / better-sqlite3 可选） |
| 打包工具 | electron-builder 25（NSIS 一键安装） |
| 自动更新 | electron-updater 6（GitHub Release 主源 + Gitee 回退） |

## 快速开始

### 环境要求

- Node.js >= 20.0.0
- npm >= 9

### 安装依赖

```bash
npm install
```

### 环境配置

复制 `.env.example` 为 `.env` 并按需填写：

```bash
cp .env.example .env
```

关键配置项：
- `VORZAI_API_PORT`：后端服务端口（默认 19527，Electron 桌面端固定使用）
- `VORZAI_JWT_SECRET`：JWT 签名密钥（留空则首次启动自动生成并持久化到 .jwt_secret；多实例共享时显式配置）
- `VORZAI_CRED_KEY`：平台密钥加密主密钥（AES-256-GCM，>= 32 字节）

### 开发模式

```bash
# 终端 1：启动前端 Vite 开发服务器（端口 3000，自动代理 /api 到 19527）
npm run dev

# 终端 2：启动后端 API 服务器（端口 19527）
npm run start:server

# 终端 3：启动 Electron 桌面端（连接 localhost:3000）
npm run dev:electron
```

### 类型检查

```bash
# 前端类型检查
npm run typecheck

# 后端类型检查
npm run typecheck:server
```

### 构建

```bash
# 构建前端产物 -> dist/
npm run build

# 编译后端 TypeScript -> server/dist/
npm run build:server

# 完整打包 Windows 安装包 -> release/
npm run dist:win
```

### 测试

```bash
npm run test
```

## 项目结构

```
vorzai/
├── electron/                 # Electron 主进程
│   ├── main.js              # 主进程入口（窗口管理、IPC、后端启动）
│   ├── preload.js           # 预加载脚本（contextBridge 安全暴露 API）
│   ├── auto-updater.js      # electron-updater 标准自动更新模块
│   └── updater.js           # 自定义更新工具库（完整性校验/回滚，备用）
├── src/                     # 前端 React 源码
│   ├── components/          # 通用组件
│   ├── modules/             # 业务模块
│   ├── views/               # 页面视图
│   ├── api/                 # API 请求封装
│   ├── store/               # Zustand 状态管理
│   ├── hooks/               # 自定义 Hooks
│   ├── types/               # TypeScript 类型定义
│   └── utils/               # 工具函数
├── server/                  # 后端 Express 服务
│   ├── src/
│   │   ├── index.ts         # 服务入口
│   │   ├── routes/          # API 路由
│   │   ├── services/        # 业务逻辑
│   │   ├── db/              # 数据库层
│   │   └── utils/           # 工具函数
│   └── tsconfig.json        # 后端 TS 配置
├── public/                  # 静态资源
├── docs/                    # 项目文档
├── dist/                    # 前端构建产物（自动生成）
├── server/dist/             # 后端编译产物（自动生成）
├── release/                 # 安装包输出（自动生成）
├── package.json
├── vite.config.ts           # Vite 构建配置
├── tsconfig.json            # 前端 TS 配置
└── electron-builder.yml      # Electron 打包配置
```

## 主要功能模块

| 模块 | 说明 |
|------|------|
| 工作台 | 经营数据概览、核心指标看板 |
| 智能助手 | AI 蜂群协作、记忆进化、对话工作流 |
| 业务链 | 选品组盘、订单管理、库存采购、售后财务 |
| 人力管理 | 员工档案、排班调休、薪酬绩效、招聘培训 |
| 通知中心 | 全业务事件统一通知（SSE 实时推送） |

## 文档中心

- [API 文档](docs/api/README.md)
- [数据库文档](docs/database/schema.md)
- [组件文档](docs/components/README.md)
- [部署文档](docs/deployment/README.md)
- [运维文档](docs/operations/README.md)
- [双源部署 SOP](docs/dual-source-deployment-sop-v3.md)
- [发布方法论](docs/release-methodology.md)

## 自动更新

安装包发布于 GitHub Releases（主源），Gitee 作为两级回退源。客户端按 GitHub Release → Gitee raw → Gitee Release API 依次尝试，下载后经 SHA-512/256 + minisign 完整性校验，NSIS 一键静默安装。

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.2.100 | 2026-10-02 | 四维度审查全量修复（高5中6低5）：moduleBus 33个幻影端点修正；recordPayment财务记账补全；TemplateMarket接通7个真实API；talent移除21个重复端点；三处假导出修复为真实CSV/Excel；EmployeeProfileManager部门关联修复；LiveCommerce SessionDetail+商品挂载；工作流三轨收敛统一；incentive双前缀迁移计划；schema版本管理规范；第三方物流API对接指南；前后端编译全部通过 |
| v0.2.99 | 2026-09-30 | API 双重前缀修复与后端端点补全；蜂群协作真实执行；组盘→订单、OGSM→选品数据血缘打通；通知中心三域15事件统一封装；侧边栏橙色统一 |
| v0.2.98 | 2026-09-28 | 库存预警模块完整闭环（单个/批量/智能推荐安全库存+自动通知）；营销活动效果数据回流与ROI分析；BISU污染全面审计 |
| v0.2.97 | 2026-09-28 | 新增库存盘点管理与客户画像管理页面；消除重复平台连接器API；通知中心3新事件；客户画像→精准营销触达闭环 |
| v0.2.96 | 2026-09-28 | 通知中心30业务事件9大模块深度扩展；大组件32处useMemo性能优化；14个核心面板交互细节完善 |
| v0.2.95 | 2026-09-28 | 通知中心14业务事件扩展（商品/营销创建通知）；BusinessAnalytics性能优化；核心面板交互过渡效果完善 |
| v0.2.94 | 2026-09-27 | 数据库46表多租户索引优化；前端图表渲染useMemo/React.memo优化；AdminConsole版本同步；7个Tab刷新按钮统一；工作流TODO修复 |
| v0.2.93 | 2026-09-27 | RSI记忆权重机制；LLM蜂群5角色动态调度；支付宝RSA2+微信V3支付对接；邮件587 STARTTLS；培训模块完善；7平台对接确认；Admin权限实现 |
| v0.2.92 | 2026-09-26 | 自动更新ENOTDIR根因修复：自动清理悬空Junction/损坏更新缓存目录 |
| v0.2.91 | 2026-09-26 | 准无感更新机制落地：NSIS oneClick静默安装；双源部署方法论与一键发布脚本 |
| v0.2.90 | 2026-09-23 | CSPerformance部门筛选；全页面空状态优化；加载状态和错误处理完善 |
| v0.2.89 | 2026-09-23 | 人效倍增分析看板上线（瓶颈归因/ROI排名/标杆对比）；独立菜单注册；数据联动三线确认 |
| v0.2.88 | 2026-09-23 | ShiftManager/PromotionForecast表单验证增强；客服绩效→薪酬、大促预测→排班数据联动；修复package.json BOM构建失败 |
| v0.2.87 | 2026-09-23 | 电商智能排班、计件薪酬深化、人效倍增分析、大促人力预测、客服绩效管理五大深度功能；新增11张数据表、18+ API端点 |
| v0.2.86 | 2026-09-22 | 遗留项与全量代码验证修复：agent/tenant RBAC补门禁、dataExport错误契约统一、appStore全局拉取、DataManagementPage筛选回调、记住密码安全降级、死代码清理、搜索防抖共8项遗留项 |
| v0.2.85 | 2026-09-20 | 稳定构建迭代：基于v0.2.84的全量整改重新打包发布，双源分发链路一致性加固 |
| v0.2.84 | 2026-09-20 | 全量对标整改与性能优化：冷启动非阻塞预热；高频列表N+1查询逐个消除；数据库索引补全；新增人效驾驶舱；架构预留 |
| v0.2.83 | 2026-09-18 | 品牌标识全量替换为v11 monogram，图标路径与打包修复，安装包瘦身 |
| v0.2.82 | 2026-09-17 | 数据完整性保护：外键约束、事务原子性、写入前校验、崩溃恢复、一致性巡检 |

## 贡献指南

1. Fork 本仓库
2. 通过质量门槛：`npm run typecheck && npm run typecheck:server`
3. 提交并发起 Pull Request

## 许可证

[MIT License](LICENSE)
