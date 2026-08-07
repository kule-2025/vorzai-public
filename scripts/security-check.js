#!/usr/bin/env node
/**
 * Vorzai 自动化安全检测脚本
 * 在 CI/CD 或提交前运行，自动检测常见安全漏洞和代码质量问题
 *
 * 用法: node scripts/security-check.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER_SRC = path.join(ROOT, 'server', 'src');
const FRONTEND_SRC = path.join(ROOT, 'src');

let issues = 0;
let warnings = 0;

function checkFile(filePath, rules) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const rule of rules) {
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        // Skip if exclude pattern matches
        if (rule.exclude && rule.exclude.test(lines[i])) continue;

        const severity = rule.severity || 'WARNING';
        if (severity === 'ERROR') issues++;
        else warnings++;
        console.log(`[${severity}] ${path.relative(ROOT, filePath)}:${i + 1} — ${rule.message}`);
        if (rule.fix) console.log(`  → 修复: ${rule.fix}`);
      }
    }
  }
}

// ==================== 后端安全规则 ====================
const backendRules = [
  {
    pattern: /new\s+Function\s*\(/,
    message: '检测到 new Function() — 远程代码执行风险',
    fix: '使用安全算术解析器替代 eval/new Function',
    severity: 'ERROR',
  },
  {
    pattern: /eval\s*\(/,
    message: '检测到 eval() — 代码注入风险',
    fix: '使用安全的替代方案',
    severity: 'ERROR',
  },
  {
    pattern: /ORDER BY \$\{/,
    message: '检测到 SQL ORDER BY 字符串拼接 — 请确认已有白名单校验',
    fix: '使用白名单校验 sortBy 参数',
    severity: 'WARNING',
  },
  {
    pattern: /INSERT OR REPLACE INTO/,
    message: '检测到 INSERT OR REPLACE — 可能丢失行ID和审计记录',
    fix: '使用 ON CONFLICT DO UPDATE',
    severity: 'WARNING',
  },
  {
    pattern: /WHERE\s+\w+\.id\s*=\s*\?[^)]*$/,
    message: '单实体查询可能缺少 tenant_id 过滤 — 跨租户数据泄露风险',
    fix: '添加 AND tenant_id = ? 条件',
    severity: 'WARNING',
  },
  {
    pattern: /localStorage\.setItem.*token/i,
    message: 'Token 存储在 localStorage — XSS 可窃取',
    fix: '使用 httpOnly cookie 或 Electron safeStorage',
    severity: 'WARNING',
  },
  {
    pattern: /sandbox:\s*false/,
    message: 'Electron sandbox 被禁用 — 安全风险',
    fix: '设置 sandbox: true',
    severity: 'ERROR',
  },
  {
    pattern: /unsafe-eval/,
    message: 'CSP 允许 unsafe-eval — XSS 风险',
    fix: '移除 unsafe-eval',
    severity: 'ERROR',
  },
  {
    pattern: /process\.env\.(JWT_SECRET|SECRET_KEY|API_KEY|PASSWORD)\s*\|\|\s*['"][^'"]{10,}['"]/,
    message: '硬编码密钥 fallback — 安全风险',
    fix: '使用随机生成的密钥并持久化',
    severity: 'ERROR',
  },
];

// ==================== 前端安全规则 ====================
const frontendRules = [
  {
    pattern: /dangerouslySetInnerHTML/,
    message: '检测到 dangerouslySetInnerHTML — XSS 风险',
    fix: '使用 DOMPurify 消毒',
    severity: 'WARNING',
  },
  {
    pattern: /!item\.tenantId\s*\|\|/,
    message: '租户过滤允许无 tenantId 项通过 — 数据泄露',
    fix: '仅返回 tenantId === 当前租户的项',
    severity: 'ERROR',
  },
];

// ==================== Schema 规则 ====================
const schemaRules = [
  {
    pattern: /CHECK\s*\([^)]*order_status[^)]*\)/,
    message: '检查 order_status CHECK 约束是否包含所有状态值',
    fix: '确保包含 pending/confirmed/processing/shipped/delivered/completed/cancelled/returned/refunded',
    severity: 'WARNING',
  },
];

console.log('=== Vorzai 安全自动检测 ===\n');

// Scan backend
console.log('--- 后端扫描 ---');
function scanDir(dir, rules) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath, rules);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
      checkFile(fullPath, rules);
    }
  }
}

scanDir(SERVER_SRC, backendRules);

// Scan frontend
console.log('\n--- 前端扫描 ---');
scanDir(FRONTEND_SRC, frontendRules);

// Scan schema
console.log('\n--- Schema 扫描 ---');
checkFile(path.join(SERVER_SRC, 'db', 'schema.sql'), schemaRules);

// Summary
console.log('\n=== 检测结果 ===');
console.log(`错误: ${issues}`);
console.log(`警告: ${warnings}`);
console.log(`总计: ${issues + warnings}`);

if (issues > 0) {
  console.log('\n❌ 检测到安全问题，请修复后再提交');
  process.exit(1);
} else {
  console.log('\n✅ 安全检查通过');
  process.exit(0);
}
