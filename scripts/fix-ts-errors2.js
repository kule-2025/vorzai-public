const fs = require('fs');

// Fix 1: Add notFound to common.ts
let common = fs.readFileSync('server/src/middleware/common.ts', 'utf8');
common = common.replace(
  /export function paginatedResponse/,
  `export function notFound(entity: string, id: string): void {
  throw new Error(\`\${entity} 不存在: \${id}\`);
}

export function paginatedResponse`
);
fs.writeFileSync('server/src/middleware/common.ts', common, 'utf8');
console.log('common.ts: added notFound');

// Fix 2: Fix crossborderService.ts - warnings type
let cb = fs.readFileSync('server/src/services/crossborderService.ts', 'utf8');
// warnings.push({...}) should use issues.push({...}) since warnings is string[]
// The object pushed at line 1398 has: code, field, title, detail, suggestion
// This is a ComplianceIssue structure, so it should go to issues, not warnings
cb = cb.replace(
  /      warnings\.push\(\{\n        code: 'IS_PROHIBITED_NOT_ASSESSED',\n        field: 'isProhibited',\n        title: '跨境禁运属性未评估',\n        detail: '该商品尚未在合规管理中设置"是否违禁"标记，合规体检无法判断。',\n        suggestion: '请在「跨境合规管理」中为该商品补充禁运评估。',\n      \}\);/,
  `      issues.push({
        code: 'IS_PROHIBITED_NOT_ASSESSED',
        level: 'warning',
        field: 'isProhibited',
        title: '跨境禁运属性未评估',
        detail: '该商品尚未在合规管理中设置"是否违禁"标记，合规体检无法判断。',
        suggestion: '请在「跨境合规管理」中为该商品补充禁运评估。',
      });`
);
fs.writeFileSync('server/src/services/crossborderService.ts', cb, 'utf8');
console.log('crossborderService.ts: fixed warnings.push -> issues.push');

// Fix 3: Fix businessService.ts - all queryParams type issues
let bs = fs.readFileSync('server/src/services/businessService.ts', 'utf8');

// listCampaigns: queryParams should be Record<string, unknown> not unknown[]
bs = bs.replace(
  /const queryParams: unknown\[\] = \[tenantId\];\n    if \(params\.platform\) \{ where\.push\('c\.platform = \?'\); queryParams\.push\(params\.platform\); \}\n    if \(params\.keyword\) \{ where\.push\('c\.name LIKE \?'\); queryParams\.push\(`%\$\{params\.keyword\}%`\); \}\n    const whereClause = `WHERE \$\{where\.join\(' AND '\)\}`;\n    return paginate\(\n      `SELECT c\.\* FROM campaigns c \$\{whereClause\} ORDER BY c\.created_at DESC`,\n      `SELECT COUNT\(\*\) as total FROM campaigns c \$\{whereClause\}`,\n      queryParams, params\n    \);/,
  `const queryParams: Record<string, unknown> = { tenantId };
    if (params.platform) { queryParams.platform = params.platform; }
    if (params.keyword) { queryParams.keyword = \`%\${params.keyword}%\`; }
    const whereClause = \`WHERE \${where.join(' AND ')}\`;
    return paginate(
      \`SELECT c.* FROM campaigns c \${whereClause} ORDER BY c.created_at DESC\`,
      \`SELECT COUNT(*) as total FROM campaigns c \${whereClause}\`,
      queryParams, params
    );`
);

// listAdSpend: fix queryParams
bs = bs.replace(
  /const queryParams: unknown\[\] = \[tenantId\];\n    if \(params\.platform\) \{ where\.push\('a\.platform = \?'\); queryParams\.platform = params\.platform; \}\n    if \(params\.campaignId\) \{ where\.push\('a\.campaign_id = \?'\); queryParams\.push\(params\.campaignId\); \}\n    if \(params\.startDate\) \{ where\.push\('a\.spend_date >= \?'\); queryParams\.startDate = params\.startDate; \}\n    if \(params\.endDate\) \{ where\.push\('a\.spend_date <= \?'\); queryParams\.endDate = params\.endDate; \}\n    const whereClause = `WHERE \$\{where\.join\(' AND '\)\}`;\n    return paginate\(\n      `SELECT a\.\*, c\.name as campaign_name, p\.name as project_name FROM ad_spend a LEFT JOIN campaigns c ON a\.campaign_id = c\.id LEFT JOIN projects p ON a\.project_id = p\.id \$\{whereClause\} ORDER BY a\.spend_date DESC`,\n      `SELECT COUNT\(\*\) as total FROM ad_spend a \$\{whereClause\}`,\n      queryParams, params\n    \);/,
  `const queryParams: Record<string, unknown> = { tenantId };
    if (params.platform) { queryParams.platform = params.platform; }
    if (params.campaignId) { queryParams.campaignId = params.campaignId; }
    if (params.startDate) { queryParams.startDate = params.startDate; }
    if (params.endDate) { queryParams.endDate = params.endDate; }
    const whereClause = \`WHERE \${where.join(' AND ')}\`;
    return paginate(
      \`SELECT a.*, c.name as campaign_name, p.name as project_name FROM ad_spend a LEFT JOIN campaigns c ON a.campaign_id = c.id LEFT JOIN projects p ON a.project_id = p.id \${whereClause} ORDER BY a.spend_date DESC\`,
      \`SELECT COUNT(*) as total FROM ad_spend a \${whereClause}\`,
      queryParams, params
    );`
);

// listReviews: fix queryParams  
bs = bs.replace(
  /const queryParams: unknown\[\] = \[tenantId\];\n    if \(params\.productId\) \{ where\.push\('r\.product_id = \?'\); queryParams\.push\(params\.productId\); \}\n    if \(params\.rating\) \{ where\.push\('r\.rating = \?'\); queryParams\.push\(params\.rating\); \}\n    if \(params\.status\) \{ where\.push\('r\.status = \?'\); queryParams\.status = params\.status; \}\n    const whereClause = `WHERE \$\{where\.join\(' AND '\)\}`;\n    return paginate\(\n      `SELECT r\.\*, p\.name as product_name, p\.sku, u\.display_name as reviewer_name FROM product_reviews r LEFT JOIN products p ON r\.product_id = p\.id LEFT JOIN users u ON r\.user_id = u\.id \$\{whereClause\} ORDER BY r\.created_at DESC`,\n      `SELECT COUNT\(\*\) as total FROM product_reviews r \$\{whereClause\}`,\n      queryParams, params\n    \);/,
  `const queryParams: Record<string, unknown> = { tenantId };
    if (params.productId) { queryParams.productId = params.productId; }
    if (params.rating) { queryParams.rating = params.rating; }
    if (params.status) { queryParams.status = params.status; }
    const whereClause = \`WHERE \${where.join(' AND ')}\`;
    return paginate(
      \`SELECT r.*, p.name as product_name, p.sku, u.display_name as reviewer_name FROM product_reviews r LEFT JOIN products p ON r.product_id = p.id LEFT JOIN users u ON r.user_id = u.id \${whereClause} ORDER BY r.created_at DESC\`,
      \`SELECT COUNT(*) as total FROM product_reviews r \${whereClause}\`,
      queryParams, params
    );`
);

fs.writeFileSync('server/src/services/businessService.ts', bs, 'utf8');
console.log('businessService.ts: fixed queryParams types');

console.log('All fixes applied.');
