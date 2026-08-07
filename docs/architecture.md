# Vorzai 系统架构与 API 文档

> 版本: 1.0 | 最后更新: 2026-07-09

---

## 目录

1. [系统架构概述](#1-系统架构概述)
2. [目录结构](#2-目录结构)
3. [数据库设计](#3-数据库设计)
4. [API 接口文档](#4-api-接口文档)
5. [认证与权限](#5-认证与权限)
6. [部署指南](#6-部署指南)
7. [技术决策说明](#7-技术决策说明)

---

## 1. 系统架构概述

Vorzai 是一款面向中小企业的 AI 驱动经营管理桌面应用，采用 **Electron 桌面应用 + 嵌入式 Express 后端 + node:sqlite 数据库** 的单体架构。

### 1.1 架构总览

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 33 主进程                     │
│  ┌───────────────────┐    ┌───────────────────────────┐ │
│  │   Renderer 进程    │    │      嵌入式 Express 服务    │ │
│  │                   │    │                           │ │
│  │  React 18         │    │  Express + node:sqlite    │ │
│  │  TypeScript       │◄──►│  JWT 认证                 │ │
│  │  Vite             │HTTP│  业务逻辑层               │ │
│  │  Zustand          │    │  127.0.0.1:19527         │ │
│  └───────────────────┘    └───────────────────────────┘ │
│                                     │                   │
│                                     ▼                   │
│                          ┌───────────────────┐          │
│                          │   SQLite 数据库    │          │
│                          │   (本地文件存储)    │          │
│                          └───────────────────┘          │
└─────────────────────────────────────────────────────────┘
```

### 1.2 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| 前端框架 | React 18 + TypeScript | 组件化 UI，类型安全 |
| 构建工具 | Vite | 快速 HMR，生产构建 |
| 状态管理 | Zustand | 轻量、无 boilerplate |
| 后端框架 | Express | 轻量 HTTP 服务 |
| 数据库 | node:sqlite (Node.js 内置) | 无需原生编译，零依赖 |
| 认证 | JWT (双 Token) | 无状态认证 |
| 桌面框架 | Electron 33 | 跨平台桌面应用 |
| 运行时 | Node.js 22+ | 内置 sqlite 模块支持 |

### 1.3 通信机制

前端与后端通过 **本地 HTTP** 通信，所有请求发往 `http://127.0.0.1:19527`：

- 前端通过 `src/api/client.ts` 封装的 HTTP 客户端发起请求
- 后端 Express 服务在 Electron 主进程启动时同步拉起
- 服务仅绑定 `127.0.0.1`，不暴露外网，保证数据安全
- 支持 CORS 配置，允许 Renderer 进程跨域访问

---

## 2. 目录结构

```
vorzai/
├── electron/                    # Electron 主进程
│   ├── main.js                  # 主进程入口，窗口管理，服务启动
│   ├── preload.js               # 预加载脚本，安全桥接
│   └── updater.js               # 自动更新逻辑
│
├── server/                      # 嵌入式后端
│   └── src/
│       ├── index.ts             # 服务入口，端口监听
│       ├── app.ts               # Express 应用配置，路由挂载
│       ├── config.ts            # 环境变量与配置常量
│       ├── db/                  # 数据库层
│       │   ├── schema.sql       # 建表 DDL (37张表)
│       │   ├── seed.ts          # 初始数据填充
│       │   └── index.ts         # 数据库连接实例 (node:sqlite)
│       ├── middleware/          # Express 中间件
│       │   ├── auth.ts          # JWT 验证 + 角色守卫
│       │   ├── errorHandler.ts  # 全局错误处理
│       │   └── common.ts        # 通用中间件 (日志、请求解析)
│       ├── routes/              # API 路由层
│       │   ├── auth.ts          # 认证相关 (注册/登录/刷新)
│       │   ├── ogsm.ts          # OGSM 目标管理
│       │   ├── hr.ts            # 人力资源
│       │   ├── business.ts      # 电商业务链
│       │   ├── knowledge.ts     # 知识库与技能
│       │   └── chat.ts          # AI 对话
│       ├── services/            # 业务逻辑层
│       │   ├── authService.ts   # 认证逻辑 (密码哈希、Token签发)
│       │   ├── ogsmService.ts   # OGSM 业务逻辑
│       │   ├── hrService.ts     # 人力资源业务逻辑
│       │   ├── businessService.ts # 电商业务逻辑
│       │   └── knowledgeService.ts # 知识库业务逻辑
│       ├── types/               # TypeScript 类型定义
│       └── utils/               # 工具函数
│           ├── logger.ts        # 结构化日志
│           └── errors.ts        # 自定义错误类
│
├── src/                         # 前端源码
│   ├── main.tsx                 # React 入口
│   ├── App.tsx                  # 根组件
│   ├── api/                     # API 通信层
│   │   ├── client.ts            # HTTP 客户端封装 (axios/fetch)
│   │   ├── index.ts             # API 模块导出
│   │   ├── llmAdapter.ts        # LLM 调用适配器
│   │   └── moduleBus.ts         # 模块间事件总线
│   ├── components/              # 通用 UI 组件
│   ├── views/                   # 页面视图
│   ├── modules/                 # 功能模块
│   ├── store/                   # Zustand 状态仓库
│   ├── multi-tenant/            # 多租户上下文
│   ├── styles/                  # 全局样式
│   ├── types/                   # 前端类型定义
│   └── utils/                   # 前端工具函数
│
├── data/                        # 运行时数据 (SQLite 文件)
├── logs/                        # 运行日志
├── scripts/                     # 构建/部署脚本
├── vite.config.ts               # Vite 配置
├── tsconfig.json                # TypeScript 配置
└── package.json                 # 项目依赖与脚本
```

---

## 3. 数据库设计

数据库采用 SQLite，共 **37 张表**，划分为 **8 大模块**。所有表均包含 `created_at` / `updated_at` 时间戳字段，业务表通过 `tenant_id` 实现多租户数据隔离。

### 3.1 模块总览

| 模块 | 表数量 | 核心职责 |
|------|--------|---------|
| 多租户与账号 | 7 | 租户、用户、角色、审计 |
| OGSM 目标管理 | 7 | 目标-目的-策略-度量闭环 |
| 人力资源 | 5 | 员工、考勤、绩效、薪酬 |
| 电商业务链 | 8 | 项目、商品、订单、工单、结算 |
| 知识库与技能 | 4 | 文档管理、AI 技能执行 |
| 连接器 | 2 | 外部平台对接与同步 |
| 对话 | 2 | AI 对话历史 |
| 系统 | 2 | 全局配置、通知 |

### 3.2 多租户与账号模块

```sql
tenants              -- 租户 (企业/团队)
users                -- 用户账号 (邮箱 + 密码哈希)
refresh_tokens       -- 刷新令牌 (支持多设备)
departments          -- 部门 (树形结构)
roles                -- 角色定义
user_roles           -- 用户-角色关联 (多对多)
audit_logs           -- 操作审计日志
```

**关键关系:**
- `users.tenant_id` → `tenants.id` (一个用户归属一个租户)
- `user_roles` 实现用户与角色的多对多映射
- `departments` 通过 `parent_id` 自引用实现树形层级

### 3.3 OGSM 目标管理模块

```sql
ogsm_objectives      -- O: 愿景目标 (顶层方向)
ogsm_goals           -- G: 量化目的 (可衡量指标)
ogsm_strategies      -- S: 策略路径 (达成方式)
ogsm_measures        -- M: 度量指标 (跟踪刻度)
raci_matrix          -- RACI 责任矩阵
incentives           -- 激励方案定义
incentive_records    -- 激励发放记录
```

**层级关系:**
```
Objective (1) ──► Goals (N)
Goal (1) ──► Strategies (N)
Strategy (1) ──► Measures (N)
```

### 3.4 人力资源模块

```sql
employees            -- 员工档案
attendance_records   -- 考勤打卡记录
performance_reviews  -- 绩效考核
payroll_records      -- 薪酬发放记录
efficiency_metrics   -- 人效指标统计
```

**关键关系:**
- `employees.user_id` → `users.id` (员工关联系统账号)
- `employees.department_id` → `departments.id`
- 考勤/绩效/薪酬均通过 `employee_id` 关联员工

### 3.5 电商业务链模块

```sql
projects             -- 电商项目 (店铺/品牌)
products             -- 商品 SPU
product_bundles      -- 组合商品 (套装)
bundle_items         -- 套装明细
orders               -- 订单
service_tickets      -- 客服工单
ticket_messages      -- 工单消息 (对话记录)
settlements          -- 财务结算
```

**业务流:**
```
Project ──► Products ──► Orders ──► Settlements
                │
                └──► Bundles ──► Bundle Items
                
Orders ──► Service Tickets ──► Ticket Messages
```

### 3.6 知识库与技能模块

```sql
knowledge_bases      -- 知识库 (分类容器)
knowledge_documents  -- 知识文档 (支持 Markdown)
skills               -- AI 技能定义 (Prompt 模板)
skill_executions     -- 技能执行记录 (输入/输出/耗时)
```

### 3.7 连接器模块

```sql
connectors           -- 连接器配置 (平台类型、凭证)
connector_sync_logs  -- 同步日志 (状态、耗时、错误)
```

### 3.8 对话模块

```sql
conversations        -- 对话会话
messages             -- 消息 (role: user/assistant/system)
```

### 3.9 系统模块

```sql
system_settings      -- 全局键值配置
notifications        -- 站内通知
```

---

## 4. API 接口文档

### 4.1 基础信息

| 项目 | 值 |
|------|---|
| Base URL | `http://127.0.0.1:19527` |
| 协议 | HTTP (本地通信) |
| 数据格式 | JSON |
| 认证方式 | Bearer Token (JWT) |

### 4.2 统一响应格式

所有接口返回统一 JSON 结构：

```typescript
// 成功响应
{
  "success": true,
  "data": T,                    // 业务数据
  "pagination"?: {              // 分页信息 (列表接口)
    "page": number,
    "pageSize": number,
    "total": number,
    "totalPages": number
  }
}

// 失败响应
{
  "success": false,
  "error": {
    "code": string,             // 错误码 (如 "AUTH_EXPIRED", "NOT_FOUND")
    "message": string           // 人类可读错误信息
  }
}
```

### 4.3 认证接口 (`/api/auth`)

#### POST /api/auth/register

注册新用户并自动创建租户。

**请求体:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "张三",
  "tenantName": "我的公司"
}
```

**响应 (201):**
```json
{
  "success": true,
  "data": {
    "user": { "id": 1, "email": "user@example.com", "name": "张三" },
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG..."
  }
}
```

#### POST /api/auth/login

用户登录，返回双 Token。

**请求体:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**响应 (200):**
```json
{
  "success": true,
  "data": {
    "user": { "id": 1, "email": "user@example.com", "name": "张三", "role": "owner" },
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG..."
  }
}
```

#### POST /api/auth/refresh

使用 Refresh Token 换取新的 Access Token。

**请求体:**
```json
{
  "refreshToken": "eyJhbG..."
}
```

**响应 (200):**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbG...(new)",
    "refreshToken": "eyJhbG...(new)"
  }
}
```

#### GET /api/auth/profile

获取当前登录用户信息。需要 `Authorization: Bearer <accessToken>` 头。

**响应 (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "email": "user@example.com",
    "name": "张三",
    "tenantId": 1,
    "tenantName": "我的公司",
    "roles": ["owner"],
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

### 4.4 OGSM 目标管理接口 (`/api/ogsm`)

#### CRUD /api/ogsm/objectives

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ogsm/objectives` | 获取目标列表 (支持分页、状态筛选) |
| GET | `/api/ogsm/objectives/:id` | 获取单个目标详情 (含关联 G/S/M) |
| POST | `/api/ogsm/objectives` | 创建目标 |
| PUT | `/api/ogsm/objectives/:id` | 更新目标 |
| DELETE | `/api/ogsm/objectives/:id` | 删除目标 (级联删除子级) |

**创建/更新请求体:**
```json
{
  "title": "2026年成为品类TOP3",
  "description": "通过产品创新和渠道拓展实现市场领先",
  "status": "active",
  "startDate": "2026-01-01",
  "endDate": "2026-12-31"
}
```

#### CRUD /api/ogsm/goals

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/ogsm/goals` | 获取目的列表 |
| GET | `/api/ogsm/goals/:id` | 获取单个目的 |
| POST | `/api/ogsm/goals` | 创建目的 |
| PUT | `/api/ogsm/goals/:id` | 更新目的 |
| DELETE | `/api/ogsm/goals/:id` | 删除目的 |

**创建请求体:**
```json
{
  "objectiveId": 1,
  "title": "年营收突破5000万",
  "metricType": "currency",
  "targetValue": 50000000,
  "currentValue": 12000000,
  "unit": "元",
  "deadline": "2026-12-31"
}
```

### 4.5 人力资源接口 (`/api/hr`)

#### CRUD /api/hr/employees

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/hr/employees` | 员工列表 (支持部门筛选、分页) |
| GET | `/api/hr/employees/:id` | 员工详情 |
| POST | `/api/hr/employees` | 新增员工 |
| PUT | `/api/hr/employees/:id` | 更新员工信息 |
| DELETE | `/api/hr/employees/:id` | 删除员工 (软删除) |

**创建请求体:**
```json
{
  "name": "李四",
  "email": "lisi@company.com",
  "phone": "13800138000",
  "departmentId": 2,
  "position": "运营专员",
  "hireDate": "2026-03-01",
  "status": "active"
}
```

#### GET /api/hr/attendance

考勤记录查询。

**查询参数:**
| 参数 | 类型 | 说明 |
|------|------|------|
| employeeId | number | 员工 ID (可选) |
| startDate | string | 起始日期 (YYYY-MM-DD) |
| endDate | string | 结束日期 |
| status | string | 状态: normal/late/absent |
| page | number | 页码 |
| pageSize | number | 每页条数 |

**响应:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "employeeId": 1,
      "employeeName": "李四",
      "date": "2026-07-09",
      "checkIn": "09:02:15",
      "checkOut": "18:30:00",
      "status": "normal"
    }
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 156, "totalPages": 8 }
}
```

### 4.6 电商业务接口 (`/api/business`)

#### CRUD /api/business/projects

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/business/projects` | 项目列表 |
| GET | `/api/business/projects/:id` | 项目详情 |
| POST | `/api/business/projects` | 创建项目 |
| PUT | `/api/business/projects/:id` | 更新项目 |
| DELETE | `/api/business/projects/:id` | 删除项目 |

#### CRUD /api/business/products

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/business/products` | 商品列表 (支持项目筛选、状态筛选) |
| GET | `/api/business/products/:id` | 商品详情 (含套装信息) |
| POST | `/api/business/products` | 创建商品 |
| PUT | `/api/business/products/:id` | 更新商品 |
| DELETE | `/api/business/products/:id` | 删除商品 |

**创建请求体:**
```json
{
  "projectId": 1,
  "name": "夏季清凉套装",
  "sku": "SKU-2026-001",
  "price": 299.00,
  "cost": 120.00,
  "stock": 500,
  "status": "on_sale",
  "categoryId": "clothing"
}
```

#### CRUD /api/business/orders

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/business/orders` | 订单列表 (支持状态、日期范围筛选) |
| GET | `/api/business/orders/:id` | 订单详情 |
| POST | `/api/business/orders` | 创建订单 |
| PUT | `/api/business/orders/:id` | 更新订单状态 |
| DELETE | `/api/business/orders/:id` | 取消订单 |

#### CRUD /api/business/tickets

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/business/tickets` | 工单列表 |
| GET | `/api/business/tickets/:id` | 工单详情 (含消息记录) |
| POST | `/api/business/tickets` | 创建工单 |
| PUT | `/api/business/tickets/:id` | 更新工单 (状态/优先级) |
| DELETE | `/api/business/tickets/:id` | 关闭工单 |

**创建请求体:**
```json
{
  "orderId": 15,
  "subject": "商品质量问题要求退换",
  "priority": "high",
  "category": "after_sale",
  "description": "客户反馈收到的商品有破损..."
}
```

### 4.7 知识库接口 (`/api/knowledge-bases`)

#### CRUD /api/knowledge-bases

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/knowledge-bases` | 知识库列表 |
| GET | `/api/knowledge-bases/:id` | 知识库详情 (含文档列表) |
| POST | `/api/knowledge-bases` | 创建知识库 |
| PUT | `/api/knowledge-bases/:id` | 更新知识库 |
| DELETE | `/api/knowledge-bases/:id` | 删除知识库 |

**子资源 - 文档:**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/knowledge-bases/:id/documents` | 文档列表 |
| POST | `/api/knowledge-bases/:id/documents` | 新增文档 |
| PUT | `/api/knowledge-bases/:id/documents/:docId` | 更新文档 |
| DELETE | `/api/knowledge-bases/:id/documents/:docId` | 删除文档 |

### 4.8 技能接口 (`/api/skills`)

#### CRUD /api/skills

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/skills` | 技能列表 |
| GET | `/api/skills/:id` | 技能详情 |
| POST | `/api/skills` | 创建技能 |
| PUT | `/api/skills/:id` | 更新技能 |
| DELETE | `/api/skills/:id` | 删除技能 |
| POST | `/api/skills/:id/execute` | 执行技能 |

**执行技能请求体:**
```json
{
  "inputs": {
    "productName": "夏季清凉套装",
    "targetAudience": "25-35岁女性"
  },
  "context": "knowledge_base_id:3"
}
```

### 4.9 连接器接口 (`/api/connectors`)

#### CRUD /api/connectors

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/connectors` | 连接器列表 |
| GET | `/api/connectors/:id` | 连接器详情 |
| POST | `/api/connectors` | 创建连接器 |
| PUT | `/api/connectors/:id` | 更新配置 |
| DELETE | `/api/connectors/:id` | 删除连接器 |
| POST | `/api/connectors/:id/sync` | 触发同步 |
| GET | `/api/connectors/:id/logs` | 同步日志 |

### 4.10 AI 对话接口 (`/api/chat`)

#### POST /api/chat/send

发送消息并获取 AI 回复 (支持流式响应)。

**请求体:**
```json
{
  "conversationId": 1,
  "message": "帮我分析上个月的销售数据趋势",
  "context": {
    "knowledgeBaseId": 3,
    "skillId": 5
  }
}
```

**响应 (200):**
```json
{
  "success": true,
  "data": {
    "conversationId": 1,
    "message": {
      "id": 42,
      "role": "assistant",
      "content": "根据上月销售数据分析...",
      "createdAt": "2026-07-09T10:30:00.000Z"
    }
  }
}
```

**辅助接口:**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/chat/conversations` | 对话列表 |
| GET | `/api/chat/conversations/:id/messages` | 历史消息 |
| DELETE | `/api/chat/conversations/:id` | 删除对话 |

---

## 5. 认证与权限

### 5.1 JWT 双 Token 机制

```
┌──────────┐         ┌──────────┐         ┌──────────┐
│  客户端   │──登录──►│  服务端   │──签发──►│ 双Token  │
└──────────┘         └──────────┘         └──────────┘
     │                                          │
     │  Authorization: Bearer <accessToken>     │
     │◄─────────────────────────────────────────┘
     │                                          │
     │  accessToken 过期 (2h)                    │
     │──POST /auth/refresh {refreshToken}──────►│
     │◄──新 accessToken + 新 refreshToken───────│
```

| Token 类型 | 有效期 | 存储位置 | 用途 |
|-----------|--------|---------|------|
| Access Token | 2 小时 | 内存 (Zustand) | API 请求认证 |
| Refresh Token | 30 天 | 数据库 + 客户端持久化 | 换取新 Access Token |

**安全设计:**
- Refresh Token 存储于数据库 `refresh_tokens` 表，支持主动吊销
- 每次 refresh 会轮换 (rotate) Refresh Token，旧 Token 立即失效
- 密码使用 bcrypt 哈希存储，不保存明文

### 5.2 RBAC 角色层级

系统采用基于角色的访问控制 (RBAC)，角色按权限从高到低排列：

```
owner ──► admin ──► manager ──► member ──► viewer
  │         │         │          │          │
  │         │         │          │          └─ 只读
  │         │         │          └─ 基本操作
  │         │         └─ 管理操作
  │         └─ 系统配置
  └─ 完全控制 (含删除租户)
```

| 角色 | 权限范围 |
|------|---------|
| `owner` | 完全控制，包括租户设置、用户管理、数据删除 |
| `admin` | 系统配置、用户管理、所有业务模块读写 |
| `manager` | 业务模块管理、数据导入导出、审批 |
| `member` | 基本业务操作 (创建/编辑自己的数据) |
| `viewer` | 只读访问，查看报表和数据 |

**中间件实现 (`server/src/middleware/auth.ts`):**

```typescript
// 认证: 验证 JWT 有效性
authenticate(req, res, next)

// 授权: 检查最低角色要求
authorize(minRole: 'owner' | 'admin' | 'manager' | 'member' | 'viewer')

// 使用示例
router.delete('/employees/:id', authenticate, authorize('admin'), handler)
```

### 5.3 租户数据隔离

- 所有业务表包含 `tenant_id` 字段
- 中间件自动从 JWT 中提取 `tenantId` 注入请求上下文
- Service 层查询强制附加 `WHERE tenant_id = ?` 条件
- 跨租户访问在数据库层面被完全隔离

---

## 6. 部署指南

### 6.1 开发模式

```bash
# 安装依赖
npm install

# 启动后端 (tsx 热重载)
npm run dev:server

# 启动前端 (Vite HMR)
npm run dev:client

# 或同时启动前后端
npm run dev
```

开发模式下：
- 后端通过 `tsx` 运行，支持 TypeScript 热重载
- 前端通过 Vite dev server 提供，默认端口 5173
- 后端 API 监听 `127.0.0.1:19527`
- 数据库文件位于 `data/vorzai.db`

### 6.2 生产模式 (Electron 打包)

```bash
# 构建前端资源
npm run build

# 打包 Electron 应用
npm run package        # 当前平台
npm run package:win    # Windows
npm run package:mac    # macOS
npm run package:linux  # Linux
```

生产模式下：
- Electron 主进程启动时自动拉起嵌入式 Express 服务
- 前端资源从打包后的 `dist/` 目录加载
- SQLite 数据库存储在用户数据目录 (`app.getPath('userData')`)
- 服务端口固定为 19527，仅绑定 localhost

### 6.3 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `VORZAI_API_PORT` | `19527` | API 服务端口 |
| `VORZAI_JWT_SECRET` | (随机生成) | JWT 签名密钥 |
| `VORZAI_JWT_ACCESS_EXPIRES` | `2h` | Access Token 有效期 |
| `VORZAI_JWT_REFRESH_EXPIRES` | `30d` | Refresh Token 有效期 |
| `VORZAI_LLM_API_KEY` | - | LLM 服务 API Key |
| `VORZAI_LLM_BASE_URL` | - | LLM 服务端点 |
| `VORZAI_LLM_MODEL` | - | 默认模型名称 |
| `VORZAI_DB_PATH` | `./data/vorzai.db` | 数据库文件路径 |
| `VORZAI_LOG_LEVEL` | `info` | 日志级别 (debug/info/warn/error) |

### 6.4 数据库初始化

首次启动时自动执行：
1. 检测数据库文件是否存在
2. 不存在则执行 `server/src/db/schema.sql` 建表
3. 执行 `server/src/db/seed.ts` 填充初始数据 (默认角色、系统配置)
4. 后续启动自动执行增量迁移

---

## 7. 技术决策说明

### 7.1 为什么用 node:sqlite 而非 better-sqlite3

| 对比维度 | node:sqlite | better-sqlite3 |
|---------|-------------|----------------|
| 安装方式 | Node.js 22+ 内置，零依赖 | npm 安装，需要 node-gyp 编译 |
| 原生编译 | 不需要 | 需要 C++ 编译工具链 |
| 跨平台分发 | 无原生 .node 文件，打包简单 | 需为每个平台/架构预编译 |
| Electron 兼容 | 无需 electron-rebuild | 必须 electron-rebuild |
| 性能 | 满足桌面应用场景 | 略优 (同步 API) |
| 维护成本 | 跟随 Node.js 版本 | 依赖第三方维护 |

**决策理由:** 作为桌面应用，分发简洁性优先于极致性能。node:sqlite 避免了原生模块编译带来的 CI/CD 复杂度和用户安装失败风险。

### 7.2 为什么嵌入式而非独立服务器

| 对比维度 | 嵌入式 (当前方案) | 独立服务器 |
|---------|-----------------|-----------|
| 离线可用 | 完全离线工作 | 依赖网络 |
| 数据安全 | 数据留在本地 | 数据上传云端 |
| 部署复杂度 | 安装即用 | 需配置服务器 |
| 运维成本 | 零运维 | 需监控、备份 |
| 目标用户 | 中小企业/个人 | 大型团队 |

**决策理由:** Vorzai 面向中小企业经营者，他们不具备也不愿意承担服务器运维成本。嵌入式架构保证"安装即用、断网可用、数据自有"。

### 7.3 为什么 JWT 而非 Session

| 对比维度 | JWT (当前方案) | Session |
|---------|--------------|---------|
| 状态 | 无状态，服务端不存储 | 有状态，需 Session 存储 |
| 扩展性 | 天然支持多实例 | 需共享 Session |
| 多设备 | 每设备独立 Token | 需额外管理 |
| 未来同步 | 支持多设备数据同步 | 困难 |
| 吊销 | 需黑名单/短有效期 | 删除 Session 即可 |

**决策理由:** 虽然当前是单机应用，但 JWT 的无状态特性为未来"多设备同步"和"团队协作"预留了架构空间。配合 Refresh Token 数据库存储，兼顾了安全性和可扩展性。

### 7.4 架构分层原则

```
Route 层 (路由)      → 参数校验、请求解析、响应格式化
Service 层 (业务)    → 业务逻辑、事务管理、跨表操作
DB 层 (数据)         → SQL 执行、连接管理
```

- **Route 不包含业务逻辑**，仅做请求/响应转换
- **Service 不感知 HTTP**，可被其他 Service 或定时任务复用
- **DB 层通过 node:sqlite 同步 API**，简化异步复杂度

---

## 附录

### A. 错误码一览

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `VALIDATION_ERROR` | 400 | 请求参数校验失败 |
| `AUTH_REQUIRED` | 401 | 未提供或无效的 Access Token |
| `AUTH_EXPIRED` | 401 | Access Token 已过期 |
| `FORBIDDEN` | 403 | 角色权限不足 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 资源冲突 (如邮箱已注册) |
| `RATE_LIMITED` | 429 | 请求频率超限 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

### B. 分页约定

列表接口统一支持以下查询参数：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | number | 1 | 页码 (从 1 开始) |
| `pageSize` | number | 20 | 每页条数 (最大 100) |
| `sortBy` | string | `createdAt` | 排序字段 |
| `sortOrder` | string | `desc` | 排序方向 (asc/desc) |

### C. 相关文档

- [Bug 追踪](./bug-tracker.md)
- [测试矩阵](./test-matrix.md)
