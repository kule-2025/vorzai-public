const fs = require('fs');

// Fix 1: businessService.ts - 5 issues
let bs = fs.readFileSync('server/src/services/businessService.ts', 'utf8');

// 1a: Line 98 - getProject(id) missing tenantId
bs = bs.replace(
  /return this\.getProject\(id\)!;/,
  'return this.getProject(id, tenantId)!;'
);

// 1b: Add isCrossborder to OrderInput interface
bs = bs.replace(
  /(  \/\*\* 来源平台连接.*\n  sourceConnectionId\?: string;)/,
  '$1\n  /** 是否为跨境订单 */\n  isCrossborder?: boolean;'
);

// 1c: Fix queryParams type for paginate calls (lines 1128, 1196, 1265)
// The issue is queryParams is declared as unknown[] but paginate expects Record<string, unknown>
bs = bs.replace(
  /const queryParams: unknown\[\] = \[tenantId\];/,
  'const queryParams: Record<string, unknown> = { tenantId };'
);
// Fix the push pattern for queryParams
bs = bs.replace(
  /queryParams\.push\(params\.status\);/g,
  'queryParams.status = params.status;'
);
bs = bs.replace(
  /queryParams\.push\(params\.platform\);/g,
  'queryParams.platform = params.platform;'
);
bs = bs.replace(
  /queryParams\.push\(params\.keyword\);/g,
  'queryParams.keyword = `%${params.keyword}%`;'
);
bs = bs.replace(
  /queryParams\.push\(params\.endDate\);/g,
  'queryParams.endDate = params.endDate;'
);
bs = bs.replace(
  /queryParams\.push\(params\.startDate\);/g,
  'queryParams.startDate = params.startDate;'
);
bs = bs.replace(
  /queryParams\.push\(params\.status\);/g,
  'queryParams.status = params.status;'
);
// Also fix: queryParams.push(`%${params.keyword}%`)
bs = bs.replace(
  /queryParams\.push\(`%\$\{params\.keyword\}%`\);/g,
  'queryParams.keyword = `%${params.keyword}%`;'
);

fs.writeFileSync('server/src/services/businessService.ts', bs, 'utf8');
console.log('businessService.ts fixes applied');

// Fix 2: livestreamService.ts - dead return result;
let ls = fs.readFileSync('server/src/services/livestreamService.ts', 'utf8');
// The INSERT for LC-02 comes AFTER the return { ... } at line 1329
// We need to move the INSERT before the return, and remove the dead "return result;"
ls = ls.replace(
  /(    return \{\n      sessionId,[\s\S]*?      checkedAt: new Date\(\)\.toISOString\(\),\n    \};)/,
  '$1\n\n    // LC-02: 保存合规报告到 compliance_reports 表\n    db.prepare(\n      `INSERT INTO compliance_reports\n       (id, tenant_id, session_id, scanned_segments, total_issues,\n        high_count, medium_count, low_count, passed, issues, by_category, checked_at)\n       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`\n    ).run(\n      uuidv4(), tenantId, sessionId,\n      scripts.length, issues.length,\n      highCount, mediumCount, lowCount,\n      highCount === 0 ? 1 : 0,\n      JSON.stringify(issues),\n      JSON.stringify(Array.from(byCategoryMap.entries()).map(([c, n]) => ({ category: c, count: n }))),\n      new Date().toISOString()\n    );'
);
// Remove the dead "return result;" and its preceding blank line
ls = ls.replace(
  /\n\n    return result;\n  \}/,
  '\n  }'
);
fs.writeFileSync('server/src/services/livestreamService.ts', ls, 'utf8');
console.log('livestreamService.ts fixes applied');

// Fix 3: crossborderService.ts - missing warnings declaration
let cb = fs.readFileSync('server/src/services/crossborderService.ts', 'utf8');
cb = cb.replace(
  /(    const issues: ComplianceIssue\[\] = \[\];\n    const passed: string\[\] = \[\];)/,
  '$1\n    const warnings: string[] = [];'
);
fs.writeFileSync('server/src/services/crossborderService.ts', cb, 'utf8');
console.log('crossborderService.ts fixes applied');

// Fix 4: business.ts - missing notFound import
let bt = fs.readFileSync('server/src/routes/business.ts', 'utf8');
bt = bt.replace(
  /import \{ asyncHandler, successResponse, paginatedResponse \} from '\.\.\/middleware\/common';/,
  "import { asyncHandler, successResponse, paginatedResponse, notFound } from '../middleware/common';"
);
fs.writeFileSync('server/src/routes/business.ts', bt, 'utf8');
console.log('business.ts fixes applied');

console.log('All fixes applied.');
