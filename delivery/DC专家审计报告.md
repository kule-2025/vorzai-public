# 中国电商运营专家 · 审计报告

**审计时间**：2026-07-31
**审计方法**：基于当前代码取证，每条问题附文件:行号证据
**关联业务目标**：G1=转化率, G3=运营效率, G6=系统健壮性

---

## 一、总体结论

国内运营域覆盖了商品、订单、库存、售后、大促、投流、评价等核心模块，后端基本完备。`businessService.ts`（1310+ 行）+ `business.ts`（543+ 行路由）+ 前端 11 个视图模块构成了完整的运营工作流。

**最严重的发现**：P1 阶段交付的三大新模块（大促活动 campaigns、投流记录 ad_spend、商品评价 product_reviews）后端 CRUD 三件套齐全，但**前端零入口**——这是典型的"后端修了前端没接"，按评测标准判 0 分。此外，`updateProduct` 缺少 `tenant_id` 隔离（与 DA-01/GM-09 交叉印证），是 P0 级安全漏洞。

---

## 二、缺陷清单

---

### 模块 1：大促活动管理

#### DC-01 | P0 | 后端 campaigns 三件套齐全，前端零入口（判 0 分）

- **位置**：
  - 后端（有）：`server/src/services/businessService.ts:1054-1156`（createCampaign/listCampaigns/updateCampaign/deleteCampaign + addProductToCampaign/removeProductFromCampaign）
  - 路由（有）：`server/src/routes/business.ts:389-420`（5 个端点）
  - API Client（有）：`src/api/client.ts:240-244`（createCampaign/listCampaigns/updateCampaign/deleteCampaign）
  - **前端（无）**：`src/views/Modules/GrowthEngine.tsx` 中 campaigns Tab 的 `campaigns` 数据来自 `cockpit.getOverview()` 的业务线切片（行 66-78），而非 `api.business.listCampaigns()`
- **证据**：`grep -rn "listCampaigns\|createCampaign" src/views/ --include="*.tsx"` 返回 **0 结果**。GrowthEngine 中唯一与"活动"相关的代码是 `api.business.createAssortment`（行 154，组盘而非活动）和 `modules/growth-engine/index.ts` 中的内存假数据 `campaigns[]`（行 44-65）。
- **影响**：大促活动管理功能不可用，运营无法创建/编辑/删除活动，ROI 分析缺失。
- **建议**：GrowthEngine 的"业务线分析"Tab 接入 `api.business.listCampaigns()` 替换假数据；新增"活动管理"Tab，包含活动列表/创建/编辑/删除。
- **关联目标**：G1, G3

#### DC-02 | P1 | GrowthEngine 用 cockpit 业务线硬拼虚构活动数据

- **位置**：`src/views/Modules/GrowthEngine.tsx:58-88`
- **证据**：
  ```typescript
  // 用 cockpit 业务线切片 map 成 GrowthCampaign
  campaigns: bizLines.map((line) => ({
    name: line.name,
    budget: 0,          // 虚构
    spent: 0,           // 虚构
    roi: line.gmv > 0 ? (line.gmv / Math.max(line.gmv * 0.3, 1)) : 0,  // ×0.3 系数虚构投放金额
    revenue: line.gmv,  // 复用 GMV 代替活动收入
    ...
  }))
  ```
  ROI 计算公式 `gmv / (gmv * 0.3)` 本质上是 `1/0.3 = 3.33x` 的固定值，完全脱离真实投流数据。
- **影响**：GrowthEngine 展示的 ROI、预算、花费全是假数据，运营基于错误数据做决策。
- **建议**：删除 `bizLines.map()` 拼假活动的逻辑，改用 `api.business.listAdSpend()` + `getAdSpendSummary()` 加载真实投流数据计算 ROI。
- **关联目标**：G1

---

### 模块 2：投流记录管理

#### DC-03 | P0 | 后端 ad_spend 三件套齐全，前端零入口（判 0 分）

- **位置**：
  - 后端（有）：`server/src/services/businessService.ts:1158-1237`（createAdSpend/listAdSpend/getAdSpendSummary）
  - 路由（有）：`server/src/routes/business.ts:420-455`（3 个端点）
  - API Client（有）：`src/api/client.ts:253-258`（createAdSpend/listAdSpend/getAdSpendSummary）
  - **前端（无）**：`grep -rn "listAdSpend\|createAdSpend\|getAdSpendSummary" src/views/ --include="*.tsx"` 返回 **0 结果**
- **证据**：投流记录 CRUD 在后端和 API Client 均已就绪，但没有任何前端页面调用这些接口。
- **影响**：投流成本、ROI、平台投放效果完全不可见。
- **建议**：GrowthEngine 新增"投流管理"Tab，接入 `api.business.listAdSpend()` + `getAdSpendSummary()`，支持创建/编辑投流记录、按平台/日期筛选、ROI 趋势图。
- **关联目标**：G1, G3

---

### 模块 3：商品评价/DSR

#### DC-04 | P0 | 后端 product_reviews 三件套齐全，前端零入口（判 0 分）

- **位置**：
  - 后端（有）：`server/src/services/businessService.ts:1239-1310`（createReview/listReviews/approveReview/replyToReview/getProductReviewStats）
  - 路由（有）：`server/src/routes/business.ts:455-490`（4 个端点）
  - API Client（有）：`src/api/client.ts:261-268`（createReview/listReviews/approveReview/replyToReview/getProductReviewStats）
  - **前端（无）**：`grep -rn "createReview\|listReviews\|getProductReviewStats\|product_review" src/views/ --include="*.tsx"` 返回 **0 结果**
- **证据**：评价 CRUD 在后端和 API Client 均已就绪，前端无任何入口。
- **影响**：商品评分、DSR 数据完全不可见，运营无法管理评价。
- **建议**：BusinessChain 的"订单"阶段新增"评价管理"入口，接入 `api.business.listReviews()` + `getProductReviewStats()`；或新增独立评价管理页面。
- **关联目标**：G1, G3

---

### 模块 4：更新商品接口

#### DC-05 | P1 | `updateProduct` 方法无 tenant_id 隔离（与 DA-01/GM-09 交叉印证）

- **位置**：`server/src/services/businessService.ts:276-278`
- **证据**：
  ```typescript
  updateProduct(id: string, tenantId: string, data: UpdateProductInput): Record<string, unknown> {
    db.prepare(`UPDATE products SET ... WHERE id = ?`).run(id);
  }
  ```
  方法参数中有 `tenantId`，但 SQL 中仅用 `WHERE id = ?`，未加 `AND tenant_id = ?`。同文件 `updateProductStatus`（行 287）正确使用了 `tenant_id`。
- **影响**：任意租户可通过 `id` 修改任意租户的商品信息——跨租户数据篡改漏洞。
- **建议**：SQL 改为 `WHERE id = ? AND tenant_id = ?`，与 `updateProductStatus` 保持一致。
- **关联目标**：G6

---

### 模块 5：库存预警

#### DC-06 | P2 | 库存预警无主动推送机制，运营需手动查询

- **位置**：`server/src/services/inventoryService.ts`、`src/views/Modules/InventoryAlerts.tsx`
- **证据**：
  - `inventoryService.evaluate()` 触发规则评估，返回告警列表
  - 前端 InventoryAlerts 有"立即评估"按钮（行 380），运营需手动点击才触发
  - 无定时任务、无 WebSocket 推送、无通知机制
  - `notifications` 表存在但未被库存预警写入
- **影响**：库存断货/超卖等关键异常不会主动通知运营，可能导致缺货损失。
- **建议**：(1) 评估后若发现严重告警，自动写入 `notifications` 表；(2) 前端 Dashboard 顶部增加告警提示栏；(3) 考虑定时任务（如每 30 分钟自动评估）。
- **关联目标**：G1, G3

---

### 模块 6：售后管理

#### DC-07 | P2 | 售后工单 keyword 搜索因 `t.title` 列名错误完全失效（与 DA-03/GM-10 交叉印证）

- **位置**：`server/src/services/businessService.ts`，`listTickets` 方法中的 keyword LIKE 子句
- **证据**：
  - SQL 含 `t.title LIKE ?`，但 `service_tickets` 表无 `title` 列（正确列名为 `subject`）
  - 搜索含 keyword 的工单时必报 SQL 错误
- **影响**：售后工单列表按关键词搜索完全不可用。
- **建议**：将 `t.title` 改为 `t.subject`。
- **关联目标**：G1

---

## 三、功能完整性评分

| 模块 | 后端 | 路由 | 前端 | 数据写入 | 评分 |
|------|------|------|------|----------|------|
| 商品管理 | ✅ | ✅ | ✅ | ✅ | 90% |
| 订单管理 | ✅ | ✅ | ✅ | ✅ | 85% |
| 库存预警 | ✅ | ✅ | ✅ | ✅ | 80% |
| 售后工单 | ✅ | ✅ | ✅ | ⚠️ keyword 搜索失效 | 75% |
| 大促活动 | ✅ | ✅ | ❌ | ✅ | **0%** |
| 投流记录 | ✅ | ✅ | ❌ | ✅ | **0%** |
| 商品评价 | ✅ | ✅ | ❌ | ✅ | **0%** |
| CSV 导入 | ✅ | ✅ | ❌ | ✅ | **0%** |

**国内运营域总评：41%（含 4 个 0 分项拉低）**

---

## 四、改进建议（按优先级）

1. **立即（本周）**：DC-01/03/04 — 后端三件套已有，只需前端接入，收益最大
2. **立即（本周）**：DC-05 — `updateProduct` 加 `tenant_id`，安全漏洞必须优先修
3. **高优（2周内）**：DC-02 — GrowthEngine 停止用假数据，接入真实 API
4. **中优（1个月）**：DC-06 — 库存预警主动推送
5. **中优（1个月）**：DC-07 — 修 `t.title` → `t.subject`
6. **低优（后续）**：CSV 导入前端入口、售后工单改进

---

## 五、总结

国内运营域后端基础设施完备，但 P1 交付的 4 个新模块（大促/投流/评价/CSV）全部存在"后端有前端无"的问题，是当前最大的功能缺口。按评测标准，这 4 个模块评分为 0，直接拉低整体完成度。修复路径清晰：后端已就绪，只需前端接入，预期 2 周内可完成。此外 `updateProduct` 的 `tenant_id` 缺失是 P0 安全漏洞，须优先处理。
