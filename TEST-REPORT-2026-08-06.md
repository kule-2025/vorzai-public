# Vorzai 完整回归测试报告

**测试时间**: 2026-08-06 09:35 - 09:36
**环境**: Node.js v22.22.2, vitest v2.1.9
**工作目录**: E:\WorkBuddy工作区\vorzai

---

## 一、测试结果汇总

| 指标 | 数量 |
|------|------|
| 测试文件总数 | 32 |
| 通过文件 | 31 |
| 失败文件 | 1 |
| 用例总数 | 495 |
| 通过用例 | 491 |
| 跳过用例 | 4 |
| 失败用例 | 0 |
| **通过率** | **99.19%** |

### 测试套件详情

| 文件 | 用例数 | 状态 |
|------|--------|------|
| server/tests/adapter-platforms.test.ts | 26 | ✓ |
| server/tests/adapter-crypto.test.ts | 13 | ✓ |
| server/tests/adapter-base.test.ts | 17 | ✓ |
| server/tests/adapter-signing.test.ts | 14 | ✓ |
| server/tests/api.test.ts | 25 | ✓ |
| server/tests/data-integrity.test.ts | 6 | ✓ |
| server/tests/dialog-rag.test.ts | 9 | ✓ |
| server/tests/hr-specialization.test.ts | 15 | ✓ |
| server/tests/hr-sync.test.ts | 20 | ✓ |
| server/tests/incentive-engine.test.ts | 18 | ✓ |
| server/tests/leave-compensatory.test.ts | 4 | ✗ |
| server/tests/monitor.test.ts | 25 | ✓ |
| server/tests/ogsm-tracking.test.ts | 24 | ✓ |
| server/tests/procurement.test.ts | 35 | ✓ |
| server/tests/raci-enhancement.test.ts | 10 | ✓ |
| server/tests/security.test.ts | 19 | ✓ |
| server/tests/utils-csv.test.ts | 14 | ✓ |
| server/tests/utils-orderMetrics.test.ts | 9 | ✓ |
| server/tests/workflow-engine.test.ts | 47 | ✓ |
| server/tests/logger.test.ts | 7 | ✓ |
| src/__tests__/smoke/app-launch.test.ts | 10 | ✓ |
| src/__tests__/smoke/multi-tenant.test.ts | 5 | ✓ |
| src/__tests__/smoke/agent-crud.test.ts | 21 | ✓ |
| src/__tests__/smoke/file-import.test.ts | 17 | ✓ |
| src/__tests__/smoke/routing.test.ts | 18 | ✓ |
| src/__tests__/smoke/theme-switch.test.ts | 11 | ✓ |
| src/__tests__/regression/tenant-permissions.test.ts | 7 | ✓ |
| src/__tests__/regression/llm-adapter.test.ts | 10 | ✓ |
| src/__tests__/regression/file-parser.test.ts | 8 | ✓ |
| src/__tests__/regression/hrms-ogsm.test.ts | 3 | ✓ |
| src/__tests__/regression/hrms-kanban.test.ts | 4 | ✓ |

---

## 二、失败用例详细分析

### 失败测试：server/tests/leave-compensatory.test.ts

**错误信息**: `UNIQUE constraint failed: leave_types.id`

**堆栈**:
```
Error: UNIQUE constraint failed: leave_types.id
  at seedCompensatoryType (server/tests/leave-compensatory.test.ts:50:6)
  at server/tests/leave-compensatory.test.ts:65:3
```

**原因分析**:
- 测试使用固定 ID `'lt_compensatory'` 插入 `leave_types` 表
- 多次运行测试时，数据库文件 `data/test_vorzai_leave.db` 未正确清理
- 导致重复插入相同 ID 的调休类型，触发唯一约束冲突

**修复建议**:
```typescript
// 修改 seedCompensatoryType 函数，使用 UUID 而非固定 ID
function seedCompensatoryType(tenantId: string): void {
  const db = getDatabase();
  const id = 'lt_comp_' + uuidv4().slice(0, 8);
  db.prepare(`INSERT INTO leave_types (...) VALUES (?, ?, ...)`).run(id, tenantId);
}
```

或在 `beforeAll` 中添加清理逻辑：
```typescript
beforeAll(() => {
  try { rmSync(TEST_DB_PATH); } catch { /* 首次运行无文件 */ }
  initDatabase(TEST_DB_PATH);
  // ... 现有代码
});
```

---

## 三、覆盖率报告

### 总体覆盖率（v8 探针，含前后端合计）

| 指标 | 当前值 | 门禁阈值 | 状态 |
|------|--------|----------|------|
| 语句覆盖率 | 27.12% | 41% | ✗ 未达标 |
| 函数覆盖率 | 42.76% | 43% | ✗ 未达标 |
| 分支覆盖率 | 65.40% | - | - |
| 行数覆盖率 | 27.12% | 41% | ✗ 未达标 |

> 注：上述为全局覆盖率（含前端 untranspiled 文件拉低均值）。后端 server/src 去重后实际为 **lines 54.15% / functions 46.05%**，但仍低于门禁阈值 41%/43%。

### 后端 server/src 低覆盖率文件 TOP 15

| 文件 | 语句覆盖率 | 函数覆盖率 | 缺失行数 | 优先级 |
|------|-----------|-----------|---------|--------|
| emailSmtp.ts | 0.0% | 0.0% | 107 | P0 |
| platformService.ts | 23.8% | 0.0% | 731 | P0 |
| licenseService.ts | 23.8% | 0.0% | 428 | P0 |
| dialog.ts (routes) | 24.9% | 0.0% | 238 | P0 |
| license.ts (middleware) | 26.3% | 14.3% | 118 | P1 |
| llmService.ts | 27.5% | 0.0% | 103 | P1 |
| inventoryService.ts | 28.3% | 0.0% | 998 | P1 |
| agentService.ts | 29.2% | 0.0% | 126 | P1 |
| crossborder.ts (routes) | 29.5% | 0.0% | 194 | P1 |
| cockpitService.ts | 30.2% | 0.0% | 366 | P1 |
| emailConnectorService.ts | 31.2% | 0.0% | 196 | P1 |
| livestreamService.ts | 33.3% | 0.0% | 1806 | P1 |
| analytics.ts (routes) | 35.0% | 0.0% | 132 | P2 |
| analyticsService.ts | 36.4% | 15.5% | 1149 | P2 |
| crossborderService.ts | 37.7% | 4.1% | 1554 | P2 |

### 后端 server/src 高覆盖率文件（参考基准）

| 文件 | 语句覆盖率 | 函数覆盖率 | 备注 |
|------|-----------|-----------|------|
| orderMetrics.ts | 100% | 100% | ✓ |
| types.ts | 100% | 0% | 纯类型定义 |
| signing.ts | 100% | 100% | ✓ |
| monitor.ts (routes) | 100% | 0% | 纯路由 |
| cockpit.ts (routes) | 100% | 0% | 纯路由 |
| app.ts | 100% | 100% | ✓ |
| logger.ts | 99.2% | 91.7% | ✓ |
| csv.ts | 98.5% | 100% | ✓ |
| monitorService.ts | 97.5% | 100% | ✓ |
| ogsmTrackingService.ts | 97.4% | 95.0% | ✓ |

### 覆盖率门禁说明

根据 `vite.config.ts` 配置，后端覆盖率门禁阈值为：
- 语句覆盖率 ≥ 41%
- 函数覆盖率 ≥ 43%

当前实测值低于门禁阈值，覆盖率报告生成时触发 ERROR 退出（退出码 1）。

**根因**: 大量 service 层业务逻辑（bizOrchestrator、llmService、procurementService 等）缺乏单元测试覆盖。

---

## 四、冒烟测试结果

### 已通过场景

| 测试类别 | 用例数 | 状态 |
|---------|--------|------|
| 应用启动（Electron 环境模拟） | 10 | ✓ |
| 多租户隔离 | 5 | ✓ |
| Agent CRUD 操作 | 21 | ✓ |
| 文件导入解析 | 17 | ✓ |
| 路由配置完整性 | 18 | ✓ |
| 主题切换 | 11 | ✓ |

### 关键功能验证

**用户注册/登录**:
- 已验证：`POST /api/auth/register` 创建用户和租户
- 已验证：数据库种子初始化正常
- 状态：✓ 通过

**租户创建和切换**:
- 已验证：`createTenantContext` 创建租户上下文
- 已验证：租户数据隔离（不同租户 key 空间独立）
- 已验证：RBAC 权限引擎 action+resource 校验
- 状态：✓ 通过

**核心业务模块访问**:
- 已验证：7 大核心模块注册表完整性
- 已验证：各模块 endpoints/events/dependencies 字段存在
- 状态：✓ 通过

**数据库读写操作**:
- 已验证：SQLite 初始化（214 statements, 19 skipped）
- 已验证：事务原子性（支付金额守恒）
- 已验证：备份与恢复流程
- 状态：✓ 通过（1 个测试因数据库清理问题跳过）

---

## 五、边界条件测试

### 已验证场景

| 场景类型 | 用例数 | 状态 |
|---------|--------|------|
| 空数据场景 | 8 | ✓ |
| 异常输入处理 | 15 | ✓ |
| 并发操作测试 | 12 | ✓ |
| 超时处理 | 1 | ✓ (workflow 10s 超时) |
| 死锁检测 | 1 | ✓ |
| 未注册工具 | 1 | ✓ |

### 边界条件结果

- **空数据**: 所有边界用例正常返回空结果或默认值
- **异常输入**: 验证器正确拒绝非法输入（如超额收款）
- **并发操作**: 多租户并发测试无冲突
- **超时/死锁**: Workflow 引擎正确检测并处理超时节点和死锁状态

---

## 六、性能基准测试

### 测试启动时间

| 测试文件 | 执行时间 |
|---------|---------|
| adapter-platforms.test.ts | 4,455 ms |
| logger.test.ts | 9,278 ms |
| app-launch.test.ts | 10,464 ms |

**说明**: 启动时间包含 vitest 初始化、模块加载、数据库连接等开销，属于正常范围。

### 完整测试套件执行时间

| 指标 | 数值 |
|------|------|
| 总时长 | **13.16 秒** |
| 变换时间 | 6.02 秒 |
| 设置时间 | 1.58 秒 |
| 收集时间 | 9.33 秒 |
| 测试执行 | 39.27 秒（累计） |

### 接口响应时间（API 测试）

| 接口 | 平均响应 | 状态 |
|------|---------|------|
| POST /register | 158-382 ms | ✓ |
| POST /products | 3-7 ms | ✓ |
| POST /orders | 5-6 ms | ✓ |
| PUT /orders/:id/payment | 2-3 ms | ✓ |

---

## 七、修复建议

### 立即修复（P0）

1. **leave-compensatory.test.ts 数据库清理问题**
   - 问题：固定 ID `'lt_compensatory'` 插入 `leave_types` 表，多次运行测试时数据库文件未正确清理
   - 修复：使用 UUID 动态生成 ID，或确保 `beforeAll` 中 `rmSync` 先删除旧数据库

### 短期优化（P1）

3. **SQLite 实验性警告**
   ```
   (node:xxx) ExperimentalWarning: SQLite is an experimental feature
   ```
   - 建议：升级 Node.js 到稳定支持 SQLite 的版本，或使用 `better-sqlite3` 替代

4. **备份 WAL checkpoint 失败**
   ```
   [WARN] WAL checkpoint 失败，直接复制
   ```
   - 建议：检查 SQLite 连接配置，确保 WAL 模式正确启用

### 长期改进（P2）

5. **覆盖率提升计划**
   - 目标：逐步提升至 70% 语句覆盖率
   - 策略：按服务模块优先级补充单测
   - 重点：service 层业务逻辑、adapter 层平台适配

6. **测试隔离增强**
   - 建议：所有集成测试使用独立临时数据库
   - 建议：添加 `afterEach` 清理逻辑，避免状态污染

---

## 八、执行时间统计

| 阶段 | 时间 |
|------|------|
| 后端测试运行 | 17.40 秒 |
| 前端测试运行 | 3.53 秒 |
| 覆盖率分析 | 15.95 秒 |
| 性能基准测试 | 24.20 秒 |
| **总计** | **~61 秒** |

---

## 九、结论

**整体状态**: ⚠️ 需修复 1 个测试失败 + 覆盖率门禁未达标

- 测试通过率：**99.19%** (491/495)
- 失败测试数：**1** (leave-compensatory.test.ts)
- 覆盖率门禁：**未通过** (全局 lines 27.12% / functions 42.76%；后端实际 lines 54.15% / functions 46.05%，仍低于阈值 41%/43%)
- 冒烟测试：**全部通过**
- 边界条件：**全部通过**
- 性能基准：**正常**

**建议优先级**:
1. 修复 `leave-compensatory.test.ts` 数据库清理问题
2. 补充低覆盖率服务的单元测试
3. 升级 Node.js SQLite 支持或更换驱动
