# Vorzai 电商 Agent v0.1.1

> 面向电商企业的人力资源管理与业务解决方案桌面应用

## 下载安装

### Windows

点击下方链接下载安装包：

**[Vorzai 电商 Agent Setup 0.1.1.exe](https://github.com/kule-2025/vorzai-public/releases/download/v0.1.1/Vorzai%20电商%20Agent%20Setup%200.1.1.exe)**

- 文件大小：约 85 MB
- 系统要求：Windows 10/11 (x64)
- 安装方式：双击运行，按向导完成安装

### 国内镜像（Gitee）

如果 GitHub 下载慢，请使用 Gitee 镜像：

**[Gitee 下载页面](https://gitee.com/king2030/vorzai/releases)**

## 功能概览

Vorzai 是一款专为电商企业设计的智能桌面助手，覆盖以下核心能力：

**业务管理** — 立项 → 选品 → 组盘 → 订单 → 客服 → 结算，完整电商业务链闭环

**人力资源** — 员工管理、考勤记录、绩效评估、薪酬计算、人效分析

**目标管理** — OGSM 目标分解（目标→指标→策略→度量）、RACI 责任人矩阵、激励机制

**知识管理** — 企业知识库、专属技能中心、对话式工作流

**连接器** — 预留钉钉、飞书、企业邮箱对接接口

**安全机制** — JWT 认证、RBAC 权限控制、多租户数据隔离

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
- **后端**：Express 5 + node:sqlite（Node.js 内置数据库）
- **认证**：JWT 双 Token + RBAC 五级权限
- **数据**：SQLite（嵌入式，数据本地化，离线可用）

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1.0 | 2026-07-29 | 首个正式版本，全栈实现 |
| v0.1.1 | 2026-07-29 | 安全修复：租户隔离增强、订单状态机完善、RACI/薪酬UPSERT修复、Token刷新循环修复、自动化安全检测脚本 |

## 反馈与支持

- 问题反馈：[GitHub Issues](https://github.com/kule-2025/vorzai-public/issues)
- 邮箱：king2030@foxmail.com

## License

Proprietary — © 2026 Vorzai Team. All rights reserved.
