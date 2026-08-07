/**
 * P0 五大模块端到端冒烟测试
 * 启动服务后运行: node scripts/smoke-p0.mjs
 */
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:19599';
let TOKEN = '';
const results = [];

/** 深度递归提取 accessToken，兼容不同响应封装 */
function digToken(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return '';
  if (typeof obj.accessToken === 'string') return obj.accessToken;
  for (const v of Object.values(obj)) {
    const found = digToken(v, depth + 1);
    if (found) return found;
  }
  return '';
}

function rec(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}

async function call(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN && !opts.noAuth) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json };
}

/** 端点检查：入参正确时应返回 200，非 200 一律视为失败 */
async function probe(label, method, path, body) {
  const r = await call(method, path, body);
  const ok = r.status === 200 || r.status === 201;
  rec(`${label} [${method} ${path}]`, ok, `HTTP ${r.status}${ok ? '' : ' ' + JSON.stringify(r.json).slice(0, 220)}`);
  return r;
}

async function main() {
  console.log('=== Vorzai P0 集成冒烟 ===\n');

  // 0. 健康检查
  const h = await call('GET', '/api/health', null, { noAuth: true });
  rec('健康检查', h.status === 200, `HTTP ${h.status}`);

  // 1. 注册租户 + 管理员
  const stamp = Date.now();
  const username = `smoke${stamp}`;
  const reg = await call('POST', '/api/auth/register', {
    username,
    password: 'Smoke@Pass123',
    displayName: '冒烟管理员',
    email: `${username}@vorzai.test`,
    tenantName: `冒烟租户${stamp}`,
  }, { noAuth: true });
  rec('注册租户+管理员', reg.status === 200 || reg.status === 201,
    `HTTP ${reg.status} ${reg.status >= 400 ? JSON.stringify(reg.json).slice(0, 200) : ''}`);

  TOKEN = digToken(reg.json);
  if (!TOKEN) {
    const login = await call('POST', '/api/auth/login', { username, password: 'Smoke@Pass123' }, { noAuth: true });
    TOKEN = digToken(login.json);
    rec('登录取 token', !!TOKEN, TOKEN ? 'ok' : JSON.stringify(login.json).slice(0, 300));
  } else {
    rec('注册直接返回 token', true, 'ok');
  }
  if (!TOKEN) { console.log('\n无法取得 token，后续鉴权端点跳过'); summary(); return; }

  // 2. 未授权访问应被拒（安全红线）
  const savedToken = TOKEN; TOKEN = '';
  const unauth = await call('GET', '/api/inventory/alerts');
  rec('未授权访问被拒（安全红线）', unauth.status === 401 || unauth.status === 403, `HTTP ${unauth.status}`);
  TOKEN = savedToken;

  // 2.5 先铺真实业务数据，供后续 Analytics 验证「真算而非 Mock」
  console.log('\n--- 归因链路闭环（铺数据）---');
  const prod0 = await call('POST', '/api/business/products', {
    name: '冒烟商品', sku: `SMOKE-${stamp}`, sellingPrice: 100, costPrice: 60, stock: 50,
  });
  const productId = prod0.json?.data?.id || prod0.json?.id;
  rec('创建商品', !!productId, productId ? `id=${productId}` : `HTTP ${prod0.status} ${JSON.stringify(prod0.json).slice(0, 200)}`);

  if (productId) {
    const order = await call('POST', '/api/business/orders', {
      customerName: '冒烟客户',
      items: [{ productId, quantity: 2, unitPrice: 100 }],
      subtotal: 200, totalAmount: 200,
    });
    const o = order.json?.data || order.json;
    const orderId = o?.id;
    rec('创建订单', !!orderId, orderId ? `id=${orderId} 初始 ${o.payment_status}/${o.order_status}` : `HTTP ${order.status} ${JSON.stringify(order.json).slice(0, 250)}`);

    if (orderId) {
      // 支付链路（本轮新修断点）：部分收款 -> 结清 -> 状态自动推进
      const part = await call('PUT', `/api/business/orders/${orderId}/payment`, { amount: 80, paymentMethod: 'wechat' });
      const p1 = part.json?.data || {};
      rec('部分收款 80 → partial', p1.payment_status === 'partial' && p1.paid_amount === 80,
        `paid=${p1.paid_amount} status=${p1.payment_status} (HTTP ${part.status})`);

      const full = await call('PUT', `/api/business/orders/${orderId}/payment`, { amount: 120 });
      const p2 = full.json?.data || {};
      rec('结清 120 → paid 且订单自动 confirmed',
        p2.payment_status === 'paid' && p2.paid_amount === 200 && p2.order_status === 'confirmed',
        `paid=${p2.paid_amount} pay=${p2.payment_status} order=${p2.order_status}`);

      const over = await call('PUT', `/api/business/orders/${orderId}/payment`, { amount: 50 });
      rec('超额收款被拒（金额守恒）', over.status === 400,
        `HTTP ${over.status} ${String(over.json?.error?.message || '').slice(0, 80)}`);

      // 跨租户越权支付检查（安全红线）
      const s2 = Date.now() + 1;
      const reg2 = await call('POST', '/api/auth/register', {
        username: `smokeb${s2}`, password: 'Smoke@Pass123', displayName: '他租户',
        email: `smokeb${s2}@vorzai.test`, tenantName: `他租户${s2}`,
      }, { noAuth: true });
      const otherToken = digToken(reg2.json);
      const saved = TOKEN; TOKEN = otherToken;
      const cross = await call('PUT', `/api/business/orders/${orderId}/payment`, { amount: 10 });
      rec('跨租户支付被拒（安全红线）', cross.status === 404 || cross.status === 403, `HTTP ${cross.status}`);
      TOKEN = saved;
    }
  }

  // 3. P0-1 库存预警 + 归因
  console.log('\n--- P0-1 库存预警与业务HR归因 ---');
  await probe('告警规则列表', 'GET', '/api/inventory/rules');
  await probe('告警列表', 'GET', '/api/inventory/alerts');
  await probe('告警统计', 'GET', '/api/inventory/alerts/stats');
  await probe('触发规则重评估', 'POST', '/api/inventory/evaluate', {});
  await probe('归因排行', 'GET', '/api/inventory/attribution/ranking');
  await probe('人效分析', 'GET', '/api/inventory/attribution/efficiency');

  // 4. P0-2 跨境合规与多币种
  console.log('\n--- P0-2 跨境合规与多币种 ---');
  await probe('跨境总览', 'GET', '/api/crossborder/overview');
  await probe('币种字典', 'GET', '/api/crossborder/currencies');
  await probe('国家字典', 'GET', '/api/crossborder/countries');
  await probe('HS 编码库', 'GET', '/api/crossborder/hs-codes');
  await probe('运输方式', 'GET', '/api/crossborder/shipping-modes');
  // 先写入一条汇率，再验证换算走真实汇率而非硬编码
  await probe('录入汇率 USD→CNY', 'POST', '/api/crossborder/exchange-rates',
    { fromCurrency: 'USD', toCurrency: 'CNY', rate: 7.25, source: 'smoke' });
  await probe('查询最新汇率', 'GET', '/api/crossborder/exchange-rates/latest?from=USD&to=CNY');
  const conv = await probe('币种换算 USD→CNY', 'POST', '/api/crossborder/currency/convert',
    { amount: 100, from: 'USD', to: 'CNY' });
  if (conv.status === 200) console.log('      换算结果:', JSON.stringify(conv.json?.data).slice(0, 180));
  const vat = await probe('VAT 税费计算（德国 19%）', 'POST', '/api/crossborder/vat/calculate',
    { amount: 1000, rate: 0.19, destinationCountry: 'DE' });
  if (vat.status === 200) console.log('      VAT 结果:', JSON.stringify(vat.json?.data).slice(0, 180));
  const landed = await probe('到岸成本测算', 'POST', '/api/crossborder/landed-cost',
    { costPrice: 60, qty: 10, destinationCountry: 'US', sellingPrice: 100,
      sellingCurrency: 'USD', shippingMode: 'sea', weightKg: 0.5,
      platformFeeRate: 0.05, paymentFeeRate: 0.03, adRate: 0.1 });
  if (landed.status === 200) console.log('      到岸成本:', JSON.stringify(landed.json?.data).slice(0, 260));

  // 5. P0-3 直播电商
  console.log('\n--- P0-3 直播电商 ---');
  await probe('直播总览', 'GET', '/api/livestream/overview');
  await probe('合规敏感词库', 'GET', '/api/livestream/compliance/lexicon');
  await probe('直播场次列表', 'GET', '/api/livestream/sessions');
  const sess = await call('POST', '/api/livestream/sessions', {
    title: '冒烟直播场次',
    scheduledStart: new Date(Date.now() + 3600e3).toISOString(),
    scheduledEnd: new Date(Date.now() + 7200e3).toISOString(),
    platform: 'douyin',
  });
  const sessionId = sess.json?.data?.id || sess.json?.id;
  rec('创建直播场次', !!sessionId, sessionId ? `id=${sessionId}` : `HTTP ${sess.status} ${JSON.stringify(sess.json).slice(0, 200)}`);
  if (sessionId) {
    await probe('场次脚本列表', 'GET', `/api/livestream/sessions/${sessionId}/scripts`);
    await probe('场次选品列表', 'GET', `/api/livestream/sessions/${sessionId}/products`);
    await probe('场次时间轴', 'GET', `/api/livestream/sessions/${sessionId}/timeline`);
    await probe('场次实时快照', 'GET', `/api/livestream/sessions/${sessionId}/snapshot`);
  }

  // 6. P0-4 平台对接
  console.log('\n--- P0-4 平台对接适配层 ---');
  const cat = await probe('平台目录（适配器清单）', 'GET', '/api/platform/catalog');
  if (cat.status === 200) {
    const list = cat.json?.data?.platforms || cat.json?.data || [];
    console.log('      已注册适配器:', Array.isArray(list) ? list.length : JSON.stringify(list).slice(0, 160));
  }
  await probe('平台连接列表', 'GET', '/api/platform/connections');
  await probe('同步任务列表', 'GET', '/api/platform/jobs');
  await probe('同步日志', 'GET', '/api/platform/logs');
  await probe('平台统计', 'GET', '/api/platform/stats');

  // 7. P0-5 Analytics 真实计算
  console.log('\n--- P0-5 Analytics 真实计算 ---');
  const ov = await probe('分析总览', 'GET', '/api/analytics/overview');
  if (ov.status === 200) {
    const metrics = ov.json?.data?.metrics || [];
    const find = k => metrics.find(m => m.key === k)?.value;
    const gmv = find('gmv');
    const profit = find('grossProfit') ?? find('gross_profit');
    console.log('      指标:', metrics.map(m => `${m.key}=${m.value}`).join(' '));
    // 已支付订单 200 元、成本 60×2=120 → GMV 200 / 毛利 80
    rec('Analytics GMV 为真实计算（=200 非 Mock）', gmv === 200, `gmv=${gmv}`);
    if (profit !== undefined) {
      rec('Analytics 毛利口径正确（=80）', profit === 80, `grossProfit=${profit}`);
    }
  }
  await probe('趋势', 'GET', '/api/analytics/trend');
  await probe('漏斗', 'GET', '/api/analytics/funnel');
  await probe('维度拆解', 'GET', '/api/analytics/breakdown');
  await probe('商品分析', 'GET', '/api/analytics/products');
  await probe('员工分析', 'GET', '/api/analytics/employees');
  await probe('客户分析', 'GET', '/api/analytics/customers');
  await probe('健康度', 'GET', '/api/analytics/health');
  await probe('快照计算', 'POST', '/api/analytics/snapshots/compute', {});
  await probe('综合报告', 'GET', '/api/analytics/report');

  summary();
}

function summary() {
  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n=== 汇总: ${pass} PASS / ${fail} FAIL (共 ${results.length}) ===`);
  if (fail) {
    console.log('\n失败项:');
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.detail}`));
  }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('冒烟脚本异常:', e); process.exit(2); });
