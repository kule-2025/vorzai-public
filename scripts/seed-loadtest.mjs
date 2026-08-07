/**
 * 压测数据生成 — 直接写 SQLite，绕过 HTTP 以便快速灌数
 *
 * 用法: node scripts/seed-loadtest.mjs [订单数，默认10000]
 *
 * 说明：生成的数据全部带 sandbox 标记（remark 前缀 [LOADTEST]），
 * 便于事后清理，不污染真实业务数据。
 */
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const TARGET_ORDERS = Number(process.argv[2] || 10000);
const DB_PATH = process.env.VORZAI_DB || path.resolve('data/vorzai.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('数据库不存在:', DB_PATH, '\n请先启动一次服务以初始化。');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
const uid = () => crypto.randomUUID();
const now = new Date();

// 目标租户：优先取环境变量 SEED_TENANT_ID，否则取库中第一个
let tenantId = process.env.SEED_TENANT_ID || '';
if (!tenantId) {
  const tenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
  if (!tenant) {
    console.error('库中无租户，请先通过 /api/auth/register 建一个。');
    process.exit(1);
  }
  tenantId = tenant.id;
} else {
  const exists = db.prepare('SELECT id FROM tenants WHERE id = ?').get(tenantId);
  if (!exists) {
    console.error('指定的租户不存在:', tenantId);
    process.exit(1);
  }
}
console.log('目标租户:', tenantId);
console.log('目标订单数:', TARGET_ORDERS);

// ---- 商品 ----
const PRODUCT_COUNT = 200;
const productIds = [];
const insProduct = db.prepare(`
  INSERT INTO products (id, tenant_id, sku, name, category, cost_price, selling_price,
                        stock, min_stock, status, description, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'listed', '[LOADTEST]', ?, ?)
`);
const CATEGORIES = ['女装', '男装', '美妆', 'food', '3C数码', '家居', '母婴', '运动户外'];

db.exec('BEGIN');
for (let i = 0; i < PRODUCT_COUNT; i++) {
  const id = uid();
  productIds.push(id);
  const cost = 20 + Math.round(Math.random() * 180);
  const price = Math.round(cost * (1.3 + Math.random() * 1.2));
  const ts = new Date(now.getTime() - Math.random() * 300 * 86400000).toISOString();
  insProduct.run(
    id, tenantId, `LT-SKU-${String(i).padStart(5, '0')}`, `压测商品 ${i}`,
    CATEGORIES[i % CATEGORIES.length], cost, price,
    Math.round(Math.random() * 500), 20, ts, ts,
  );
}
db.exec('COMMIT');
console.log('商品已生成:', PRODUCT_COUNT);

// ---- 订单 ----
const insOrder = db.prepare(`
  INSERT INTO orders (id, tenant_id, order_no, customer_name, customer_phone,
                      items, total_amount, paid_amount, payment_status, order_status,
                      platform, shipping_fee, remark, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[LOADTEST]', ?, ?)
`);
const PLATFORMS = ['taobao', 'jd', 'pdd', 'douyin', 'kuaishou', 'amazon', 'shopify'];
const PAY_MIX = [
  ['paid', 'completed', 1.0], ['paid', 'shipped', 1.0], ['partial', 'confirmed', 0.5],
  ['unpaid', 'pending', 0], ['refunded', 'refunded', 0],
];

const CHUNK = 2000;
let done = 0;
const t0 = Date.now();
while (done < TARGET_ORDERS) {
  const batch = Math.min(CHUNK, TARGET_ORDERS - done);
  db.exec('BEGIN');
  for (let i = 0; i < batch; i++) {
    const n = done + i;
    const lineCount = 1 + (n % 3);
    const items = [];
    let total = 0;
    for (let k = 0; k < lineCount; k++) {
      const pid = productIds[(n * 7 + k * 13) % PRODUCT_COUNT];
      const row = db.prepare('SELECT selling_price FROM products WHERE id = ?').get(pid);
      const qty = 1 + ((n + k) % 4);
      const unit = Number(row?.selling_price || 100);
      items.push({ productId: pid, quantity: qty, unitPrice: unit });
      total += qty * unit;
    }
    const [payStatus, ordStatus, payRatio] = PAY_MIX[n % PAY_MIX.length];
    const created = new Date(now.getTime() - Math.random() * 365 * 86400000).toISOString();
    insOrder.run(
      uid(), tenantId, `LT${String(n).padStart(8, '0')}`,
      `压测客户${n % 500}`, `138${String(10000000 + (n % 89999999)).slice(0, 8)}`,
      JSON.stringify(items), total, Math.round(total * payRatio * 100) / 100,
      payStatus, ordStatus, PLATFORMS[n % PLATFORMS.length],
      Math.round(Math.random() * 15), created, created,
    );
  }
  db.exec('COMMIT');
  done += batch;
  process.stdout.write(`\r订单写入: ${done}/${TARGET_ORDERS}`);
}
console.log(`\n完成，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const cnt = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE tenant_id = ?').get(tenantId);
console.log('该租户订单总数:', cnt.c);
db.close();
