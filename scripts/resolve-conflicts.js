const fs = require('fs');

// Resolve common.ts - keep notFound from HEAD
let common = fs.readFileSync('server/src/middleware/common.ts', 'utf8');
common = common.split('\n').filter(line => !line.startsWith('<<<<<<< HEAD') && !line.startsWith('=======') && !line.startsWith('>>>>>>> origin/main')).join('\n');
fs.writeFileSync('server/src/middleware/common.ts', common, 'utf8');
console.log('common.ts: conflict markers removed');

// Resolve businessService.ts - keep HEAD versions
let bs = fs.readFileSync('server/src/services/businessService.ts', 'utf8');
const lines = bs.split('\n');
const result = [];
let skip = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('<<<<<<< HEAD')) {
    // Collect HEAD lines until =======
    const headLines = [];
    i++;
    while (i < lines.length && !lines[i].startsWith('=======')) {
      headLines.push(lines[i]);
      i++;
    }
    // Skip ======= and origin/main lines
    i++; // skip =======
    while (i < lines.length && !lines[i].startsWith('>>>>>>> origin/main')) i++;
    i++; // skip >>>>>>>
    // Push HEAD lines (keep our fixes: Record<string,unknown> + property assignment + named params)
    result.push(...headLines);
  } else if (lines[i].startsWith('=======') || lines[i].startsWith('>>>>>>> origin/main')) {
    // Skip these markers
    continue;
  } else {
    result.push(lines[i]);
  }
}
fs.writeFileSync('server/src/services/businessService.ts', result.join('\n'), 'utf8');
console.log('businessService.ts: conflict markers removed, HEAD version kept');

// Verify
const afterCommon = fs.readFileSync('server/src/middleware/common.ts', 'utf8');
const afterBs = fs.readFileSync('server/src/services/businessService.ts', 'utf8');
const markersCommon = (afterCommon.match(/<<<<<<|>>>>>>/g) || []).length;
const markersBs = (afterBs.match(/<<<<<<|>>>>>>/g) || []).length;
console.log('common.ts markers remaining:', markersCommon);
console.log('businessService.ts markers remaining:', markersBs);
