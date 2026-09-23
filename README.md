## v0.2.89 (2026-09-23)

### P1 功能整合
- 人效倍增分析看板上线（瓶颈归因/ROI排名/标杆对比）
- 菜单注册：人效倍增分析独立菜单项
- 数据联动三线确认

## v0.2.88 (2026-09-23)

### P1 交互增强
- ShiftManager表单验证增强（时间逻辑/非负校验）
- PromotionForecast表单验证增强（日期逻辑/目标值非负）
- 数据联动确认：客服绩效→薪酬、大促预测→排班
- 修复package.json BOM导致的构建失败

## v0.2.87 (2026-09-23)

### P0 五大深度功能

- **电商智能排班**：周视图拖拽排班、冲突检测（时间重叠/连续超12h/休息不足11h）、排班模板
- **计件薪酬深化**：业务数据自动采集、质量扣减引擎、一键算薪6步流水线
- **人效倍增分析**：岗位级人效模型、瓶颈归因（流量/人员/排班三效应分解）、ROI计算
- **大促人力预测**：四岗位需求模型、时段分布、爬坡曲线、缺口分析、成本预估
- **客服绩效管理**：加权综合评分（30/40/20/10）、5类异常预警、薪酬联动

### 工程
- 新增11张数据表、48+ API端点、21个文件
- 前后端 tsc 0 错误

# Vorzai

<div align="center">

**Vorzai** 是一款面向电商企业的桌面端「HR 洞察 × 业务业绩倍增」智能体。以 HR 洞察为核心引擎，深度嵌入电商各业务场景，实时发现组织痛点、自动生成解决方案、精准归因激励回报，实现「人效即业绩」的倍增效应。

[![Version](https://img.shields.io/badge/version-0.2.86-blue.svg)](https://github.com/kule-2025/vorzai-public/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey.svg)](#)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-yellow.svg)](#)
[![Dual-Source](https://img.shields.io/badge/dual--source-GitHub%20%7C%20Gitee-purple.svg)](#)

</div>

---

## 功能特性

- **HR 管理体系**：员工档案、考勤、薪酬、绩效、招聘、培训、合同、OKR、KPI 全模块闭环
- **全链路电商业务**：订单、库存、采购、跨境报关、直播带货、售后、营销 ROI
- **业绩倍增引擎**：基准诊断 → 缺口三杠杆拆解 → 分岗位增编建议 → 激励预算 → ROI 预测
- **AI 与数据智能**：LLM 多供应商适配、智能问答、自动化报告、工作流引擎
- **企业级安全**：多租户隔离、RBAC + ABAC、JWT 会话吊销、参数化查询、minisign 签名更新校验

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面壳 | Electron（`electron/main.js` 主进程） |
| 前端 | React 18 + TypeScript + Vite + Zustand + React Router |
| 后端 | Express + better-sqlite3（本地 SQLite）+ Zod 校验 |
| 状态/鉴权 | JWT（access/refresh）+ bcrypt + token_version 会话吊销 |
| 打包 | electron-builder（Windows NSIS） |
| 日志 | winston 风格自定义 logger，按天落盘 |

## 快速开始

```bash
# 安装依赖
npm install

# 环境配置
cp .env.example .env

# 类型检查（当前唯一内置脚本）
npm run typecheck
```

开发与构建（当前 package.json 仅含 prepare/typecheck，以下为真实底层命令）：

```bash
# 前端开发服务器
npx vite

# 后端 API（端口 19527）
npx tsx server/src/app.ts

# 前端产物 -> dist/
npx vite build

# 后端编译 -> server/dist/
npx tsc -p server/tsconfig.json

# Electron 打包 -> release/（NSIS 安装包）
npx electron-builder --config electron-builder.yml
```

> API 端口固定 `19527`，详见 `electron/main.js` 与 `.env.example`。

## 文档链接

完整文档中心见 [docs/README.md](docs/README.md)，核心入口：

- [API 文档](docs/api/README.md)
- [数据库文档](docs/database/schema.md)
- [组件文档](docs/components/README.md)
- [部署文档](docs/deployment/README.md)
- [运维文档](docs/operations/README.md)
- [双源部署 SOP](docs/dual-source-deployment-sop-v3.md)
- [发布方法论](docs/release-methodology.md)

## 双源分发

安装包发布于 GitHub Releases（主源），Gitee 作为两级回退源，客户端按 GitHub Release → Gitee raw → Gitee Release API 依次尝试，下载后做 SHA-512/256 + minisign 完整性校验。

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.2.86 | 2026-09-22 | 遗留项与全量代码验证修复：agent/tenant RBAC 补门禁、dataExport 错误契约统一、appStore 全局拉取、DataManagementPage 筛选回调、记住密码安全降级、死代码清理、搜索防抖共 8 项遗留项；全量代码验证修复 10 个 P0 + 15 个 P1（调休/ZRACI/订单/三支柱/增长引擎/财务逻辑反转/LLM 列表/直播服务类型错误等），类型检查前后端 0 错误后重新打包发布 |
| v0.2.85 | 2026-09-20 | 稳定构建迭代：基于 v0.2.84 的全量整改（冷启动预热、N+1 消除、索引补全、人效驾驶舱、架构预留）重新打包发布，双源分发链路一致性加固 |
| v0.2.84 | 2026-09-20 | 全量对标整改与性能优化：冷启动非阻塞预热；高频列表 N+1 查询逐个消除（KPI 指标批量校验、直播商品上下架批量预查）；数据库索引补全（订单/员工按租户复合索引）；新增人效驾驶舱只读聚合 API 与前端视图（人均 GMV/单量）；预留企业多人本地数据一致性与统一后台千万级并发架构配置（默认关闭）；双源分发链路加固与安装包完整性校验对齐 |
| v0.2.83 | 2026-09-18 | 品牌标识全量替换为 v11 monogram，图标路径与打包修复，安装包瘦身 |
| v0.2.82 | 2026-09-17 | 数据完整性保护：外键约束、事务原子性、写入前校验、崩溃恢复、一致性巡检 |

## 贡献指南

1. 分支开发：`git checkout -b feature/xxx`
2. 通过质量门槛：`npm run typecheck`（测试/lint 脚本随 CI/CD 补齐）
3. 提交并发起 Pull Request

## 许可证

[MIT License](LICENSE)
