# 直播电商教练 · 审计报告

**审计时间**：2026-07-31
**审计方法**：基于当前代码取证，每条问题附文件:行号证据
**关联业务目标**：G5=直播变现, G6=系统健壮性

---

## 一、总体结论

直播域是 VorZai 功能最丰富的模块之一，`livestreamService.ts` 单文件 2287 行，覆盖直播场次、脚本、选品排期、指标记录、合规检查、违禁词库、脚本生成等 30+ 个方法。前端 `LiveCommerce.tsx`（27 个 API 引用）真实接入 `@api/livestream`，所有数据来自后端。

核心问题集中在：(1) live_metrics 有写入方（recordMetric/batchImportMetrics）但无主动推送机制，(2) 违禁词库 69 条覆盖面与真实直播违禁词差距大，(3) live_scripts 脚本生成后不自动写入 live_reviews，(4) 脚本合规扫描 `checkScriptCompliance` 不入库，不保存历史合规记录。

---

## 二、缺陷清单

---

### 模块 1：直播指标（live_metrics）

#### LC-01 | P1 | live_metrics 有写入方但无自动采集机制，指标数据完全依赖手工录入

- **位置**：`server/src/services/livestreamService.ts:1505`（recordMetric）、`1552`（batchImportMetrics）
- **证据**：
  ```typescript
  recordMetric(tenantId: string, sessionId: string, data: MetricInput): LiveMetric {
    // INSERT INTO live_metrics ...
  }
  batchImportMetrics(tenantId: string, sessionId: string, list: MetricInput[]): { imported; failed; errors }
  ```
  后端有完整的写入接口，但没有任何自动采集机制（定时任务、WebSocket 推送、心跳上报等）。指标数据必须靠运营手工录入——开播前中后三个阶段的实时数据无法自动获取。
- **影响**：直播复盘依赖事后补录，时效性差，数据可信度低。大屏展示的实时指标全是空。
- **建议**：提供沙箱示例数据（seed data），运营开播前可一键导入标准指标模板；前端增加"导入指标模板"按钮；若未来支持自动化，在 `live_sessions` 表加 `status` 状态变更时触发指标采集任务。
- **关联目标**：G5

#### LC-02 | P2 | `checkScriptCompliance` 合规扫描结果不入库，无法追溯历史合规状态

- **位置**：`server/src/services/livestreamService.ts:1196`
- **证据**：
  ```typescript
  checkScriptCompliance(tenantId: string, sessionId: string): ComplianceReport {
    // 扫描脚本命中违禁词，返回 ComplianceReport，但不写数据库
  }
  ```
  合规检查结果仅作为内存对象返回，不写入任何表。`live_scripts` 表中无 `compliance_status`、`compliance_flags`、`compliance_checked_at` 等字段。
- **影响**：运营无法知道某场直播的脚本是否通过合规检查；无法追溯历史合规记录。
- **建议**：在 `live_scripts` 表新增 `compliance_status`（TEXT CHECK）、`compliance_flags`（TEXT）、`compliance_checked_at`（TEXT）字段；`checkScriptCompliance` 扫描后将结果写入。
- **关联目标**：G5

---

### 模块 2：违禁词库

#### LC-03 | P1 | 违禁词库仅 69 条，覆盖范围远小于主流直播平台

- **位置**：`server/src/services/livestreamService.ts:336-420`
- **证据**：
  ```typescript
  const COMPLIANCE_LEXICON: LexiconEntry[] = [
    // 类别 1：绝对化/极限用语（约 40 条）
    // 类别 2：医疗健康误导（约 15 条）
    // 类别 3：金融投资误导（约 7 条）
    // 类别 4：其他（约 7 条）
  ]
  ```
  实际 69 条，分类：绝对化用语 40+ 条、医疗/金融误导 22 条。对比抖音/快手平台违禁词库通常覆盖 500+ 条（含极限词、虚假承诺、绝对化比较、封建迷信、贬低他人等）。
- **影响**：脚本合规扫描大量漏报，运营可能基于"已通过"的脚本开播后被平台限流/封禁。
- **建议**：扩充违禁词库至 300+ 条，增加"虚假承诺""绝对化比较""贬低他人""封建迷信""政治敏感"等类别；支持运营后台手动添加自定义违禁词（新增 `custom_banned_words` 表）。
- **关联目标**：G5

---

### 模块 3：直播选品联动

#### LC-04 | P2 | 直播选品 `addProducts` 仅锁库存计数，不触发实际库存扣减

- **位置**：`server/src/services/livestreamService.ts:1277`
- **证据**：
  ```typescript
  addProducts(
    tenantId: string,
    sessionId: string,
    items: Array<{ productId: string; livePrice?: number; stockLocked?: number }>
  )
  ```
  `live_session_products` 表记录 `stockLocked` 字段，但 `products` 表的 `stock` 字段不会同步扣减。直播成交后库存扣减依赖 `platformService` 创建订单时的独立逻辑，与直播锁库存无联动。
- **影响**：直播锁库存与实际可售库存分离，运营可能超卖——已锁库存的商品在其他渠道仍可下单。
- **建议**：`addProducts` 时自动将 `stockLocked` 同步扣减 `products.stock`；直播结束后（status 变更为 completed/ended）自动释放锁库存。
- **关联目标**：G5

---

### 模块 4：直播脚本

#### LC-05 | P2 | `generateScript` 生成的脚本不自动写入 `live_scripts` 表

- **位置**：`server/src/services/livestreamService.ts:968`
- **证据**：
  ```typescript
  generateScript(tenantId: string, sessionId: string, options): LiveScript[] {
    // 返回生成的脚本数组，但不写入数据库
  }
  ```
  脚本生成接口返回内存数组，运营需手动调用 `upsertScript` 才能保存——两步操作容易遗漏，生成的脚本若不保存即丢失。
- **影响**：直播脚本生成→保存链路断裂，生成的脚本默认不持久化。
- **建议**：`generateScript` 内部调用 `upsertScript` 将生成的脚本自动写入数据库；前端"生成脚本"按钮调用后自动保存并刷新列表。
- **关联目标**：G5

---

## 三、功能完整性评分

| 模块 | 后端 | 路由 | 前端 | 数据写入 | 评分 |
|------|------|------|------|----------|------|
| 直播场次管理 | ✅ | ✅ (6端点) | ✅ | ✅ | 100% |
| 直播脚本管理 | ✅ | ✅ (5端点) | ✅ | ⚠️ 生成不自动入库 | 80% |
| 直播选品排期 | ✅ | ✅ (4端点) | ✅ | ⚠️ 锁库存不联动 | 80% |
| 直播指标记录 | ✅ | ✅ (4端点) | ✅ | ⚠️ 无自动采集 | 75% |
| 合规检查 | ✅ | ✅ (1端点) | ✅ | ❌ 不入库 | 60% |
| 违禁词库 | ✅ | ✅ (1端点) | ✅ | 内置库 | 60% |

**直播域总评：78%**

---

## 四、改进建议（按优先级）

1. **高优（2周内）**：LC-01 live_metrics 增加沙箱模板导入，解决"无数据"问题
2. **高优（2周内）**：LC-03 扩充违禁词库至 200+ 条
3. **中优（1个月）**：LC-02 合规扫描结果入库
4. **中优（1个月）**：LC-05 脚本生成自动保存
5. **低优（后续）**：LC-04 锁库存联动

---

## 五、总结

直播域功能密度最高，但"写入方"与"自动化"之间存在鸿沟：所有表都有写入接口，但指标/合规/脚本生成都是被动接口而非主动流程。开播前中后的完整工具链已搭建（场次→选品→脚本→指标→复盘），缺的是自动化采集和主动推送。违禁词库 69 条是明显短板，建议优先扩充。
