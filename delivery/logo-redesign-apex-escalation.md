# Vorzai Logo 重新设计：Apex Escalation（巅峰跃迁）

> 设计日期：2026-08-03 | 状态：已交付，可投入生产

---

## 一、设计概念

### 核心创意：「Apex Escalation」巅峰跃迁

一个**非字母形的抽象几何徽标**，由以下元素组成：

| 元素 | 形态 | 寓意 |
|------|------|------|
| **主峰（白色粗体 Λ）** | 两笔圆头粗线构成的锐利峰顶 | 业务攀升 / 工作台锻造价值 / 向上突破 |
| **次峰（浅琥珀色，错落右上）** | 较小的第二座峰 | 「业务倍增」/ 模块跃迁 / 多层级增长 |
| **峰顶宝石（浅琥珀菱形）** | 主峰尖端的旋转方块 | Agent 中枢 / 智能内核 / 锻造出的价值结晶 |
| **圆角方块底（琥珀渐变）** | 圆角半径 224/1024 ≈ 22% | 与 UI 卡片圆角一致；琥珀渐变 = 电商主色 |

### 为什么是「非字母形」

旧 logo 是紫色背景 + 白色「V」字。新设计：
1. **完全原创** — 不基于任何现有 logo 修改，从零构思的抽象几何
2. **商标显著性更强** — 字母 V 属于「弱商标」（仅描述首字母）；抽象双峰+宝石组合具有更高的固有显著性
3. **与 UI 色系对齐** — 旧 logo 用紫色（info/LLM 色），而项目实际 UI 主色是**琥珀金 #F59E0B**（电商主色）。新 logo 以琥珀为主调
4. **无文字依赖** — 不含 "VORZAI" 文字，纯图形标识，缩放无损

### 设计原则

- **极简主义**：3 个核心元素（主峰、次峰、宝石），≤48px 自动降级为单峰
- **对称中的不对称**：整体居中但次峰偏右，打破呆板，增加动态感
- **色彩克制**：琥珀渐变 tile + 白色主字形 + 浅琥珀点缀，3 色体系
- **体积感**：tile 内左上角 10% 白色柔光层，模拟 UI 卡片的微高光

---

## 二、品牌色彩映射

新 logo 的每个颜色都直接取自 `src/styles/theme.css` 的 CSS 变量：

| Logo 元素 | 颜色值 | 对应 CSS 变量 | 含义 |
|-----------|--------|--------------|------|
| Tile 渐变起点 | `#FBBF24` | `--ecom-amber-400` | 电商主色·亮 |
| Tile 渐变终点 | `#D97706` | `--ecom-amber-600` | 电商主色·深 |
| 主峰白色 | `#FFFFFF` | `--bg-card` | 卡片白 / 高对比度 |
| 次峰 / 宝石 | `#FDE68A` | `--ecom-amber-200` | 电商主色·浅（点缀） |
| Dark tile 起 | `#1E293B` | `--gray-900` | 石板灰·最深 |
| Dark tile 止 | `#0F172A` | （Slate 950） | 近黑 |

---

## 三、交付文件清单

### SVG 矢量源（5 个）

| 文件 | 用途 | 背景 |
|------|------|------|
| `public/logo.svg` | **彩色主版**（默认 app 图标 / favicon） | 琥珀渐变 tile |
| `public/logo-dark.svg` | 暗色模式 / 暗色任务栏 | 石板灰 tile |
| `public/logo-simple.svg` | ≤48px 极简专用（单峰，无次峰/宝石） | 琥珀渐变 tile |
| `public/logo-mono.svg` | 单色透明底（currentColor，可任意着色） | 透明 |
| `public/logo-mono-light.svg` | 单色亮版（白色字形，暗色背景用） | 透明 |

### PNG 光栅图（10 个）

| 文件 | 尺寸 | 来源 | 用途 |
|------|------|------|------|
| `icon.png` | 1024×1024 | logo.svg | Electron 应用图标源 / macOS .icns 源 |
| `icon-512.png` | 512×512 | logo.svg | 高清图标 / PWA manifest |
| `icon-256.png` | 256×256 | logo.svg | Windows 大图标 / macOS Retina |
| `icon-128.png` | 128×128 | logo.svg | macOS Finder / Linux .desktop |
| `icon-64.png` | 64×64 | logo.svg | Windows 资源管理器中等图标 |
| `icon-48.png` | 48×48 | logo-simple.svg | macOS Dock / Web favicon 大 |
| `icon-32.png` | 32×32 | logo-simple.svg | **浏览器 favicon** (index.html) |
| `icon-16.png` | 16×16 | logo-simple.svg | Windows 标题栏最小 / 浏览器 tab |
| `logo-dark.png` | 1024×1024 | logo-dark.svg | 暗色模式应用图标备选 |
| `logo-dark-512.png` | 512×512 | logo-dark.svg | 暗色模式高清 |
| `logo-mono.png` | 1024×1024 | logo-mono.svg | 文档嵌入 / 打印（透明底） |
| `logo-mono-light.png` | 1024×1024 | logo-mono-light.svg | 暗色文档嵌入 |

### ICO（Windows 应用图标）

| 文件 | 包含尺寸 | 说明 |
|------|---------|------|
| `icon.ico` | 16 / 32 / 48 / 64 / 128 / 256 / 512 | 7 尺寸 PNG-in-ICO；≤48px 使用极简版保证清晰 |

### 构建脚本

| 文件 | 功能 |
|------|------|
| `scripts/build-logo.js` | 一键全量生成（SVG→PNG+ICO），替代原 build-icons.js |
| `scripts/build-icons.js` | 原脚本（保留不删，已不再被 package.json 引用） |

---

## 四、使用场景对照表

| 场景 | 推荐文件 | 格式 |
|------|---------|------|
| Electron 应用图标（Windows/Mac/Linux） | `public/icon.png` | PNG 1024 |
| Windows 任务栏 / 开始菜单 | `public/icon.ico` | ICO 多尺寸 |
| 浏览器标签页 favicon | `public/logo.svg` + `public/icon-32.png` | SVG + PNG |
| PWA / Web App Manifest | `public/icon-512.png` + `public/icon-192.png`(需生成) | PNG |
| 暗色模式任务栏 / 标题栏 | `public/logo-dark.png` 或 `public/logo-dark.svg` | PNG/SVG |
| 文档 / PDF / 报告内嵌 | `public/logo-mono.svg`（设 color=黑色）或 `public/logo-mono.png` | SVG/PNG |
| 暗色文档内嵌 | `public/logo-mono-light.svg` 或 `public/logo-mono-light.png` | SVG/PNG |
| 营销物料 / 社交头像 | `public/icon-1024.png`(需生成) 或 `public/icon.png` | PNG |
| ≤48px 极小场景（状态栏等） | `public/logo-simple.svg` 或 `public/icon-48.png` | SVG/PNG |

---

## 五、商标注册建议

### 显著性分析

| 维度 | 评估 | 说明 |
|------|------|------|
| **固有显著性** | 中偏高 | 非描述性抽象几何（非「电脑」「购物车」等行业通用符号），具备识别力 |
| **独特性** | 高 | 双峰不对称 + 峰顶宝石的组合在同类软件中未见雷同 |
| **与商品关联性** | 间接 | 峰=增长/攀升，契合「业务倍增」定位，但不直接描述功能 |
| **建议类别** | 第 9 类（计算机软件）、第 35 类（广告/商业管理）、第 42 类（IT 服务） |

### 注册策略建议

1. **先申请图形商标**（本 mark 的黑白线条稿版本 = `logo-mono.svg`），覆盖面最广
2. **再申请彩色商标**（彩色 tile 版 = `logo.svg`），限定具体配色
3. **防御注册**：若预算允许，同时注册文字商标 "VORZAI"（第 9 类）
4. **使用证据**：自发布日起保留所有使用截图（官网、安装包、应用商店页面），作为「通过使用获得显著性」的证据储备

### 注意事项

- 本设计为 AI 辅助创作，建议在提交前做**近似商标检索**（中国商标网 TMO / USPTO TESS）
- 如检索发现高度近似，可在保持核心结构的前提下调整：改变次峰角度比例、增减宝石形状、或调整 tile 圆角比例

---

## 六、重新生成指南

```bash
# 全量重新生成所有尺寸和格式
node scripts/build-logo.js

# 仅更新后，下次 electron-builder 打包自动使用新的 icon.png / icon.ico
npm run build:electron
```

修改 SVG 后只需重跑 `build-logo.js` 即可刷新全部光栅资产。

---

## 七、变更记录

| 日期 | 变更内容 |
|------|---------|
| 2026-08-03 | 初始交付：Apex Escalation 方案，5 个 SVG 变体 + 12 个 PNG + 1 个 ICO + 构建脚本 |
