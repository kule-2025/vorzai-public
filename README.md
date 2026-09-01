# Vorzai v0.2.59

> 面向电商企业的人力资源管理与业务解决方案桌面应用

## 下载安装

### Windows

点击下方链接下载安装包：

**[Vorzai Setup 0.2.59.exe](https://github.com/kule-2025/vorzai-public/releases/download/v0.2.59/vorzai-ecommerce.Setup.0.2.59.exe)**

- 文件大小：约 101 MB
- 系统要求：Windows 10/11 (x64)
- 安装方式：双击运行，按向导完成安装

### 国内镜像（Gitee）

如果 GitHub 下载慢，请使用 Gitee 镜像：
**[Gitee 下载页面](https://gitee.com/king2030/vorzai/releases)**

### 下载失败解决方案

如果下载到 80MB 左右中断，请尝试以下方法：

**方法 1：使用下载工具（推荐）**
- 使用 [IDM](https://www.internetdownloadmanager.com/)、[Free Download Manager](https://www.freedownloadmanager.org/) 或 [aria2](https://aria2.github.io/) 等下载工具
- 这些工具支持断点续传，即使中断也能从断点继续

**方法 2：浏览器重试**
- Chrome/Edge：按 `Ctrl+J` 打开下载页，点击失败的任务选择"继续下载"
- 或使用无痕模式重新下载

**方法 3：命令行下载**
```bash
# 使用 curl（支持断点续传）
curl -L -C - -o vorzai-ecommerce.Setup.0.2.59.exe "https://github.com/kule-2025/vorzai-public/releases/download/v0.2.59/vorzai-ecommerce.Setup.0.2.59.exe"

# 或使用 wget
wget -c "https://github.com/kule-2025/vorzai-public/releases/download/v0.2.59/vorzai-ecommerce.Setup.0.2.59.exe"
```

**方法 4：GitHub 加速镜像**
- 使用 [ghproxy.com](https://ghproxy.com/) 或 [gitclone.com](https://gitclone.com/) 等加速服务
- 将下载链接中的 `github.com` 替换为加速域名

## 功能概览

Vorzai 是一款专为电商企业设计的智能桌面助手，覆盖以下核心能力：

**业务管理** — 立项 → 选品 → 组盘 → 订单 → 客服 → 结算，完整电商业务链闭环

**人力资源** — 员工管理、考勤记录、绩效评估、薪酬计算、人效分析

**目标管理** — OGSM 目标分解（目标→指标→策略→度量）、RACI 责任人矩阵、激励机制

**知识管理** — 企业知识库、专属技能中心、对话式工作流

**连接器** — 预留钉钉、飞书、企业邮箱对接接口

**安全机制** — JWT 认证、RBAC 权限控制、多租户数据隔离

**直播电商** — 直播会话管理、主播管理、商品库、回放分析（6 Tab / 21 API / 4 表）

**跨境电商** — 跨境业务全流程管理（10 Tab / 15 API / 2 表）

**平台对接** — 多平台数据接入与同步（7 Tab / 21 API / 3 表）

**对话工作流** — 可视化工作流编排与执行（5 Tab / 22 API / 4 表）

## 默认账号

首次启动时系统会自动初始化演示数据，可用以下账号登录：

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | 超级管理员 |
| manager | admin123 | 部门经理 |
| member | admin123 | 普通成员 |

> ⚠️ 请在生产环境中及时修改默认密码

## 技术栈

- **桌面框架**：Electron 33
- **前端**：React 18 + TypeScript + Vite + Zustand
- **后端**：Express + better-sqlite3（嵌入式数据库）
- **认证**：JWT Token + RBAC 五级权限
- **数据**：SQLite（嵌入式，数据本地化，离线可用）
- **规模**：196 张数据表，1,017 个 API 端点，30 个导航项，89 个子功能

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.2.59 | 2026-09-01 | 功能完善：30个导航项100%完成，89个子功能全部实现；新增直播电商(6Tab/21API/4表)、跨境电商(10Tab/15API/2表)、平台对接(7Tab/21API/3表)、对话工作流(5Tab/22API/4表)；性能优化：构建时间-30.5%，产物体积-47.6%；数据库196张表，1,017个API端点；前后端tsc零错误 |
| v0.2.57 | 2026-08-30 | 性能优化专项：超大型组件拆分（ProcurementHub等10文件重构，+360/-903行）、N+1查询优化、内联函数优化减少重渲染、useCallback导入补全、authMiddleware别名兼容、语法错误修复 |
| v0.2.55 | 2026-08-29 | 全量模拟数据替换升级，7个核心业务模块完成后端API对接、OGSM归因功能完善（getAttribution/runAutoAttribution）、TypeScript类型系统全面对齐、双源部署方法论最高执行规则落地 |
| v0.2.54 | 2026-08-29 | 全量模拟数据替换升级，17个核心业务模块完成后端API对接（增长引擎、转化与运营、工作流编排、数据分析、薪酬计算、任务看板、调休管理、倍增实验室、HR效率、HR激励、HR试点、全员OA、RACI矩阵、HR报告中心、风险预警、三支柱、OGSM目标树）、OGSM归因功能完善、TypeScript类型系统全面对齐 |
| v0.2.50 | 2026-08-28 | 重大更新：HR管理左侧垂直导航栏重构（6大分组35子功能）、对话框样式完全对齐workbuddy、应用内自动更新超时修复（双源快速超时+检查中状态）、企业用户权限分配对齐钉钉（5级角色22功能模块+4级数据权限）、全面渲染异常修复（toLocaleString+map遍历共102文件） |
| v0.2.4 | 2026-08-06 | 跨职能调试修复：直播库存扣减逻辑bug、事务完整性、审计日志、数据过滤优化 |
| v0.2.3 | 2026-08-05 | 评审报告 B1-B8 缺陷修复闭环：server strict 加固、跨租户泄漏修复、前端a11y、覆盖率门禁 |
| v0.2.0 | 2026-07-30 | 商业化升级：许可证系统、订阅管理、试用期、配额追踪、设备绑定、审计日志、暴力破解防护 |
| v0.1.2 | 2026-07-30 | 修复空白页面：Vite base路径、CSP字体域、后端服务容错 |
| v0.1.1 | 2026-07-29 | 安全修复：租户隔离增强、订单状态机完善、RACI/薪酬UPSERT修复、Token刷新循环修复 |
| v0.1.0 | 2026-07-29 | 首个正式版本，全栈实现 |

## 反馈与支持

- 问题反馈：[GitHub Issues](https://github.com/kule-2025/vorzai-public/issues)
- 邮箱：king2030@foxmail.com

## License

Proprietary — © 2026 Vorzai Team. All rights reserved.
