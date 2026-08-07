# H3-H6 差异化 HR 智能模块 — 阶段三首个里程碑评审报告

> 评审日期：2026-08-04 | 评审人：Voraz 开发团队
> 所属方案：[V2 架构优化与功能增强方案](../delivery/V2架构优化与功能增强方案.md) — 阶段三智能深化（W9-W12）

---

## 1. 交付物清单

| 组件 | 文件 | 行数 | 状态 |
|------|------|------|------|
| **DDL（3 张表）** | `server/src/db/schema.sql` (17.9-17.11 节) | +50 | ✅ |
| **差异化 HR 服务** | `server/src/services/hrSpecializationService.ts` | ~450 | ✅ |
| **HR 路由** | `server/src/routes/hr.ts`（扩展 100+ 行） | +120 | ✅ |
| **单元测试** | `server/tests/hr-specialization.test.ts` | ~250 (21 tests) | ✅ |

---

## 2. 表结构设计

| 表 | 用途 | 关键字段 |
|------|------|----------|
| `hr_job_models` | 五类电商岗位差异化 KPI 权重模板 | job_category, dimension_weights (JSON), kpi_template ([{name, type, target}]), rating_scale |
| `hr_calendars` | 大促/直播/排班/跨时区日程 | calendar_type (6种), start_date/end_date, is_recurring, payload (JSON) |
| `hr_retention_risks` | 离职风险评分（考勤+绩效+加班三因素） | attendance_risk, performance_risk, overtime_risk, total_risk_score, risk_level (4级) |

---

## 3. 引擎能力

### H3: 岗位绩效模型库
- **5 类默认模板**：运营（GMV/转化/客单价/响应）、客服（满意度/响应/解决率/好评）、主播（直播GMV/在线/粉丝/转化）、跨境（GMV/利润/退货/合规）、HR（招聘/满意度/培训/留存）
- **预置种子**：`seedDefaults(tenantId)` 为新租户自动灌入
- **自定义模型**：CRUD + 维度权重 + KPI 模板 + 评分等级

### H4: 行业日历
- **6 种类型**：campaign / livestream / shift / crossborder_timezone / holiday / training
- 创建/列表/更新/删除 + `getUpcomingCalendars(days)` 获取即将到来日程
- 支持循环（is_recurring）和 JSON 负载（时区偏移、班次类型、促销规则）

### H5: 离职风险
- **三维评分**：
  - 考勤异常（迟到×10 + 缺勤×25，权重 40%）
  - 绩效下滑（两期对比，权重 35%）
  - 加班超限（日均工时×15，权重 25%）
- **四级分级**：low (<30) / medium (30-49) / high (50-69) / critical (≥70)
- ON CONFLICT 去重（同人同日）

### H6: HR 战略看板
- 6 项聚合：员工总数 / 平均出勤率 / 平均绩效 / 离职风险分布（4级） / 活跃日历数 / 岗位模型数

---

## 4. 修复记录

| Bug | 修复 |
|-----|------|
| `performance_records` 不存在 | 实际表名 `performance_reviews`，列 `score` 非 `totalScore` |
| `attendance_records` 无 tenant 过滤 | 添加 `tenant_id = ?` |
| `attendance_records.status` 使用 `normal` 非 `present` | 修正 status 白名单 |
| ON CONFLICT 后 SELECT BY id 失败（冲突时 id 被覆盖） | 改为 `SELECT BY employee_id + assessment_date` |
| dashboard 查询 ambiguous column `status` | 使用表别名限定 |

---

## 5. 测试覆盖

```
21 tests 全部通过（351ms）
├── H3 岗位绩效模型库: 9 tests ✅
│   ├── 预置种子（5类）
│   ├── 重复预置不重复
│   ├── 按类别过滤
│   ├── 全部列表
│   ├── 查询单个
│   ├── 创建自定义
│   ├── 更新
│   ├── 删除
│   └── 租户隔离
├── H4 行业日历: 6 tests ✅
│   ├── 创建
│   ├── 列表（按类型）
│   ├── 即将到来
│   ├── 更新
│   ├── 删除
│   └── 租户隔离
├── H5 离职风险: 4 tests ✅
│   ├── 默认低风险
│   ├── 同日同人覆盖
│   ├── 按级别过滤
│   ├── 确认风险
│   └── 租户隔离
└── H6 HR 战略看板: 2 tests ✅
    └── 6 项聚合指标
```

---

## 6. V2 进度总览

| 阶段 | 模块 | 测试数 | 状态 |
|------|------|--------|------|
| **阶段一** | M1 采购 + M2 HR打通 + M3 监控 | 267 | ✅ |
| **阶段二** | W2 RAG + W5 工作流 + I1-I2 激励 + O2-O4 OGSM | +74 | ✅ |
| **阶段三** | **H3-H6 差异化 HR** | **+21** | **✅ 本次** |
| **阶段三** | R1-R5 RACI增强 | — | ⏳ 待开发 |
| **阶段三** | C1-C3 售后闭环 | — | ⏳ 待开发 |
| **阶段三** | S4-S6 库存联动采购 | — | ⏳ 待开发 |

**当前累计：362/362 测试通过（22 files）**

---

## 7. 下一步（V2 阶段三剩余）

| 优先级 | 事项 | 备注 |
|--------|------|------|
| P1 | R1-R5 责任人矩阵增强 | A 唯一性校验 / 覆盖度 / 负载均衡 |
| P1 | C1-C3 售后闭环 | 退货审批 + stock_transactions 入库联动 |
| P1 | S4-S6 库存联动采购 | 断货预警 → 采购建议单 |
| P2 | H5 离职风险模型自动扫描 | 定时任务，非手动触发 |
| P3 | 行业日历预设 | 618/双11/黑五/圣诞等商城促销日历模板 |

---

## 8. 评审结论

✅ **通过** — H3-H6 差异化 HR 智能模块（岗位模型库 + 行业日历 + 离职风险 + 战略看板）已完成交付。3 张表 DDL、450 行服务、120 行路由扩展、21 个测试。全量回归 362/362，tsc/build 全绿。
