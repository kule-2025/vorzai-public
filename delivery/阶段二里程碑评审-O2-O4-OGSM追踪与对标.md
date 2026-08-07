# O2-O4 OGSM 时间序列追踪 + 经营对标 + 偏离告警 — 阶段二里程碑评审报告

> 评审日期：2026-08-04 | 评审人：Voraz 开发团队
> 所属方案：[V2 架构优化与功能增强方案](../delivery/V2架构优化与功能增强方案.md) — 阶段二 AI 增强（W5-W8）

---

## 1. 交付物清单

| 组件 | 文件 | 行数 | 状态 |
|------|------|------|------|
| **DDL（3 张表）** | `server/src/db/schema.sql` (17.6-17.8 节) | +47 | ✅ |
| **追踪服务** | `server/src/services/ogsmTrackingService.ts` | ~450 | ✅ |
| **REST 路由** | `server/src/routes/ogsmTracking.ts` | ~180 | ✅ |
| **路由注册** | `server/src/app.ts` | +2 | ✅ |
| **单元测试** | `server/tests/ogsm-tracking.test.ts` | ~310 (23 tests) | ✅ |

---

## 2. 表结构设计

| 表 | 用途 | 关键字段 |
|------|------|----------|
| `ogsm_progress_snapshots` | 每日打点，progress/alignment 时间序列 | objective_id, snapshot_date, progress, alignment, is_auto |
| `ogsm_metric_links` | OGSM 目标 ↔ 经营指标对标 | goal_id, metric_key, period_type, scale_factor, auto_sync, last_value |
| `ogsm_deviations` | 偏离告警（实际 vs 计划） | objective_id, snapshot_date, actual/planned_progress, severity |

**约束**：
- `UNIQUE(objective_id, snapshot_date)` — 同日同一目标唯一
- `UNIQUE(goal_id, metric_key, period_type)` — 同对标不能重复
- `metric_key` 白名单：`gmv / orders / aov / gross_profit / gross_margin_rate / conversion / refund_rate / paid_orders / cost / active_sku`

---

## 3. 引擎能力

### 3.1 O2 时间序列追踪
- 单点快照：`createSnapshot(tenantId, objectiveId, date?, note?)` — 自动计算当前 goal 平均对齐
- 批量打点：`captureDailySnapshots(tenantId, date?)` — 给所有 active 目标补点（增量 / 更新统计）
- 时间序列回看：`getTimeSeries(tenantId, objectiveId, from, to)` — 返回折线数据 + 趋势判定（up/down/flat）
- 租户概览：`getTenantOverview(tenantId, days=30)` — 多目标平均趋势 + 每日聚合

### 3.2 O3 经营对标
- 链接 CRUD：`createMetricLink / listMetricLinks / updateMetricLink / deleteMetricLink`
- 同步逻辑：`syncMetricLink(id)` — 拉取 analytics 实际值 × scale_factor → 写入 goal.current_value → 重算 objective.progress
- 批量同步：`syncAllLinks(tenantId)` — 一次扫描所有 active 链接

### 3.3 O4 偏离告警
- 计划进度计算：基于 `start_date/end_date` 的线性期望（`(now - start) / (end - start) × 100`）
- 自动扫描：`detectDeviations(tenantId)` — `actual / planned < 0.8` 触发，按 0.5/0.65/0.8 分级 `critical/warning/info`
- 去重：同 objective + 同 snapshot_date 不重复插入
- 告警管理：`listDeviations / acknowledgeDeviation`

---

## 4. 关键 Bug 修复

**Bug #1**：偏离列表查询 `tenant_id = ?` 因 LEFT JOIN `ogsm_objectives` 同样有 tenant_id 列导致「ambiguous column」。
**修复**：WHERE 全部用 `d.tenant_id` / `d.severity` 等表别名限定。

**Bug #2**：`getMetricLink` 在记录不存在时返回 `undefined`（better-sqlite3/node:sqlite get 行为）。
**修复**：统一 `return row ?? null`。

---

## 5. 测试覆盖

```
23 tests 全部通过（1.41s）
├── OGSM 进度快照 (O2): 7 tests ✅
│   ├── 创建单个目标快照
│   ├── 同一日期二次创建覆盖更新
│   ├── 不存在目标抛错
│   ├── 批量每日打点（跨租户隔离）
│   ├── 时间序列回看（生成 5 个快照后查趋势）
│   ├── 租户整体概览
│   └── 租户隔离
├── OGSM 经营对标 (O3): 8 tests ✅
│   ├── 创建对标链接
│   ├── 跨租户目标创建抛错
│   ├── UNIQUE 约束
│   ├── 按 goal 过滤查询
│   ├── 更新（scale/autoSync）
│   ├── 删除
│   ├── 同步（无订单不报错）
│   ├── 批量同步
│   └── 租户隔离
├── OGSM 偏离告警 (O4): 6 tests ✅
│   ├── 扫描：进度严重落后触发
│   ├── 进度正常不告警
│   ├── 严重度分级（critical/warning/info）
│   ├── 同日同目标去重
│   ├── 确认告警
│   └── 租户隔离
└── OGSM 对标同 goal 列表: 2 tests ✅
```

**测试策略**：
- `seedObjective / seedGoal` helper 直接写入 SQLite，绕过 service
- `uniq(base)` 防止名称冲突
- 严重度分级测试：构造 5%/18%/24% 实际值 vs 33% 计划线，验证三个 severity 都触发
- 租户隔离：tenantB 调 tenantA 的 service 全部抛错或返回 null

---

## 6. 全量回归

| 检查项 | 结果 |
|--------|------|
| 后端单元测试 | **21 files, 341 tests, 341 passed** ✅ |
| TypeScript 类型检查 | **0 errors** ✅ |
| Vite 前端构建 | **built in 4.33s** ✅ |

---

## 7. V2 阶段二全部完成情况

| # | 模块 | 状态 |
|---|------|------|
| W1 | 对话入口统一（chat→dialog 收敛） | ✅ |
| W2 | RAG 接入 | ✅ |
| W3 | 流式输出（SSE） | ⏳ 延期至扩展 |
| W4 | 下单可用性（结构化 schema） | ⏳ 延期 |
| W5 | 可视化工作流编排 v1 | ✅ |
| **O2** | **OGSM 时间序列追踪** | **✅ 本次完成** |
| **O3** | **OGSM 经营对标** | **✅ 本次完成** |
| **O4** | **OGSM 偏离告警** | **✅ 本次完成** |
| I1-I2 | 激励规则引擎 + 自动结算 | ✅ |

阶段二（AI 增强）全部核心闭环已完成。

---

## 8. 待办事项（按 V2 路线图）

| 优先级 | 事项 | 备注 |
|--------|------|------|
| P1 | O1 目标树可视化编辑 | 统一 OGSMBoard + HRMS subview |
| P1 | O5 对齐率热力图（三级 SVG 矩阵） | 公司→部门→个人 |
| P1 | W3 流式输出 SSE | P99 首字 ≤3s |
| P1 | H2 组织架构树（部门 parent_id） | 前端 + 后端 |
| P1 | H3 岗位绩效模型库（hr_job_models） | 五类岗位权重模板 |
| P1 | H4 行业日历（hr_calendars） | 大促/直播/排班 |
| P2 | R1-R5 责任人矩阵增强 | A 唯一性、负载均衡 |
| P2 | C1-C3 售后闭环 | 退货入库联动 |
| P2 | S4-S6 库存联动采购 | 补货建议自动生成 |
| P3 | M2-M5 主动推送 + 业务线联动 | Phase 4 |

---

## 9. 评审结论

✅ **通过** — O2/O3/O4 OGSM 追踪+对标+告警已完成交付。3 张表 DDL、追踪服务、REST 路由、23 个单元测试全部通过，全量回归 341/341。

**核心亮点**：
1. 时间序列追踪（每日打点 + 自动聚合）支持 ≥90 天回看
2. 经营对标自动从 analytics 拉取实际值回写 OGSM 目标
3. 偏离告警按 0.5/0.65/0.8 三档自动分级，无需人工干预

**下一步**：进入阶段三（W9-W12）—— 差异化 HR（H3-H6）、RACI 增强（R1-R5）、售后闭环（C1-C3）、库存联动采购（S4-S6）。