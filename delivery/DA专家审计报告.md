# 数据分析专家审计报告（DA）

**审计人**: data-expert
**审计日期**: 2026-07-31
**审计范围**: Analytics 域、cockpit/business/inventory/hr/livestream 服务数据口径一致性、多租户隔离、schema 索引与新表完整性、比率指标分母为 0 处理、零写入方表。
**关联业务目标**: G4（数据可信度）、G6（系统健壮性）

---

## 审计范围

| 模块 | 文件 |
|------|------|
| Analytics 服务 | `server/src/services/analyticsService.ts`（1792 行） |
| Analytics 路由 | `server/src/routes/analytics.ts`（203 行） |
| Cockpit 服务 | `server/src/services/cockpitService.ts`（474 行） |
| Cockpit 路由 | `server/src/routes/cockpit.ts`（28 行） |
| Business 服务 | `server/src/services/businessService.ts`（1313 行） |
| Business 路由 | `server/src/routes/business.ts`（545 行） |
| 订单口径工具 | `server/src/utils/orderMetrics.ts`（62 行） |
| 数据库 schema | `server/src/db/schema.sql`（1356 行） |
| 辅助扫描 | hrService、inventoryService、livestreamService、dialogEngine |

---

## 缺陷清单

### DA-01: `businessService` 大批量 `SELECT * FROM <table> WHERE id=?` 无 tenant_id 过滤（多租户读隔离 P0）

**严重级别**: P0（阻塞）
**位置**: `server/src/services/businessService.ts:103-108, 191, 234, 264-265, 284, 396, 464, 542, 644, 743, 755, 786, 813, 869, 877, 887, 1037, 1079, 1112, 1148, 1180, 1257, 1279, 1287`
**问题**: 以下方法/语句仅按 `id` 查询，**完全不带 `tenant_id`**：

| 方法 | 行 | 语句 | 暴露表 |
|------|----|------|--------|
| getProject | 103-108 | `SELECT ... FROM projects ... WHERE p.id = ?` | projects |
| getProject | 114-117 | `COUNT(*) FROM products WHERE project_id=?` / `SUM(total_amount) FROM orders WHERE project_id=?` | products, orders |
| createProduct 返回 | 191 | `SELECT * FROM products WHERE id=?` | products |
| updateProductStatus 返回 | 234 | `SELECT * FROM products WHERE id=?` | products |
| updateProduct 读旧价格 | 264-265 | `SELECT selling_price/cost_price FROM products WHERE id=?` | products |
| getProduct | 284 | `SELECT * FROM products WHERE id=?` | products |
| createOrder 返回 | 396 | `SELECT * FROM orders WHERE id=?` | orders |
| updateOrderStatus 返回 | 464 | `SELECT * FROM orders WHERE id=?` | orders |
| recordPayment 返回 | 542 | `SELECT * FROM orders WHERE id=?` | orders |
| getAssortmentById 取明细 | 639-644 | `SELECT ... FROM bundle_items ... WHERE bundle_id=?` | bundle_items |
| previewAssortment（见 DA-07） | 743 | `SELECT ... FROM products WHERE id=?` | products |
| createTicket 返回 | 786 | `SELECT * FROM service_tickets WHERE id=?` | service_tickets |
| addTicketMessage 读工单 | 813 | `SELECT id,status FROM service_tickets WHERE id=?` | service_tickets |
| updateServiceTicketStatus 返回 | 869 | `SELECT * FROM service_tickets WHERE id=?` | service_tickets |
| assignTicketToAgent 返回 | 877 | `SELECT * FROM service_tickets WHERE id=?` | service_tickets |
| escalateTicket 返回 | 887 | `SELECT * FROM service_tickets WHERE id=?` | service_tickets |
| createSettlement 返回 | 1037 | `SELECT * FROM settlements WHERE id=?` | settlements |
| createCampaign 读回 | 1079 | `SELECT * FROM campaigns WHERE id=?` | campaigns |
| updateCampaign 返回 | 1112 | `SELECT * FROM campaigns WHERE id=?` | campaigns |
| addProductToCampaign 返回 | 1148 | `SELECT * FROM campaign_products WHERE id=?` | campaign_products |
| createAdSpend 返回 | 1180 | `SELECT * FROM ad_spend WHERE id=?` | ad_spend |
| createReview 返回 | 1257 | `SELECT * FROM product_reviews WHERE id=?` | product_reviews |
| approveReview 返回 | 1279 | `SELECT * FROM product_reviews WHERE id=?` | product_reviews |
| replyToReview 返回 | 1287 | `SELECT * FROM product_reviews WHERE id=?` | product_reviews |
| getProductReviewStats | 1294-1300 | `COUNT/AVG FROM product_reviews WHERE product_id=?` | product_reviews |

**影响**: 理论上持有合法 token 的任意租户成员，猜/遍历到其它租户的 UUID 即可**读取任意租户的项目、商品、订单、工单、投流、评价数据**。虽 then tenantIsolation 中间件在路由层注入 `tenantId`，但这些"返回当前记录"的查询**没有任何 tenant_id 兜底**——一旦调用方传错 id 或攻击者枚举 id，数据直接越权。
**建议**: 对上述 `WHERE id=?` 语句统一追加 `AND tenant_id=?`；对 `project_id/bundle_id/product_id` 类外键查询，先确认父资源属当前租户再下钻。
**关联目标**: G4, G6

---

### DA-02: `businessService` UPDATE/DELETE 不带 tenant_id（多租户写隔离 P0）

**严重级别**: P0（阻塞）
**位置**:
- `UPDATE service_tickets SET status='in_progress' WHERE id=?` — businessService.ts:823（addTicketMessage）
- `UPDATE product_reviews SET status='approved' WHERE id=?` — businessService.ts:1278（approveReview）
- `UPDATE product_reviews SET seller_reply=... WHERE id=?` — businessService.ts:1286（replyToReview）
- `UPDATE product_bundles SET ... WHERE id=?` — businessService.ts:675（updateAssortment）
- `DELETE campaign_products WHERE campaign_id=?` — businessService.ts:1119（deleteCampaign）

**问题**: 这些写操作**WHERE 子句只带 `id`（或 `campaign_id`）不含 `tenant_id`**。攻击者可改 id 参数跨租户修改任意工单状态、审核/回复任意评价、更新任意组盘、删除任意活动关联商品。
**影响**: 跨租户篡改业务数据，严重违反多租户隔离。G4 数据可信度直接崩塌。
**建议**: 所有 UPDATE/DELETE 的 WHERE 统一带 `tenant_id=?`（或先验证父资源属当前租户）。
**关联目标**: G4, G6

---

### DA-03: `listTickets` 的 keyword LIKE 命中不存在的 `t.title` 列

**严重级别**: P0（数据可信度）
**位置**: `server/src/services/businessService.ts:794`
**证据**:
```ts
where += ' AND (t.title LIKE @kw OR t.description LIKE @kw OR o.order_no LIKE @kw)';
```
**问题**: `service_tickets` 表（schema.sql:446-469）中**没有 `title` 列**，实际列名为 `subject`。所有带 `keyword` 的 `GET /api/business/tickets` 关键词搜索在 `t.title` 上**永远为 NULL**，只有 `t.description` 与 `o.order_no` 两个字段真正参与匹配——工单标题关键词永远搜不到。
**影响**: 客服工单按标题关键词搜索功能**完全失效**。
**建议**: 将 `t.title` 改为 `t.subject`。
**关联目标**: G4

---

### DA-04: 指标口径冲突 — 今日 GMV / 业务线 GMV / 总览 GMV 三处不一致

**严重级别**: P1（重要）
**位置**:
- `cockpitService.ts:98-106` 今日 GMV SQL
- `cockpitService.ts:393-401` 业务线 GMV SQL
- `analyticsService.ts:431-433` 总览 GMV formula

**证据**:
1. **总览 GMV**（analytics）= `Σ(revenueOf(o))`，其中 `countsTowardRevenue` 含 **{paid, partial, refunded}**（含退款订单）。
2. **业务线 GMV**（cockpit）= `SUM(CASE WHEN payment_status IN ('paid','partial') THEN paid_amount ELSE 0 END)` — **只含 paid+partial，不含 refunded**；且只取 `paid_amount`，不按 `revenueOf` 的 paid>0?paid:total 口径。
3. **今日 GMV**（cockpit）= `SUM(CASE WHEN payment_status NOT IN ('refunded') THEN paid_amount ELSE 0 END)` — **排除 refunded，只取 paid_amount**。

**影响**: 同一租户在同一区间，驾驶舱的"今日 GMV / 业务线 GMV"与 Analytics "GMV"数字**必然不一致**（退款订单的处理、未付款订单的 paid_amount=0 vs total_amount 兜底三处都不同）。数据分析的死罪——看板数据对不上。
**建议**: 全局统一 GMV 口径，把 cockpit 的业务线/今日 GMV 都改走 `utils/orderMetrics.ts` 的 `countsTowardRevenue` + `revenueOf`，或至少在文档明确三个指标的口径差异。
**关联目标**: G4

---

### DA-05: 零写入方表 `efficiency_metrics`

**严重级别**: P1（重要）
**位置**:
- 定义 `schema.sql:297-315`
- 唯一写入方：`hrService.ts:568-600` 的 `getEfficiencyMetrics()` ——**只是按"查不到就临时算一次返回，并不写回表"**。
- schema 中该表的 UNIQUE 约束 `(tenant_id, period, scope, scope_id)` 设计为预计算结果缓存。

**问题**: `efficiency_metrics` 表**在整个代码库中没有任何 INSERT 写入方**。`hrService` 读取时若表为空，仅在内存中临时聚合后返回对象，但**不持久化**到 `efficiency_metrics`，导致缓存机制完全失效、该表永远为空。
**影响**: 人效缓存表形同虚设；每次读取都做全量重算，大租户下人效接口性能受损。
**建议**: 在 `hrService`（或 inventoryService 的归因计算）中补上 `INSERT OR REPLACE INTO efficiency_metrics ...` 写回逻辑，使预计算缓存生效。
**关联目标**: G4, G6

---

### DA-06: `getProject(id)` 不接受 tenantId 参数，存在租户穿透路径

**严重级别**: P1（重要）
**位置**: `businessService.ts:101-120`（方法签名无 tenantId），路由 `business.ts:47-50`（`GET /api/business/projects/:id`）

**问题**: `getProject(id)` 的方法签名**未接收 `tenantId`**，直接按 id 查 projects；路由也未传入 tenantId。虽然路由本身走 `tenantIsolation` 中间件，但**服务层方法对调用方完全开放**——若其它服务/模块直接调 `getProject(id)` 且未校验租户，即可越权读取任意租户项目。对比同类方法 `getProduct(id)`、`getProductReviewStats(tenantId, productId)`，此处设计不一致。
**影响**: 服务内部调用 `getProject` 时绕过租户隔离；与 G6 健壮性矛盾。
**建议**: 将 `getProject` 改为 `getProject(id, tenantId)`，WHERE 加 `AND p.tenant_id=?`，并同步修改 `updateProject` 中两次 `return this.getProject(id)!`。
**关联目标**: G4, G6

---

### DA-07: `businessService.ts` 语法错误 + 残留代码 + 跨租户读（previewAssortment）

**严重级别**: P1（重要）
**位置**: `businessService.ts:738-766`
**证据**:
```ts
// 738-753: previewAssortment 函数正常体
previewAssortment(id: string, tenantId: string): any {
  const items = a.products.map((p) => {
    const row = db.prepare('SELECT sku,name,stock,selling_price,cost_price FROM products WHERE id=?').get(p.productId);  // ← 无 tenant_id
    ...
  });
  return { ...a, items };
}
// 755-766: 残留的半截代码（map 的 callback body 与闭括号），无归属函数
const row = db.prepare('SELECT sku,name,stock,selling_price,cost_price FROM products WHERE id=?').get(p.productId);
return { productId, sku, name, quantity, unitPrice, stock, sellingPrice, costPrice, lineTotal };
});
return { ...this._toPlainAssortment(a), items };
```

**问题**: 存在三种问题叠加：
1. **残留死代码**（755-766 行）是前一次重构（`_toPlainAssortment`）的半截 callback body，不属于任何函数，编译虽能通过（未命名表达式在方法体尾可能被解析为语句）但**逻辑混乱**。
2. **`_toPlainAssortment` 方法不存在** — 该行直接引用一个未定义的方法，运行时报 `TypeError: this._toPlainAssortment is not a function`。
3. **两次 products 查询**均 `WHERE id=?` **无 tenant_id**（743、755 行）。

**影响**: 755-766 行的死代码在运行时会抛出 `_toPlainAssortment is not a function` 异常；743 行的 products 查询可被用于跨租户读取任意商品。
**建议**: 删除 755-766 行残留代码；将 743 行 products 查询追加 `AND tenant_id=?`；确认 `_toPlainAssortment` 是否被真正使用。
**关联目标**: G6

---

### DA-08: `getProductReviewStats` 路由传了 tenantId 但方法未使用

**严重级别**: P1（重要）
**位置**: 路由 `business.ts:440-443`，方法 `businessService.ts:1290-1310`

**证据**:
- 路由调用: `businessService.getProductReviewStats(req.user!.tenantId, req.params.productId)`（传了 tenantId）
- 方法签名: `getProductReviewStats(tenantId: string, productId: string)` —— tenantId 被声明但**两条查询（1295、1299 行）都只用了 `product_id=?`，未用到 tenantId**。

**问题**: 方法参数 `tenantId` 实际被丢弃，SQL 无租户隔离。任意租户可查任意商品的评价统计。
**影响**: 与 DA-01 同类，评价统计跨租户泄漏。
**建议**: SQL 中加 `AND tenant_id=?`，使用传入的 tenantId。
**关联目标**: G4

---

### DA-09: `todayGmv` 口径逻辑缺陷 + 双汇总不一致

**严重级别**: P1（数据可信度）
**位置**: `cockpitService.ts:98-106, 162`
**证据**:
```sql
-- 101-106: 单条 SQL 同时算两个汇总
SUM(CASE WHEN payment_status NOT IN ('refunded') AND is_sandbox=0 THEN paid_amount ELSE 0 END) AS gmv
SUM(CASE WHEN is_sandbox=0 THEN total_amount ELSE 0 END) AS total
```
```ts
// 162: 兜底逻辑
todayGmv: round2(Number(todayRow.gmv||0)>0 ? Number(todayRow.gmv) : Number(todayRow.total||0))
```

**问题**:
1. `gmv` 汇总排除 refunded 但 `total` 汇总**包含** refunded——当"今日全为退款订单"时，`gmv=0`、`total=退款订单的 total_amount`，**`todayGmv` 会落到 total 上**，等于把退款订单按总额计为 GMV，**虚增今日 GMV**。
2. 与总览 GMV 口径（含 refunded 走 revenueOf）不一致（详见 DA-04）。

**影响**: 特定场景（今日仅退款无成交）下今日 GMV 卡显示的是退款总额而非 0，指标失真。
**建议**: todayGmv 兜底逻辑应直接返回 0 而非 fallback 到 total；gmv 与 total 的过滤条件应一致。
**关联目标**: G4

---

### DA-10: `getOrderStats` 的"total_revenue"= SUM(total_amount) 与 GMV 口径冲突

**严重级别**: P1（数据可信度）
**位置**: `businessService.ts:555-564`
**证据**:
```ts
COALESCE(SUM(total_amount), 0) as total_revenue,
COALESCE(SUM(CASE WHEN payment_status='paid' THEN total_amount ELSE 0 END), 0) as paid_revenue,
COALESCE(AVG(total_amount), 0) as avg_order_value
```
**问题**: `total_revenue` 是 **所有订单的 total_amount 之和**，不论支付状态——把未付款、已取消订单的金额也算进"营收"；且用 `total_amount` 而非 `paid_amount` 或 `revenueOf` 口径。与 Analytics GMV（仅 paid/partial/refunded，走 revenueOf）口径矛盾。
**影响**: 订单统计接口的 `total_revenue` 数值与 Analytics 的 GMV、Cockpit 的营收**系统性偏差**，未付款订单越多偏差越大。
**建议**: 统一走 `orderMetrics` 的口径；或重命名 `total_revenue` 为 `total_order_amount` 以避免与"营收"混淆。
**关联目标**: G4

---

### DA-11: `getFunnel`（analyticsService）漏斗阶段跨表口径不一致

**严重级别**: P2（优化）
**位置**: `analyticsService.ts:521-535`
**证据**:
```ts
// projectCount 用 projects.status IN ('planning','approved','in_progress','paused','completed')  —— 含 completed
// productCount 用 products.status IN ('candidate','selected','listed','out_of_stock') —— 含 out_of_stock
// bundleCount 用 product_bundles.status IN ('draft','active','expired') —— 含 expired
```
**问题**: 与 Cockpit 漏斗（`cockpitService.ts:179-194`）的阶段筛选**不一致**：
- Analytics 立项含 `completed`，Cockpit 不含
- Analytics 选品含 `out_of_stock`，Cockpit 不含
- Analytics 组盘含 `expired` + `draft`，Cockpit 只取 `active`

**影响**: 同一区间，Analytics 漏斗与 Cockpit 漏斗各阶段数量**无法对齐**；产品侧两个漏斗数字打架。
**建议**: 统一定义"漏斗各阶段应包含哪些状态"，写一个共享常量，analytics 与 cockpit 共同引用。
**关联目标**: G4

---

### DA-12: `getFunnel` 漏斗时间过滤仅作用于 projects/products/bundles，orders 段不受控

**严重级别**: P2（优化）
**位置**: `analyticsService.ts:514-538`
**证据**: `dateClause = 'substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?'` 只在 projectCount/productCount/bundleCount 的 SQL 中使用；orderCount/paidCount/repurchaseCount 来自 `this.loadOrders(tenantId, range)`。
**问题**: 前三段 SQL 用的是**闭区间** `>= from AND <= to`；loadOrders 也是闭区间——表面上一致，但**orders 段的时间范围完全由 loadOrders 控制，不在同一个 SQL 中**，与前三段的 SQL 时间过滤在代码路径上解耦，难以审计和保证一致性；此外，如果未来 projects/products 表增加时间相关条件，漏斗三段的过滤逻辑会脱节。
**影响**: 审计成本高，未来修改时容易漏改导致时间口径漂移。
**建议**: 将漏斗各段的时间过滤抽成一个统一的 `buildDateClause` 函数，所有阶段统一引用。
**关联目标**: G6

---

### DA-13: schema 中重复索引 `idx_orders_owner`

**严重级别**: P2（优化）
**位置**: `schema.sql:443, 1147`
**证据**:
```sql
CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(tenant_id, owner_employee_id);   -- 443
CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(owner_employee_id);              -- 1147
```
**问题**: 同名索引重复定义，且两个 `(tenant_id, owner_employee_id)` 与 `(owner_employee_id)` 索引存在冗余——SQLite 的 `IF NOT EXISTS` 会让第二个同名索引**静默跳过**（或报错，取决于引擎），但此处两个索引同名，会导致**第二个被忽略或建表报错**。且 `(owner_employee_id)` 单列索引不含 tenant_id，对多租户查询无索引收益。
**影响**: 索引定义混乱；人效按 owner_employee_id 查询时缺少覆盖 tenant_id 的联合索引可能导致全表扫描。
**建议**: 删除 1147 行的重复单列索引；保留 443 行的 `(tenant_id, owner_employee_id)`。
**关联目标**: G6

---

### DA-14: schema 中 `product_reviews` 表重复定义 + 重复索引

**严重级别**: P2（优化）
**位置**: `schema.sql:1310-1355`
**证据**: `CREATE TABLE IF NOT EXISTS product_reviews (...)` 在 1310 和 1335 行**完全重复**定义两次；三个索引（1328-1330、1353-1355）也重复定义。
**问题**: SQLite 的 `IF NOT EXISTS` 会使第二次建表与建索引**静默跳过**，但 schema 文件中存在**重复声明**，易让人误以为存在两张独立表，或在迁移/重构时产生歧义。
**影响**: 代码可读性与维护风险；无运行期影响但审计时应清理。
**建议**: 删除 1335-1355 行的重复定义与重复索引。
**关联目标**: G6

---

### DA-15: 健康度评估"组织效能"维度分母 `headcount` 取全体在职员工，与归因口径不匹配

**严重级别**: P2（优化）
**位置**: `analyticsService.ts:934-938, 1324-1349`
**证据**: `headcount = COUNT(*) FROM employees WHERE status IN ('active','probation')`，归因覆盖率 = `attributedEmployeeCount / headcount`。
**问题**: 归因产出来自 `performance_attributions`，其 `source_type IN ('order','live_session','ticket','project','bundle')`，但**并非所有在职员工都参与业务（如 HR、财务、行政）**。用人效维度把**全部在职员工**作为分母来算"归因覆盖率"，会让非业务岗位长期拉低组织效能分，造成"组织效能"分失真——员工越多（含非业务岗）分越低，与"组织效能"的语义不符。
**影响**: 经营健康度的"组织效能"维度对非业务人员占比高的租户给出**系统性偏低的分**。
**建议**: 将 headcount 分母限定为"绑定员工档案且有 owner_employee_id 关联的在职员工"，或在维度描述中明确"含非业务岗位"。
**关联目标**: G4

---

### DA-16: 日期处理时区漂移——`analyticsService` 全 UTC、`cockpitService` 用本地时间

**严重级别**: P2（优化）
**位置**:
- `analyticsService.ts:1671-1683` —— `todayStr()` 走 `toISOString().slice(0,10)`（UTC）
- `cockpitService.ts:99` —— `new Date().toISOString().slice(0,10)`（UTC，但 `datetime('now')` 走 SQLite 本地时区）
- 多处 `substr(created_at, 1, 10)` 依赖 `created_at` 的字符串格式

**问题**: `analyticsService` 内部所有日期计算（`todayStr`、`addDays`、`diffDays`）走 UTC；`cockpitService` 用 `new Date().toISOString()` 取当天，但 `datetime('now')`、`datetime('now','-30 days')` 在 SQLite 中默认**使用本地时区**。两个服务"今天"的起点对齐不一致，跨 0 点 8 小时内会出现**1 天偏差**，导致驾驶舱与 Analytics 的区间数据对不上。
**影响**: 驾驶舱"今日"数据与 Analytics"今日"数据在时区边界附近不一致。
**建议**: 统一日期为 UTC，所有 `datetime()` 调用显式带时区（`datetime('now','+0000')`），`todayStr` 与 SQL 时间过滤使用同一时区基准。
**关联目标**: G4, G6

---

## 多租户隔离审计结果

### 各服务 tenant_id 过滤情况

| 服务文件 | 数据查询数（估算） | 已带 tenant_id | 遗漏/风险 | 主要遗漏 |
|----------|-------------------|----------------|-----------|----------|
| `analyticsService.ts` | 12 处 SQL | 12/12 | 0 | **全部带 tenant_id**（含 live_sessions 容错降级） |
| `cockpitService.ts` | 12 处 SQL | 12/12 | 0 | 全部带 tenant_id（含嵌套 products 查询） |
| `businessService.ts` | 50+ 处 SQL | ~33 | **~17 处** | **create/crud 返回时的 `WHERE id=?` 无 tenant_id**（DA-01、DA-02）；keyword LIKE 命中错列（DA-03） |
| `inventoryService.ts` | 30+ 处 SQL | 30/30 | 0 | 全部带 tenant_id |
| `hrService.ts` | 10+ 处 SQL | 10/10 | 0 | 全部带 tenant_id |
| `livestreamService.ts` | 20+ 处 SQL | 20/20 | 0 | 全部带 tenant_id（含 live_metrics） |
| `crossborderService.ts` | 20+ 处 SQL | 20/20 | 0 | 全部带 tenant_id |

**结论**: **Analytics 域（analyticsService + cockpitService）tenant_id 隔离 100% 通过**；**businessService 是隔离最大漏洞来源**（20+ 处缺失 tenant_id）。

### 审计铁律检查：`SELECT * FROM <table> WHERE id=?` 模式

全库该模式出现在 `businessService.ts` 约 25 处，**无一处带 tenant_id**（详见 DA-01）。这是本系统**最高优先级**的多租户隔离漏洞。

---

## 指标口径一致性审计

### 全局"营收/GMV"三处定义

| 位置 | 口径 | 含 refunded | 用 paid_amount 还是 total_amount |
|------|------|-------------|-----------------------------------|
| `analyticsService.ts:431-433`（总览 GMV） | Σ revenueOf(o)，payment_status ∈ {paid, partial, refunded} | ✅ | revenueOf(paid>0 ? paid : total) |
| `cockpitService.ts:100-106`（今日 GMV） | SUM(paid_amount)，payment_status NOT IN ('refunded') | ❌ | 仅 paid_amount |
| `cockpitService.ts:393-401`（业务线 GMV） | SUM(paid_amount)，payment_status IN ('paid','partial') | ❌ | 仅 paid_amount |
| `businessService.ts:555-564`（getOrderStats.total_revenue） | SUM(total_amount)，无支付状态过滤 | 全部订单 | total_amount |

**结论**: 四个位置对"GMV/营收"**定义完全不同**（DA-04、DA-09、DA-10），**数据看板必然对不上**——P0 级别的数据可信度风险。

### 共享口径工具

`utils/orderMetrics.ts`（`revenueOf` / `countsTowardRevenue` / `isPaid` / `isRefunded`）是**全系统唯一权威口径**，被 `analyticsService`（自实现相同函数）、`cockpitService`（import）引用。但 `analyticsService` **重新实现了同名函数**（1493-1515 行）而非复用该工具模块——存在两个副本，未来修改一处容易遗漏另一处（DA 建议：analyticsService 应 import 该模块并废弃副本）。

---

## 零写入方表清单

| 表名 | schema 位置 | 是否带 tenant_id | 写入方服务 | 路由端点 | 前端入口 | 结论 |
|------|-------------|------------------|------------|----------|----------|------|
| `efficiency_metrics` | schema.sql:297 | ✅ | **无**（hrService 只读不写） | `/api/hr/efficiency`（GET 读取） | 人效页面 | **零写入方**（DA-05） |
| `live_metrics` | schema.sql:1036 | ✅ | `livestreamService` INSERT（1519 行） | `/api/livestream/metrics` | 直播指标 | **有写入方** ✅ |
| `performance_attributions` | schema.sql:1197 | ✅ | `inventoryService` INSERT（1106 行） | 无独立路由（由归因任务写入） | 库存预警/归因任务 | **有写入方** ✅ |
| `analytics_snapshots` | schema.sql:1214 | ✅ | `analyticsService.computeSnapshots`（1372-1418 行） | `POST /api/analytics/snapshots/compute` | 分析快照 | **有写入方** ✅ |
| `campaigns` | schema.sql:1236 | ✅ | `businessService.createCampaign` | `POST /api/business/campaigns` | 大促活动 | **有写入方** ✅ |
| `campaign_products` | schema.sql:1267 | ❌（无 tenant_id 列） | `businessService.addProductToCampaign` | `/api/business/campaigns/:id` 联动 | 活动商品 | ⚠️ 表本身无 tenant_id，隔离靠父表 campaigns |
| `ad_spend` | schema.sql:1281 | ✅ | `businessService.createAdSpend` | `POST /api/business/ad-spend` | 投流记录 | **有写入方** ✅ |
| `product_reviews` | schema.sql:1310 | ✅ | `businessService.createReview` | `POST /api/business/reviews` | 商品评价 | **有写入方** ✅ |

**关键发现**: 唯一真正的**零写入方表**是 `efficiency_metrics`（DA-05）；其余新表（campaigns / ad_spend / product_reviews / analytics_snapshots / performance_attributions）均有对应服务方法与路由端点。

**附注**:`campaign_products` 表**无 tenant_id 列**，隔离完全依赖 `campaign_id` 外键到 `campaigns`(有 tenant_id)——属于可接受但需关注的设计（删除活动时需先校验租户，deleteCampaign 中已有校验 ✅）。

---

## 比率指标分母为 0 处理审计

| 位置 | 指标 | 分母处理 | 是否安全 |
|------|------|----------|----------|
| `analyticsService.ts:439` | AOV = revenue / paidOrders | `paidOrders > 0 ? ... : 0` | ✅ 安全 |
| `analyticsService.ts:445` | 毛利率 = grossProfit / revenue | `revenue > 0 ? ... : 0` | ✅ 安全 |
| `analyticsService.ts:448` | 转化率 = paidOrders / totalOrders | `totalOrders > 0 ? ... : 0` | ✅ 安全 |
| `analyticsService.ts:451` | 退款率 = refundedOrders / totalOrders | `totalOrders > 0 ? ... : 0` | ✅ 安全 |
| `analyticsService.ts:586` | 漏斗转化率 = s.count / prev.count | `prev > 0 ? ... : 0` | ✅ 安全 |
| `analyticsService.ts:694,703` | share = value / total | `total !== 0 ? ... : 0` | ✅ 安全 |
| `analyticsService.ts:854,863,876` | marginRate / cumulativeShare / gmvShare | `gmvTotal > 0 / s.gmv > 0` | ✅ 安全 |
| `analyticsService.ts:913` | sellThroughRate = soldSku / totalSku | `totalSkuCount > 0 ? ... : null` | ✅ 安全 |
| `analyticsService.ts:1019,1031` | 人均 GMV / 人均毛利 | `headcount > 0 ? ... : 0/null` | ✅ 安全 |
| `analyticsService.ts:1112` | 复购率 = repeat / total | `inRange.size > 0 ? ... : null` | ✅ 安全 |
| `analyticsService.ts:1192` | 增长率 g = (cur-prev)/prev | **先判断 prevAgg.revenue <= 0 则 score=null** | ✅ 安全 |
| `analyticsService.ts:1303` | 退款率 = refundedOrders / totalOrders | 前置 `curAgg.totalOrders === 0` 返回 null | ✅ 安全 |
| `analyticsService.ts:1306` | 工单解决率 = done / total | `hasTickets ? ... : 0` | ✅ 安全 |
| `analyticsService.ts:1386-1391` | snapshot aov/conversion 等 | 全部分母判断 | ✅ 安全 |
| `analyticsService.ts:1623` | computeChangeRate（同环比） | `prevValue === 0 ? null` | ✅ 安全（**最诚实的处理：基期为 0 返回 null 而非 0**） |
| `cockpitService.ts:223` | 漏斗转化率 | `prev > 0 ? ... : 0` | ✅ 安全 |
| `cockpitService.ts:295` | 退款率 Top | `totalN > 0 ? cnt/totalN : 0` | ✅ 安全 |
| `cockpitService.ts:438` | 业务线转化率 | `b.total > 0 ? ... : 0` | ✅ 安全 |
| `businessService.ts:1168` | ROI = gmv / spend | `input.spend > 0 ? ... : 0` | ✅ 安全 |
| `businessService.ts:1231` | overallRoi | `totalSpend > 0 ? ... : 0` | ✅ 安全 |
| `businessService.ts:1234` | 平台 ROI | `(p.spend\|\|0) > 0 ? ... : 0` | ✅ 安全 |
| `crossborderService.ts:2174` | landed cost ROI | `totalCostCny > 0 ? ... : 0` | ✅ 安全 |

**结论**:**全系统比率指标分母为 0 的处理 100% 安全**，无除零崩溃风险。`computeChangeRate` 对基期为 0 返回 `null` 而非 0 是最严谨的实现。

---

## 索引与性能审计

| 检查项 | 现状 | 结论 |
|--------|------|------|
| `orders` 复合索引 | `(tenant_id, created_at)` / `(tenant_id, substr(created_at,1,10))` / `(tenant_id, payment_status, substr(created_at,1,7))` / `(tenant_id, is_sandbox)` / `(tenant_id, owner_employee_id)` | ✅ 覆盖充分 |
| `substr(created_at)` 索引 | `idx_orders_tenant_created ON orders(tenant_id, substr(created_at, 1, 10))` | ⚠️ **SQLite 对 substr 函数生成的虚拟列**在某些版本不能命中普通索引，实际可能全表扫描；建议建**虚拟生成列**或存储函数索引 |
| `idx_orders_owner` 重复 | 443 行与 1147 行重复定义（含单列版本） | ❌ 见 DA-13 |
| `product_reviews` 索引 | `(product_id, status)` / `(tenant_id, status, created_at)` / `(user_id, status)` | ✅ 覆盖充分 |
| `analytics_snapshots` 索引 | `(tenant_id, metric_key, period_type, period_start)` | ✅ 覆盖充分 |
| `performance_attributions` 索引 | `(tenant_id, employee_id, period)` / `(tenant_id, source_type, source_id)` | ✅ 覆盖充分 |
| `campaigns` 索引 | `(tenant_id, status)` / `(tenant_id, start_date, end_date)` | ✅ 覆盖充分 |
| `ad_spend` 索引 | `(tenant_id, spend_date)` / `(tenant_id, platform, spend_date)` / `(campaign_id)` | ✅ 覆盖充分 |

**性能风险**: 大量 `substr(created_at, 1, 10)` 作为查询条件（analyticsService 全量使用），在 SQLite 中函数索引覆盖效果有限；建议对 `created_at` 建**虚拟生成列**（`substr(created_at, 1, 10)`）再加索引，或改用 `created_at >= ? AND created_at < ?` 的 range 查询。

---

## 改进建议（按优先级）

### P0（立即修复）
1. **DA-01 + DA-02**：全量补 businessService 中所有 `WHERE id=?` 查询与 UPDATE/DELETE 的 `tenant_id=?` 条件（约 25 处），这是多租户安全底线。
2. **DA-03**：`listTickets` 的 `t.title` 改为 `t.subject`（工单搜索功能恢复）。
3. **DA-06**：`getProject(id)` 改为接收 tenantId 并加 tenant_id 过滤。
4. **DA-08**：`getProductReviewStats` 实际使用传入的 tenantId。

### P1（本周修复）
5. **DA-04/DA-09/DA-10**：统一 GMV/营收口径，cockpit/business 全部改走 `utils/orderMetrics.ts`，或至少在文档明确三个指标的口径差异。
6. **DA-07**：删除 businessService.ts 755-766 行残留死代码，修复 previewAssortment 跨租户读。
7. **DA-05**：补 `efficiency_metrics` 的 INSERT 写入方（hrService 或 inventoryService 归因任务）。
8. **analyticsService 复用的 orderMetrics 副本**（1493-1515 行）应与 `utils/orderMetrics.ts` 合并为单一权威来源，避免双副本未来漂移。

### P2（本周内规划）
9. **DA-11/DA-12**：统一漏斗阶段状态定义，抽离 `buildDateClause` 统一时间过滤。
10. **DA-13/DA-14**：清理 schema 中重复索引与重复表定义。
11. **DA-16**：统一 analyticsService 与 cockpitService 的时区处理为 UTC。
12. **DA-15**：复核"组织效能"维度分母口径是否应排除非业务岗。
13. **性能**: 为 `substr(created_at)` 查询建虚拟生成列索引，或改用 range 查询。

---

## 总结

### 审计结论总览

| 维度 | 评级 | 说明 |
|------|------|------|
| Analytics 服务数据完整性 | **A** | 全 SQL 聚合、无占位数据、无随机兜底，设计严谨；公式字段完备 |
| Analytics 多租户隔离 | **A** | 100% 带 tenant_id，含 live_sessions 容错降级 |
| Cockpit 服务多租户隔离 | **A** | 100% 带 tenant_id，嵌套查询也有隔离 |
| Business 服务多租户隔离 | **F（P0）** | 25+ 处缺失 tenant_id，含 SELECT/UPDATE/DELETE，系统最大安全漏洞 |
| 指标口径一致性 | **D（P0/P1）** | GMV/营收 4 处定义完全不同，驾驶舱与 Analytics 数据必然不一致 |
| 比率指标分母安全 | **A** | 100% 安全，computeChangeRate 对基期 0 返回 null 为最佳实践 |
| 新表完整性 | **A-** | 新表均有对应服务/路由；唯 `efficiency_metrics` 为零写入方 |
| schema 索引规范 | **B** | 覆盖充分但存在重复索引（DA-13）、重复表定义（DA-14）；substr 索引有性能隐患 |
| 代码健壮性 | **C** | businessService.ts 存在残留死代码（DA-07）、方法引用不存在函数 |

### 一句话摘要

> **Analytics 域本身质量很高（口径严谨、隔离完整、分母安全），最大风险集中在 businessService 的 25+ 处多租户隔离缺失（P0），以及 cockpit/business 与 analytics 三处 GMV 口径不一致导致的数据看板数字对不上（P0/P1）。`efficiency_metrics` 为零写入方表。**

### 缺陷严重性统计

| 级别 | 数量 | 编号 |
|------|------|------|
| P0（阻塞） | 5 | DA-01, DA-02, DA-03, DA-04（含 DA-09/DA-10 合并计），DA-06 |
| P1（重要） | 3 | DA-05, DA-07, DA-08 |
| P2（优化） | 7 | DA-09(若单列), DA-10(若单列), DA-11, DA-12, DA-13, DA-14, DA-15, DA-16 |

---

*审计完毕。所有发现均基于当前代码实际取证，附文件:行号。*
