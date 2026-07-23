# Vorzai — 电商桌面 AI 助手

Vorzai 是一款面向电商从业者的桌面级 AI Agent，集成多渠道电商数据、智能运营决策、营销自动化与业务洞察于一体，帮助商家在日常运营中高效决策。

## 核心功能

- 多平台电商数据聚合与实时监控
- AI 驱动的商品选品与定价建议
- 智能营销活动规划与执行
- 订单处理与库存管理自动化
- 销售数据可视化与经营分析

## 技术栈

- **桌面框架**：Electron + React + TypeScript
- **AI 引擎**：多模型适配（LLM Adapter 架构）
- **数据存储**：本地 SQLite（离线可用）
- **更新机制**：无感自动更新（GitHub/Gitee 双源）

## 快速开始

```bash
# 克隆项目
git clone <private-repo-url>

# 安装依赖
npm install

# 启动开发环境
npm run dev

# 构建发布版本
npm run build
```

## 项目结构

```
vorzai/
├── src/               # 前端源码
│   ├── api/           # 数据接口层
│   ├── components/    # UI 组件
│   ├── store/         # 状态管理
│   └── views/         # 页面视图
├── electron/          # Electron 主进程
├── docs/              # 文档
└── scripts/           # 构建脚本
```

## 相关仓库

- **源码仓库**（私有）：`github.com/[owner]/vorzai`
- **公共演示**（公开）：`github.com/[owner]/vorzai-public`
- **Gitee 镜像**：`gitee.com/[owner]/vorzai`

## 许可证

[待补充]
