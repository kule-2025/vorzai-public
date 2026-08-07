# 跨境电商专家 · 审计报告

**审计时间**：2026-07-31
**审计方法**：基于当前代码取证，每条问题附文件:行号证据
**关联业务目标**：G2=跨境规模, G6=系统健壮性

---

## 一、总体结论

跨境域是 VorZai 质量最高的模块之一：2472 行 `crossborderService.ts`，22 个路由端点，前端 `CrossBorderHub.tsx`（841 行）完整接入 `@api/crossborder` 模块，所有数据来自后端 API，零 Mock。合规、汇率、落地成本测算三大子域后端服务完备，多租户隔离基本到位。

核心问题集中在：(1) 两个方法缺少 tenantId 参数，(2) `getOverview` 中汇率查询异常被静默吞掉导致汇率新鲜度数据缺失时用户无感知，(3) 跨境订单与国内订单在 orders 表中无显式标识字段，跨域查询需额外过滤逻辑。

---

## 二、缺陷清单

---

### 模块 1：汇率管理

#### CB-01 | P1 | `createExchangeRate` 不接收 tenantId 参数，依赖调用方透传

- **位置**：`server/src/services/crossborderService.ts:1862`
- **证据**：
  ```typescript
  createExchangeRate(input: {
    fromCurrency: string; toCurrency: string; rate: number;
    effectiveDate?: string; source?: string; note?: string;
  })
  ```
  方法签名无 `tenantId: string` 参数；方法体内 `db.prepare(...).run(...)` 使用外部变量获取租户 ID。对比同文件 `upsertExchangeRate(tenantId: string, ...)` 和 `getExchangeRates(tenantId: string)` 均有显式 tenantId 参数——签名不一致，调用方需自行传入租户 ID，存在传递遗漏风险。
- **影响**：若路由层传入错误的 tenantId 或遗漏，汇率记录可能写入错误租户。
- **建议**：统一方法签名，`createExchangeRate` 加 `tenantId: string` 参数，与 `upsertExchangeRate` 保持一致。
- **关联目标**：G2

#### CB-02 | P1 | `getOverview` 汇率查询异常被 try-catch 静默吞掉，汇率新鲜度数据缺失时用户无感知

- **位置**：`server/src/services/crossborderService.ts:1644`
- **证据**：
  ```typescript
  } catch (e) {
    logger.warn('crossborder', `getExchangeRates query failed: ${String(e)}`);
    rows = [];
  }
  ```
  `getOverview` 中调用 `getExchangeRates(tenantId)` 时，若汇率表为空或查询失败，`rows` 被置空，`manualCount` 返回 0，`freshRates` 返回空数组，`staleRates` 返回空数组——用户在"汇率新鲜度"卡片看到全 0，无法区分"真的没有手工维护汇率"还是"数据库出错了"。
- **影响**：运营人员无法判断汇率数据是否异常，可能基于错误信息做结算决策。
- **建议**：在 `CrossBorderOverview` 结构中添加 `exchangeRateError` 字段（类型 `string | null`），异常时记录错误信息，前端据此显示"汇率数据加载失败"提示而非展示全 0。
- **关联目标**：G2

---

### 模块 2：合规管理

#### CB-03 | P2 | 商品跨境属性 `is_prohibited` 默认为 NULL，非 0/1，合规体检可能漏判

- **位置**：`server/src/db/schema.sql`（products 表），`server/src/services/crossborderService.ts:1051`
- **证据**：
  - schema 中 `is_prohibited` 无 DEFAULT 值，NULL 是合法状态
  - `getOverview` 合规统计：`SUM(CASE WHEN is_prohibited = 1 THEN 1 ELSE 0 END)` 正确识别 `= 1`
  - 但 `getProductCompliance` 返回的 `isProhibited` 是 `Boolean`，`NULL` 被映射为 `false`
  - `checkScriptCompliance` 调用 `getProductCompliance` 时，`isProhibited === false` 包含 NULL 商品——合规体检可能漏判未标记的商品
- **影响**：未设置跨境属性的商品在合规体检中被视为"非违禁"，绕过审核。
- **建议**：在 `getProductCompliance` 中，将 `is_prohibited IS NULL` 映射为 `undefined` 而非 `false`；前端对 `undefined` 显示"未评估"状态。
- **关联目标**：G2

---

### 模块 3：落地成本测算

#### CB-04 | P2 | 落地成本测算 `getOverview` 中 `recentLandedCosts` 硬编码空数组

- **位置**：`server/src/services/crossborderService.ts:2290-2320`
- **证据**：
  `getOverview` 中 `recentLandedCosts` 直接返回空数组 `[]`，虽然前端有"落地成本测算"Tab，但该 Tab 调用的是独立 API `calculateLandedCost`，概览页的最近测算展示始终为空。
- **影响**：运营进入跨境 Hub 首页时，看不到最近的成本测算记录，无法快速回顾。
- **建议**：`recentLandedCosts` 改为从 `landing_cost_records` 表（或新增临时记录表）查询最近 5 条测算记录；若暂不建表，改为展示"暂无最近测算记录"而非空数组。
- **关联目标**：G2

---

### 模块 4：跨境选品

#### CB-05 | P2 | 跨境选品到结算全链路缺少 `crossborder_order_flag`，跨境与国内订单无法在订单层面区分

- **位置**：`server/src/db/schema.sql`（orders 表），`server/src/services/crossborderService.ts`
- **证据**：orders 表中无 `is_crossborder` 或类似标识字段。跨境场景下订单通过 `platform` 字段（'amazon'/'shopify'/'aliexpress' 等）间接标识，但国内平台订单（淘宝/京东）也可能有 `platform` 字段，两者混淆。
- **影响**：GMV 统计、合规报表、跨境利润计算时无法在订单层面准确筛选跨境订单。
- **建议**：在 `orders` 表新增 `is_crossborder`（INTEGER DEFAULT 0）字段，跨境订单创建时自动标记；`cockpitService` 和 `analyticsService` 的 GMV 查询增加该过滤条件。
- **关联目标**：G2

---

## 三、功能完整性评分

| 模块 | 后端 Service | 路由端点 | 前端 | 数据写入方 | 评分 |
|------|-------------|---------|------|----------|------|
| 合规管理 | ✅ | ✅ (3端点) | ✅ | ✅ | 90% |
| 汇率管理 | ✅ | ✅ (4端点) | ✅ | ✅ | 90% |
| 落地成本测算 | ✅ | ✅ (1端点) | ✅ | ✅ | 85% |
| 概览汇总 | ✅ | ✅ (1端点) | ✅ | ⚠️ recentLandedCosts 空 | 75% |
| HS Code 查询 | ✅ | ✅ (2端点) | ✅ | 内置库 | 100% |

**跨境域总评：88%**

---

## 四、改进建议（按优先级）

1. **高优（2周内）**：CB-01 `createExchangeRate` 统一签名加 tenantId
2. **中优（1个月）**：CB-02 `getOverview` 汇率异常透出错误信息
3. **低优（后续）**：CB-03 `is_prohibited` NULL 映射、CB-04 `recentLandedCosts` 实装、CB-05 orders 表加跨境标识

---

## 五、总结

跨境域后端质量在 VorZai 各域中排名前三，多租户隔离覆盖率高、前端真实接入 API。主要不足是汇率异常吞没和跨境订单标识缺失——这些都是 P1/P2 级别的优化，不影响当前业务运行。跨境选品到结算的全链路逻辑（选品→采购→订单→履约→结算）在 API 层面已打通，前端可操作。
