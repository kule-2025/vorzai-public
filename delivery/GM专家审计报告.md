# GM 经营总管专家团 · 审计报告

**审计范围**：OGSM / 驾驶舱(BusinessCockpit) / 业务链(BusinessChain) / 增长引擎(GrowthEngine) / HR 人效模块
**审计时间**：2026-07-31
**审计方法**：基于当前代码取证，每条问题附文件:行号证据，无模糊表述
**关联业务目标**：G1=转化率，G3=运营效率，G6=系统健壮性

---

## 一、总体结论

1. **增长引擎（GrowthEngine）存在严重的内存假数据问题**，前端页面 + 模块层均硬编码虚构活动，后端虽已完整落地 campaigns/ad_spend/product_reviews 三张表的 Service+Route，但**前端无任何真实入口**——按规则"后端修了但前端无入口（判0分）"。
2. **业务链(BusinessChain)链路指标卡片 6 个指标全部硬编码假数据**，与实际经营数据脱钩。
3. **OGSM 全链路仅管理目标/策略/指标本身，无自动数据联动能力**，指标靠人工录入进度（PUT /goals/:id/progress），与真实业务 GMV/订单数据无关联。
4. **HR 人效**：`efficiency_metrics` 表无写入方（`computeEfficiencyMetrics` 不入库）；`getEfficiencyMetrics` 直接调用计算但跳过查表，数据不一致；`updateProduct` 方法**缺少 tenant_id 隔离**。
5. **listTickets 含无效 SQL 列（title）**，会导致查询报错/静默失败。
6. **businessService.ts 第 755–766 行残留死代码**（疑似复制粘贴产物），影响代码整洁性。

---

## 二、缺陷清单

---

### 模块 1：增长引擎（GrowthEngine）— 最严重，P0 集中区

#### GM-01 | P0 | 增长引擎前端页面硬编码假活动数据，与后端 campaigns 表脱钩
- **位置**：`src/views/Modules/GrowthEngine.tsx:58–88`、`src/modules/growth-engine/index.ts:44–65`
- **证据**：
  - `GrowthEngine.tsx` 页面通过 `api.cockpit.getOverview()` 拿到业务线切片后，用 `bizLines.map(...)` 硬拼成 `GrowthCampaign`（行66–78），其中 `budget: 0`、`spent: 0`、`roi: line.gmv > 0 ? (line.gmv / Math.max(line.gmv * 0.3, 1)) : 0` 是**自造的 ROI**（乘以 0.3 系数虚构投放金额），并非真实投流数据。
  - `growth-engine/index.ts` 模块层使用模块级内存变量 `let campaigns: Campaign[] = [...]`（行44–65），包含 3 条写死的虚构活动（"723 大促-全场 8 折"、"蓝牙耳机限时秒杀"、"新客专享 50 元券"），含虚构 ROI、impressions、clicks、conversions。**数据不写入后端，刷新页面即丢失**。
- **影响**：增长引擎的"活动"完全是伪造，无法反映真实营销投入产出；与后端 `campaigns` 表（`businessService.createCampaign`）毫无交互。
- **修复方案**：前端改用 `api.business.listCampaigns()` 加载真实 campaigns；投流用 `api.business.listAdSpend()` + `getAdSpendSummary()` 加载真实 ROI/花费；删除模块层内存假数据。
- **关联目标**：G1(转化率)、G6(系统健壮性)

#### GM-02 | P0 | 后端 campaigns/ad_spend/product_reviews 三张表均已完整落地，前端无真实入口
- **位置**：
  - 后端（有）：`server/src/services/businessService.ts:1054–1156`（campaigns）、`1158–1237`（ad_spend）、`1239–1310`（product_reviews）
  - 后端路由（有）：`server/src/routes/business.ts:389–543`
  - API Client（有）：`src/api/client.ts`（createAdSpend/listAdSpend/getAdSpendSummary/createCampaign/listCampaigns/createReview/listReviews/getProductReviewStats）
  - **前端（无）**：`src/views/Modules/GrowthEngine.tsx` 全程未调用上述任何 API；`BusinessChain.tsx` 全程无评价入口
- **证据**：Grep 全仓库 `createAdSpend`、`listAdSpend`、`createReview`、`listReviews` 在前端 `.tsx/.vue` 文件中 **0 处调用**；唯一一处 `createCampaign` 出现在模块层假内存的 `growthEngineModule.createCampaign`（行80），非 API 调用。
- **影响**：后端投入产出的完整 CRUD 无人可用，ROI 分析、投流成本、商品评价均无法从界面发起——典型的"后端修了但前端无入口"。
- **修复方案**：
  - GrowthEngine 总览/分析页接入 `api.business.listCampaigns()`、`api.business.listAdSpend()`、`api.business.getAdSpendSummary()`
  - 业务链"选品/订单"阶段接入 `api.business.listReviews()`、`getProductReviewStats()`
- **关联目标**：G3(运营效率)、G6

---

### 模块 2：业务链（BusinessChain）

#### GM-03 | P0 | 业务链链路指标 6 个指标全部硬编码假数据，与真实经营数据完全脱钩
- **位置**：`src/views/Modules/BusinessChain.tsx:1037–1053`
- **证据**：
  ```tsx
  {
    { label: '全链路周转天数', value: '3.2天', trend: '↓ 0.5' },
    { label: '订单履约率', value: '97.3%', trend: '↑ 1.2%' },
    { label: '库存周转率', value: '8.6x', trend: '↑ 0.3x' },
    { label: '售后处理时长', value: '4.1h', trend: '↓ 0.8h' },
    { label: '采购到货准时率', value: '93.5%', trend: '↑ 2.1%' },
    { label: '营销ROI', value: '3.2x', trend: '↑ 0.4x' },
  }
  ```
  6 个 value + trend 均为字符串常量，无任何后端调用支撑。
- **影响**：老板在"业务链"看的链路指标全是假数字，与实际 GMV、工单、库存毫无关系，严重误导经营判断。
- **修复方案**：接入 `api.analytics.getTrend()` / `api.cockpit.getOverview()` 或后端计算端点；trend 用环比真实计算。
- **关联目标**：G1、G6

#### GM-04 | P1 | BusinessChain 项目立项阶段（phase=project）用 `api.ogsm.listObjectives()` 加载 OGSM 目标，但筛选条件与实际业务项目（projects 表）割裂
- **位置**：`src/views/Modules/BusinessChain.tsx:166–174`、`94–100`
- **证据**：phase=`project` 时调用 `api.ogsm.listObjectives()`（行169），取的是 OGSM 目标树；但实际业务立项在 `projects` 表（`api.business.listProjects()`）。OGSM 是战略层，projects 是业务执行层——二者概念不同，混在一起会让"立项"标签语义混淆。
- **影响**：业务链"立项 OGSM"标签实际显示的是战略目标而非业务项目，与漏斗首段"立项"口径不一致。
- **修复方案**：phase=project 应优先调用 `api.business.listProjects()`，OGSM 目标作为关联字段展示。
- **关联目标**：G3、G6

---

### 模块 3：OGSM

#### GM-05 | P1 | OGSM 指标进度完全依赖人工录入，无与真实业务数据的联动机制
- **位置**：`server/src/services/ogsmService.ts:216–237`（updateGoalProgress 方法）
- **证据**：
  - OGSM Goal 的 `current_value` 只能通过 `PUT /ogsm/goals/:id/progress` 手动传入（行216–237，`updateGoalProgress(id, currentValue)` 接收前端手动数值）。
  - 无任何后台任务、定时器或事件钩子从 `orders`、`projects`、`employees` 等真实业务表自动拉取数据填充目标进度。
  - `getObjectProgress`（行402–431）、`getOGSMStats`（行475–547）全部基于人工录入的 `current_value` / `target_value` 计算，不与 `analyticsService` 的真实 GMV/毛利/转化数据关联。
- **影响**：OGSM 与实际经营数据完全割裂——老板在 OGSM 看板看到的目标完成率来自人工填数，无法证明目标真的达成了。
- **修复方案**：
  - 提供"指标→数据源"映射配置（如目标"本月 GMV"自动关联 `analyticsService.getOverview` 的 gmv 指标）
  - 增加定时任务在周期结束时自动拉取真实指标更新目标进度，人工录入仅做修正
- **关联目标**：G1、G3

#### GM-06 | P2 | OGSM 统计指标 `objectives.inProgress` 与 `objectives.active` 数值重复（逻辑 bug）
- **位置**：`server/src/services/ogsmService.ts:537`
- **证据**：
  ```ts
  objectives: { total, active: objMap.active || 0, completed: objMap.completed || 0,
    inProgress: objMap.active || 0,   // ← 与 active 相同！
    cancelled: objMap.cancelled || 0 }
  ```
  `inProgress` 取的是 `objMap.active`（行537），但 object_status 枚举中 `active` 与 `in_progress` 是不同状态。
- **影响**：看板"进行中目标数"与"活跃目标数"永远相等，前端进度条 `obj.inProgress / obj.active * 100`（`OGSMBoard.tsx:229`）恒为 100%，失去信息量。
- **修复方案**：`inProgress: objMap.in_progress || objMap.inProgress || 0`，从 GROUP BY status 结果中取真正的 in_progress 计数。
- **关联目标**：G6

---

### 模块 4：驾驶舱（BusinessCockpit）

#### GM-07 | P1 | 驾驶舱毛利/营收口径与 analyticsService 存在细微但不一致的差异（退款口径）
- **位置**：
  - 驾驶舱：`server/src/services/cockpitService.ts:108–140`，`server/src/utils/orderMetrics.ts`（revenueOf）
  - 分析：`server/src/services/analyticsService.ts:13–14`、`1497–1515`（countsTowardRevenue / revenueOf）
- **证据**：
  - 驾驶舱本月毛利 SQL（行110–117）：`payment_status IN ('paid', 'partial', 'refunded')`——**包含 refunded**
  - analyticsService 口径（行1497–1501）：`countsTowardRevenue` 同样包含 `'refunded'`
  - 但 `getKpiCards` 的今日 GMV（行98–106）明确 `payment_status NOT IN ('refunded')` **排除了 refunded**，而行162 用了 fallback：paid_amount 为 0 时取 total_amount
  - 两者对 refunded 订单的营收贡献处理不同（今日 GMV 排除 vs 月度毛利计入），会造成"今日 GMV 合计 ≠ 本月 GMV 当月部分"的歧义
- **影响**：老板同时看"今日 GMV"和"本月毛利"时，退款订单的归属口径不一致，数字可能对不上。
- **修复方案**：统一约定 GMV 是否含退款（建议 GMV 不含、净 GMV = GMV − 退款单独字段），在 cockpit 和 analytics 同时修正并在 `orderMetrics.ts` 单一函数定义。
- **关联目标**：G6

#### GM-08 | P2 | 驾驶舱 Top5 异常的"员工离职风险"板块硬编码空占位，且该空占位会永久存在
- **位置**：`server/src/services/cockpitService.ts:348–355`
- **证据**：
  ```ts
  const turnoverRisk: TopAbnormalGroup = {
    id: 'turnover', label: '员工离职风险',
    empty: true, reason: '暂无 HR 离职风险模型数据，需在 HR 模块补充任职时长/绩效/调薪记录后再启用',
    items: [],
  };
  ```
- **影响**：当前 HR 模块有 `performance_reviews`（含 hire_date、score）——已具备离职风险的基础数据，但驾驶舱并未尝试读取，仅固定标记 empty。该模块应尽快激活或明确下线时间。
- **修复方案**：HR 模块已有 hireDate、score、salaryBase，可用 `(hireDate距今 < 6月 && score < 60)` 等规则计算离职风险 Top 5，激活该板块；或标注下线。
- **关联目标**：G3、G6

---

### 模块 5：业务服务（businessService）核心缺陷

#### GM-09 | P0 | updateProduct 方法缺少 tenant_id 隔离，存在跨租户串改风险（安全）
- **位置**：`server/src/services/businessService.ts:240–280`
- **证据**：
  - 查询现有（行242–244）：`SELECT ... WHERE id = ? AND tenant_id = ?` ✅ 有 tenant 校验
  - 但更新语句（行276–278）：`UPDATE products SET ... WHERE id = ?` **仅用 id，没有 tenant_id 条件**
  - 对比 `updateProductStatus`（行224 `WHERE id = ? AND tenant_id = ?`）✅、`updateOrderStatus`（行460）✅，`updateProduct` 是唯一一处漏写 tenant 的更新方法。
- **影响**：若存在 id 碰撞（UUID 虽概率极低，但若租户间 id 被伪造），其他租户可通过产品 id 修改非本租户商品信息，造成数据串改——G6 级安全缺陷。
- **修复方案**：`db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...values, tenantId);`
- **关联目标**：G6

#### GM-10 | P1 | listTickets 查询 WHERE 中包含不存在的 `t.title` 列，可能导致查询异常
- **位置**：`server/src/services/businessService.ts:789–808`
- **证据**：
  - 行793–795：`WHERE ... t.title LIKE @kw ...`
  - 但 `service_tickets` 表实际建表列（参见 createTicket，行772–778）包含 `subject` 字段，**没有 `title` 列**
  - `t.description` 存在（行777）
- **影响**：任何带 keyword 的 `listTickets` 查询都会因为 `t.title` 列不存在而报 SQL 错误；不带 keyword 时不会触发，造成"部分可用"的隐蔽问题。
- **修复方案**：将 `t.title` 改为 `t.subject`（行794）。
- **关联目标**：G6

#### GM-11 | P1 | calcAssortmentStats 用固定 65% 成本率估算毛利，与 products.cost_price 真实成本口径不一致
- **位置**：`server/src/services/businessService.ts:572–581`
- **证据**：
  ```ts
  totalCost += p.quantity * (p.unitPrice * 0.65); // estimated cost rate
  ```
  组盘的毛利/总值计算用 `unitPrice * 0.65` 虚构成本率，而非从 `products.cost_price` 读取真实成本。
- **影响**：组盘毛利（grossMargin）与实际毛利率不一致；与 cockpitService 用 `cost_price` 计算的毛利口径冲突（GM-07 同类问题）。
- **修复方案**：通过 productId 反查 `products.cost_price` 计算真实成本；或在 calcStockStatus 查询处一并读取成本价。
- **关联目标**：G6

#### GM-12 | P2 | businessService.ts 第 755–766 行存在死代码（previewAssortment 方法体内的重复代码块）
- **位置**：`server/src/services/businessService.ts:738–766`
- **证据**：
  - `previewAssortment` 方法体在行738–754 已通过 `a.products.map(...)` 生成 items 并返回 `return { ...a, items }`（行753–754）
  - 行755–766 是**完全相同的 products.map 代码片段 + 另一处 return**（`return { ...this._toPlainAssortment(a), items }`），位于方法体外、class 末尾，形如粘贴残留；`_toPlainAssortment` 在 class 中未定义。
- **影响**：TypeScript 编译会报 `_toPlainAssortment` 未定义错误（若该行被执行）；即使不可达，也说明代码质量/整洁性问题，易在未来维护时引发误读。
- **修复方案**：删除第 755–766 行死代码。
- **关联目标**：G6

---

### 模块 6：HR / 人效

#### GM-13 | P1 | `efficiency_metrics` 表无写入方，`getEfficiencyMetrics` 与 `computeEfficiencyMetrics` 口径不统一
- **位置**：
  - `server/src/services/hrService.ts:554–612`
  - `server/src/services/analyticsService.ts:929`（getEmployeeEfficiency）
- **证据**：
  - `computeEfficiencyMetrics`（行575–612）只做计算、**不调用 INSERT 写入** `efficiency_metrics` 表
  - `getEfficiencyMetrics`（行554–573）先查 `efficiency_metrics`，查不到就调用 `computeEfficiencyMetrics` 重新计算——但计算结果**仍不入库**
  - `analyticsService.getEmployeeEfficiency`（analyticsService.ts:929–932）注释写明数据源为 `performance_attributions` 表，"由库存预警/归因计算任务写入"——但该**归因写入方在审计范围内未找到**（inventoryService.ts 需进一步核查）
  - `computeEfficiencyMetrics` 的 GMV 口径 = `SUM(total_amount)`（行583–586，取所有订单含 unpaid），与 cockpit / analytics 用 `paid_amount` 的 GMV 口径**不一致**
- **影响**：
  1. `efficiency_metrics` 表存在但永远为空，是"无真实写入方的表"
  2. 人效 GMV 口径含 unpaid 订单，与驾驶舱/分析中的已支付 GMV 不符，数字对不上
  3. 人效分析依赖的 `performance_attributions` 归因写入方缺失，人效分析恒为 empty
- **修复方案**：
  - `computeEfficiencyMetrics` 计算后 INSERT 写入 `efficiency_metrics`（带 ON CONFLICT）
  - 人效 GMV 改用 `paid_amount` 口径（或取 payment_status IN paid/partial），与 cockpit 统一
  - 补充 performance_attributions 的写入触发逻辑（订单创建/状态变更时触发）
- **关联目标**：G1、G3、G6

#### GM-14 | P2 | HR 计算个税时把月度工资 `× 12` 按年应税所得处理（calculateTax 方法逻辑存疑）
- **位置**：`server/src/services/hrService.ts:532–550`
- **证据**：
  ```ts
  private calculateTax(taxableIncome: number): number {
    const annual = taxableIncome * 12;       // 行543
    for (const bracket of brackets) { ... }  // 使用年度累进税率表
    return Math.max(0, (annual * bracket.rate - bracket.deduction) / 12);
  }
  ```
  `calculatePayroll`（行280）传入的 `taxableIncome` 已是月度计算结果（行338 `grossSalary - finalDeductions - 5000`），但该函数再 `× 12` 套年度税率表后 `/ 12` 还原月度。
- **影响**：年度税率表中的 deductions 是年度累计减免额（如 36000 以下 3%、年度 0 减免），对月收入直接套用存在计算逻辑偏差；且 `taxableIncome` 可能为负（低收入员工），`Math.max(0, ...)` 虽然兜底，但负数 × 12 后再计算无意义。
- **修复方案**：改用月度 7 级累进税率表（年度表 ÷ 12 后的月度化版本），或用更精确的年度累计预扣法。
- **关联目标**：G6

---

### 模块 7：BusinessChain 收款/结清链路

#### GM-15 | P2 | BusinessChain 前端收款登记仅支持手动填写金额，与后端 recordPayment 的"自动推导 payment_status"存在交互风险
- **位置**：`src/views/Modules/BusinessChain.tsx:217–243`（handleRecordPayment）、`762–815`（收款面板）
- **证据**：
  - 前端"结清"按钮（行800–804）直接计算 `rest = total_amount - paid_amount` 填入金额框后触发登记
  - 但后端 `recordPayment`（businessService.ts:511–516）对 `nextPaid === 0` 判定为 refunded（行511–512），对全额为 paid（行513–514）
  - 前端未展示"结清后 payment_status 自动变为 paid"的提示；用户在部分付款后点"结清"时可能因浮点舍入导致 `nextPaid !== total`，payment_status 停在 partial
- **影响**：用户可能以为已结清，但实际 payment_status 为 partial，导致该订单在驾驶舱/分析中被遗漏（G6）。
- **修复方案**：后端 `recordPayment` 对 `nextPaid >= total * 0.99` 做 tolerance 容差自动提升为 paid；前端在结清成功后刷新订单展示 payment_status 确认。
- **关联目标**：G1、G6

---

## 三、评分汇总

| 模块 | P0 | P1 | P2 | 关键结论 |
|------|:--:|:--:|:--:|----------|
| 增长引擎 GrowthEngine | 2 | 0 | 0 | 假数据 + 前端无入口，判 0 分 |
| 业务链 BusinessChain | 1 | 1 | 0 | 链路指标全硬编码；立项口径混淆 |
| OGSM | 0 | 1 | 1 | 数据仅人工录入，与业务脱钩 |
| 驾驶舱 Cockpit | 0 | 1 | 1 | 退款口径差异；离职风险未激活 |
| 业务服务 businessService | 1 | 2 | 1 | 跨租户安全 + 死代码 + 成本估算不统一 |
| HR / 人效 | 0 | 1 | 1 | 无写入方 + 人效口径含 unpaid + 个税存疑 |
| **合计** | **4** | **6** | **4** | |

## 四、修复优先级建议

1. **立即（本周）**：GM-09（跨租户安全漏洞）→ 这是 P0 安全缺陷，必须优先修复。
2. **立即（本周）**：GM-03、GM-01（硬编码假数据）→ 直接误导经营判断，老板看到的全是假数字。
3. **高优（2 周内）**：GM-02（前端接入 campaigns/ad_spend/reviews）→ 后端已就绪，只需前端接入，收益最大。
4. **高优（2 周内）**：GM-10（listTickets SQL 列错误）→ 修一行代码，解决工单搜索不可用。
5. **中优（1 个月）**：GM-05（OGSM 与业务数据联动）、GM-13（人效写入 + 口径统一）→ 需要跨模块设计，排期推进。
6. **低优（后续）**：GM-06（OGSM inProgress bug）、GM-07（退款口径统一）、GM-11（组盘毛利估算）、GM-12（死代码）、GM-14（个税）、GM-15（结清容差）、GM-04（立项标签口径）。
