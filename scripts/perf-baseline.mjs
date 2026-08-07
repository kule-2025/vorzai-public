/**
 * 性能基线测试 — 对照《委员会章程与评测标准》3.2 性能达标率
 *
 * 用法：
 *   1) 先起服务：npx tsx server/src/index.ts
 *   2) SMOKE_BASE=http://127.0.0.1:19527 node scripts/perf-baseline.mjs
 *
 * 判定阈值：
 *   单实体 CRUD  P95 ≤ 100ms
 *   列表查询     P95 ≤ 300ms
 *   聚合分析     P95 ≤ 800ms
 */
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:19527';
const ROUNDS = Number(process.env.PERF_ROUNDS || 12);
let TOKEN = '';

/** 递归提取任意字段名的值，兼容不同响应封装层级 */
function digField(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return '';
  if (typeof obj[key] === 'string') return obj[key];
  for (const v of Object.values(obj)) {
    const f = digField(v, key, depth + 1);
    if (f) return f;
  }
  return '';
}

function digToken(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return '';
  if (typeof obj.accessToken === 'string') return obj.accessToken;
  for (const v of Object.values(obj)) {
    const f = digToken(v, depth + 1);
    if (f) return f;
  }
  return '';
}

async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = performance.now() - t0;
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON 响应忽略 */ }
  return { status: res.status, ms, json };
}

function p95(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}

const THRESHOLDS = { crud: 100, list: 300, agg: 800 };
const results = [];

async function bench(label, kind, method, path, body) {
  const samples = [];
  let lastStatus = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const r = await call(method, path, body);
    lastStatus = r.status;
    if (r.status !== 200) break;
    samples.push(r.ms);
  }
  if (samples.length === 0) {
    results.push({ label, kind, ok: false, p95: null, status: lastStatus, note: '接口未返回 200' });
    return;
  }
  const v = p95(samples);
  const limit = THRESHOLDS[kind];
  results.push({ label, kind, ok: v <= limit, p95: v, limit, status: lastStatus });
}

async function main() {
  console.log(`=== Vorzai 性能基线 (${ROUNDS} 轮取 P95) ===\n目标: ${BASE}\n`);

  const suffix = Date.now().toString(36);
  const reg = await call('POST', '/auth/register', {
    username: `perf_${suffix}`,
    password: 'Perf@12345',
    displayName: '性能基线账号',
    tenantName: `性能租户_${suffix}`,
  });
  TOKEN = digToken(reg.json);
  if (!TOKEN) {
    console.error('无法取得 token，注册响应:', JSON.stringify(reg.json).slice(0, 300));
    process.exit(1);
  }

  // 取出本次测试租户 ID，供压测灌数使用（否则测的是空库，毫无意义）
  const me = await call('GET', '/auth/me');
  const tenantId = me.json?.data?.tenantId || me.json?.data?.user?.tenantId
    || me.json?.tenantId || digField(reg.json, 'tenantId');
  console.log('鉴权就绪  租户:', tenantId || '(未识别)');
  if (tenantId) console.log(`如需灌数: SEED_TENANT_ID=${tenantId} node scripts/seed-loadtest.mjs 10000`);
  const cnt = await call('GET', '/business/orders?limit=1');
  const totalOrders = cnt.json?.pagination?.total ?? cnt.json?.data?.total ?? '未知';
  console.log('当前租户订单数:', totalOrders, '\n');

  await bench('健康检查', 'crud', 'GET', '/health');
  await bench('商品列表', 'list', 'GET', '/business/products?limit=20');
  await bench('订单列表', 'list', 'GET', '/business/orders?limit=20');
  await bench('订单统计', 'agg', 'GET', '/business/orders/stats');
  await bench('库存告警列表', 'list', 'GET', '/inventory/alerts?limit=20');
  await bench('库存告警统计', 'agg', 'GET', '/inventory/alerts/stats');
  await bench('人效排行', 'agg', 'GET', '/inventory/attribution/ranking');
  await bench('直播场次列表', 'list', 'GET', '/livestream/sessions?limit=20');
  await bench('直播总览', 'agg', 'GET', '/livestream/overview');
  await bench('平台目录', 'crud', 'GET', '/platform/catalog');
  await bench('平台统计', 'agg', 'GET', '/platform/stats');
  await bench('分析总览', 'agg', 'GET', '/analytics/overview');
  await bench('分析趋势', 'agg', 'GET', '/analytics/trend');
  await bench('分析健康度', 'agg', 'GET', '/analytics/health');
  await bench('综合报告', 'agg', 'GET', '/analytics/report');
  await bench('驾驶舱', 'agg', 'GET', '/cockpit/overview');

  const KIND_CN = { crud: '单实体', list: '列表', agg: '聚合' };
  console.log('结果'.padEnd(18) + '类型'.padEnd(8) + 'P95'.padStart(10) + '阈值'.padStart(9) + '  判定');
  console.log('-'.repeat(60));
  for (const r of results) {
    const p = r.p95 == null ? 'N/A' : `${r.p95.toFixed(1)}ms`;
    const lim = r.limit ? `${r.limit}ms` : '-';
    const verdict = r.ok ? 'PASS' : `FAIL${r.note ? ' ' + r.note : ''}`;
    console.log(r.label.padEnd(16) + KIND_CN[r.kind].padEnd(8) + p.padStart(10) + lim.padStart(9) + '  ' + verdict);
  }

  const pass = results.filter((r) => r.ok).length;
  const rate = ((pass / results.length) * 100).toFixed(1);
  console.log('-'.repeat(60));
  console.log(`性能达标率: ${pass}/${results.length} = ${rate}%  (达标线 95%)`);
  process.exitCode = pass === results.length ? 0 : 1;
}

main().catch((e) => {
  console.error('基线测试异常:', e);
  process.exit(1);
});
