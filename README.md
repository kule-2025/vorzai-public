# Vorzai v0.2.81

> 面向电商企业的人力资源管理与业务解决方案桌面应用

## 下载安装

### Windows

点击下方链接下载安装包：

**[Vorzai Setup 0.2.81.exe](https://github.com/kule-2025/vorzai-public/releases/download/v0.2.81/Vorzai-Setup-0.2.81.exe)**

- 文件大小：约 90 MB
- 系统要求：Windows 10/11 (x64)
- 安装方式：双击运行，按向导完成安装

### 国内镜像（Gitee）

如果 GitHub 下载速度较慢，应用内自动更新会通过 Gitee raw 通道获取 `latest.yml` 更新元数据：

- Gitee raw 通道：`https://gitee.com/king2030/vorzai/raw/main/latest.yml`
- 该通道仅提供更新元数据（版本号、sha512、下载地址），实际安装包仍从 GitHub Release 下载
- 应用启动时会自动检查更新，无需手动操作

### 下载失败解决方案

如果下载到 80MB 左右中断，请尝试以下方法：

**方法 1：使用下载工具（推荐）**
- 使用 [IDM](https://www.internetdownloadmanager.com/)、[Free Download Manager](https://www.freedownloadmanager.org/) 或 [aria2](https://aria2.github.io/) 等下载工具
- 这些工具支持断点续传，即使中断也能从断点继续

**方法 2：浏览器重试**
- Chrome/Edge：按 `Ctrl+J` 打开下载页，点击失败的任务选择"继续下载"
- 或使用无痕模式重新下载

**方法 3：命令行下载**
```bash
# 使用 curl（支持断点续传）
curl -L -C - -o Vorzai-Setup-0.2.81.exe "https://github.com/kule-2025/vorzai-public/releases/download/v0.2.81/Vorzai-Setup-0.2.81.exe"

# 或使用 wget
wget -c "https://github.com/kule-2025/vorzai-public/releases/download/v0.2.81/Vorzai-Setup-0.2.81.exe"
```

**方法 4：GitHub 加速镜像**
- 使用 [ghproxy.com](https://ghproxy.com/) 或 [gitclone.com](https://gitclone.com/) 等加速服务
- 将下载链接中的 `github.com` 替换为加速域名

## 自动更新说明

Vorzai 内置双源自动更新机制：

1. **主源（GitHub）**：应用启动时检查 GitHub Release 的 `latest.yml`，获取最新版本信息
2. **回退源（Gitee）**：当 GitHub 访问超时时，自动切换到 Gitee raw 通道获取 `latest.yml`
3. **灰度发布**：更新按设备分桶逐步放量，`stagingPercentage=100` 表示全量发布
4. **完整性校验**：安装包通过 sha512 校验，确保下载内容未被篡改
5. **手动检查**：在应用内「设置 → 检查更新」可手动触发更新检测

## 功能概览

Vorzai 是一款专为电商企业设计的智能桌面助手，覆盖以下核心能力：

**业务管理** — 立项 → 选品 → 组盘 → 订单 → 客服 → 结算，完整电商业务链闭环

**人力资源** — 员工管理、考勤记录、绩效评估、薪酬计算、人效分析

**目标管理** — OGSM 目标分解（目标→指标→策略→度量）、RACI 责任人矩阵、激励机制

**知识管理** — 企业知识库、专属技能中心、对话式工作流

**连接器** — 预留钉钉、飞书、企业邮箱对接接口

**安全机制** — JWT 认证、RBAC 权限控制、多租户数据隔离

**直播电商** — 直播会话管理、主播管理、商品库、回放分析（6 Tab / 21 API / 4 表）

**跨境电商** — 跨境业务全流程管理（10 Tab / 15 API / 2 表）

**平台对接** — 多平台数据接入与同步（7 Tab / 21 API / 3 表）

**对话工作流** — 可视化工作流编排与执行（5 Tab / 22 API / 4 表）

## 默认账号

首次启动时系统会自动初始化演示数据，可用以下账号登录：

| 用户名 | 密码 | 角色 |
|--------|------|------|
| admin | admin123 | 超级管理员 |
| manager | admin123 | 部门经理 |
| member | admin123 | 普通成员 |

> ⚠️ 请在生产环境中及时修改默认密码

## 技术栈

- **桌面框架**：Electron 33
- **前端**：React 18 + TypeScript + Vite + Zustand
- **后端**：Express + better-sqlite3（嵌入式数据库）
- **认证**：JWT Token + RBAC 五级权限
- **数据**：SQLite（嵌入式，数据本地化，离线可用）
- **规模**：196 张数据表，1,017 个 API 端点，30 个导航项，89 个子功能

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.2.81 | 2026-09-17 | 数据库完整性保护机制5项（外键约束/事务原子性/写入前校验/崩溃恢复/定期一致性巡检）+全量bug修复27处+功能增强4项+性能优化4方向（查询优化/缓存策略/批量操作/资源释放） |
| v0.2.80 | 2026-09-17 | 容错与断点恢复机制全链路落地：新增task_checkpoints表(租户隔离)+9个断点管理API+前端useCheckpoint Hook+TaskResumeCard恢复组件+AI智能页面集成(分析3步/报告2步断点)+瞬时错误自动重试(3次指数退避)+老库v7→v8迁移。断点API端到端11项测试全部通过，故障后从断点续跑无需重跑全流程 |
| v0.2.79 | 2026-09-17 | 全量代码审查205项问题+25项关键修复：认证绕过修复(refresh token不可当access token)、SSE Token泄露修复(token从URL移至Authorization头)、财务洞察8张卡404修复(补齐端点别名)、HRMS 44处空catch补toast、支付回调不更新订单修复、主按钮恢复品牌橙#f08a14、5个财务动作端点补全、响应格式统一、认证请求45s缓存、键盘无障碍焦点环。功能验证1213端点枚举427 GET通过零5xx。UI/UX评分62→优化后组件系统统一 |
| v0.2.78 | 2026-09-17 | HR智能页面永久loading死锁修复+AI智能重新分析无反馈修复+全量代码扫描6项修复：HRStrategy.tsx useState(true)死锁改为false+10s超时兜底+4子视图15s超时；HRAIIntelligenceCenter补catch块+分级错误处理(网络/权限/404/500)+0条洞察友好引导+20s超时+按钮disabled防重复；EmployeeProfileManager空catch补toast；ConnectorsMarket补try/catch+loading+空状态；client.ts importData路径修正；OGSMBoard/CrossBorderHub/PlatformHub三处useEffect加卸载清理。自上而下验证95/95项通过 |
| v0.2.77 | 2026-09-17 | 安全审计16项风险全量修复（15项代码修复+1项已知项）：生产CSP移除unsafe-inline、工作流条件测试new Function()加白名单、字段加密独立密钥文件(不再回退JWT)、备份列表租户隔离、密码重置令牌5分钟一次性、4个脚本硬编码凭证清理、demo路由参数化SQL、备份加密CBC→GCM(向后兼容)、bcrypt 10→12轮、app:getPath白名单、支付回调防重放+审计日志 |
| v0.2.76 | 2026-09-17 | 六大问题全面修复+功能增强：自动更新404修复(Gitee仅拉元数据安装包走GitHub)、平台对接页x.map崩溃修复(unwrapArray+19处数组守卫)、对话式工作流按钮无响应修复(对话阶段隐藏概览+自动滚动)、全局5个无onClick按钮修复、新建商品AI辅助填充(复用/api/llm/chat无硬编码key)、采购供应链新增新建采购单表单+删除接口、登录持久化+数据隔离验证正常 |
| v0.2.75 | 2026-09-16 | 登录失效根因全量修复+22项bug排查修复+安全加固：token过期2h→7d/30d→90d、refreshToken硬编码bug修复、启动静默刷新+请求前预刷新+互斥锁防并发、记住密码+邮箱持久化(base64混淆)、登录失效醒目banner；后端修复严重SQL注入(导出表名白名单)、租户隔离漏洞(跨租户写消息)、scopeQuery死代码WHERE AND、7处error信封不一致；前端修复TenantEnhancePanel 5处写操作未检查success静默失败；Electron修复preload writeFile丢参/auto-updater状态恒真/IPC通道断链/无双实例锁/图标路径错误 |
| v0.2.74 | 2026-09-16 | P0/P1全量修复+性能优化+功能增强+安装包体积大幅缩减：后端errorHandler唯一键冲突映射409、normalizeBindParams统一undefined→null兜底、llm路由asyncHandler补全；前端BusinessChain 23项类型错误修复、ApiOpenPlatform可选链修复；全局Toast机制修复(87处静默调用生效)+97处alert统一替换；ErrorBoundary补齐返回首页/复制错误；API客户端403/5xx友好文案；移动端侧边栏阻断性修复；electron-builder白名单化(安装包330MB→约90MB，排除525MB开发垃圾+未使用原生模块)；settingsService配置内存缓存+批量事务；token.txt安全清理 |
| v0.2.72 | 2026-09-15 | 七阶段系统性梳理成果落地+三大巨型组件拆分+P0性能监控+14项Bug修复
| v0.2.71 | 2026-09-14 | 版本号统一管理+数据备份全链路+电商HR场景模板+开发者平台隔离+连接器约束修复：version.ts多路径探测版本号、redeploy.py复制根package.json修复app.asar版本滞后；备份API路由(/api/backup/create/list/restore)+BackupManager UI集成Settings+自动定时备份(每天/保留30天)；EcommerceHRTemplates(大促排班+计件薪酬)集成HRMS；开发者超管后台admin+isDevMachine双重防护；connectors表CHECK约束5→26种+schema v2→v3迁移；API路径常量统一(apiPaths.ts)；BUG防护文档建立 |
| v0.2.66 | 2026-09-10 | 电商HR洞察场景端到端全量验证+全量功能修复：55个API节点100%通过、10个CDP页面100%正常渲染、零服务端500错误；5条业务流全部跑通（HR核心流/电商闭环流/业绩倍增流/直播运营流/智能工作流流）；修复KPI方案创建需含indicators关联、薪酬字段名下划线命名(employee_id/employee_name)、订单items需unitPrice、售后returnItems需unitPrice、直播场次plannedStart字段、售后收货需order_id存在、记忆上下文字段名key/value等参数对齐问题；采购入库receipts格式、订单状态机4态流转、售后状态机3态流转、库存自动联动(采购入库+售后回补)全部验证通过 |
| v0.2.64 | 2026-09-08 | 全量mock数据清理+通用CSV导入框架+15处假导入修复+Analytics统计修复+后端13模块注册：移除生产代码中所有mock演示数据（WebhookManager/DataIntegrationCenter/ApiOpenPlatform/OKRManager），新增src/utils/csvImport.ts通用CSV导入工具（BOM/引号/逗号转义/字段映射/unwrap解包），修复15个模块假导入功能（显示成功但未实际导入）为真实CSV解析+API调用，后端POST /api/import补充13个HR模块配置（analytics_reports/compensatory_leaves/doubling_labs/hr_office_automation/hr_risks/hr_kanban_tasks/hr_reports/incentive_plans/raci_matrix/efficiency_records/pilot_projects/payroll_records/hr_three_pillars），Analytics 3个统计字段（realtime/dashboardCount/chartCount）从硬编码0改为从报表列表实时计算 |
| v0.2.62 | 2026-09-05 | 超管端Repository抽象层+全量架构治理+TenantAdminService迁移：超管端6文件编码（IAdminRepository/SQLiteAdminRepository/HttpAdminRepository/AdminService/admin路由/AdminConsole前端），AdminService零SQL零db引用，未来SQLite→HTTP迁移业务层零改动；全量功能架构梳理v1-v3（28前端路由/66后端路由/217表/208组件/84 Service），S/H/M/L级问题全量修复；P0断点修复（RiskManagement响应格式8端点、FinanceHub 4端点、paymentNotifyHandler挂载、LiveCommerce 10内联SQL迁移Service）；TenantAdminService全量重写+16端点迁移（camelCase接口+软删除+增强保护+使用量计算），20方法18被路由调用无死代码；会员定价调整Team¥999/Enterprise¥5200起；全项目综合健康度5星 |
| v0.2.61 | 2026-09-04 | 白屏根因修复+会员体系重构+9项bug全量修复：修复updater误杀渲染进程导致白屏（hasPendingUpdates添加版本检查、cleanupOldVersionProcesses添加父进程PID检查）；会员体系重构为4档定价（Free/Pro¥299/Team¥1299/Enterprise¥6800起），移除API额度/存储配额/数量限制；修复ConversionHub语法错误、SkillCenter .filter错误、多租户旧档位残留等9项bug |
| v0.2.60 | 2026-09-03 | P0-P3功能修复+租户计费模块+API响应格式统一+CI路由检查集成：28文件修复，生产环境30页面测试通过，租户计费表+支付网关manual模式，财务洞察真实数据接入12个端点 |
| v0.2.59 | 2026-09-02 | P1批次五模块根端联调验证：制度管理（方案场景/状态机）、员工/考勤记录、KPI指标库/方案/结果三级闭环、绩效→调薪数据联动、HR-AI对话报告与洞察预测、薪酬重算与调薪建议提交；修复SQLite严格模式IFNULL双引号、跨模块状态枚举对齐、hydrate统计字段camelCase映射；全链路E2E 80断言+10表落库核验通过 |
| v0.2.58 | 2026-09-01 | 功能完善100%：30个导航项全部完成，89个子功能全部实现；新增4个模块（直播电商6Tab/21API/4表、跨境电商10Tab/15API/2表、平台对接7Tab/21API/3表、对话工作流5Tab/22API/4表）；性能优化（构建时间-30.5%，产物体积-47.6%）；数据库196张表，1,017个API端点；前后端tsc零错误；渲染异常全面修复；对话框图标补齐；桌面Logo替换 |
| v0.2.57 | 2026-08-30 | 性能优化专项：超大型组件拆分（ProcurementHub等10文件重构，+360/-903行）、N+1查询优化、内联函数优化减少重渲染、useCallback导入补全、authMiddleware别名兼容、语法错误修复 |
| v0.2.55 | 2026-08-29 | 全量模拟数据替换升级，7个核心业务模块完成后端API对接、OGSM归因功能完善（getAttribution/runAutoAttribution）、TypeScript类型系统全面对齐、双源部署方法论最高执行规则落地 |
| v0.2.54 | 2026-08-29 | 全量模拟数据替换升级，17个核心业务模块完成后端API对接（增长引擎、转化与运营、工作流编排、数据分析、薪酬计算、任务看板、调休管理、倍增实验室、HR效率、HR激励、HR试点、全员OA、RACI矩阵、HR报告中心、风险预警、三支柱、OGSM目标树）、OGSM归因功能完善、TypeScript类型系统全面对齐 |
| v0.2.50 | 2026-08-28 | 重大更新：HR管理左侧垂直导航栏重构（6大分组35子功能）、对话框样式完全对齐workbuddy、应用内自动更新超时修复（双源快速超时+检查中状态）、企业用户权限分配对齐钉钉（5级角色22功能模块+4级数据权限）、全面渲染异常修复（toLocaleString+map遍历共102文件） |
| v0.2.4 | 2026-08-06 | 跨职能调试修复：直播库存扣减逻辑bug、事务完整性、审计日志、数据过滤优化 |
| v0.2.3 | 2026-08-05 | 评审报告 B1-B8 缺陷修复闭环：server strict 加固、跨租户泄漏修复、前端a11y、覆盖率门禁 |
| v0.2.0 | 2026-07-30 | 商业化升级：许可证系统、订阅管理、试用期、配额追踪、设备绑定、审计日志、暴力破解防护 |
| v0.1.2 | 2026-07-30 | 修复空白页面：Vite base路径、CSP字体域、后端服务容错 |
| v0.1.1 | 2026-07-29 | 安全修复：租户隔离增强、订单状态机完善、RACI/薪酬UPSERT修复、Token刷新循环修复 |
| v0.1.0 | 2026-07-29 | 首个正式版本，全栈实现 |

## 反馈与支持

- 问题反馈：[GitHub Issues](https://github.com/kule-2025/vorzai-public/issues)
- 邮箱：king2030@foxmail.com

## License

Proprietary — © 2026 Vorzai Team. All rights reserved.
