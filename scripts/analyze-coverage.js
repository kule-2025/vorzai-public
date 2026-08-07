const fs = require('fs');
const data = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
const results = [];
const seen = {};
Object.keys(data).forEach(function(k) {
  const lk = k.toLowerCase();
  if (seen[lk]) return;
  seen[lk] = 1;
  if (lk.indexOf('server/src') === -1) return;
  const s = data[k].s;
  const fns = data[k].f;
  const lines = Object.values(s);
  const funcs = Object.values(fns);
  const lc = lines.length > 0 ? (lines.filter(function(v) { return v > 0; }).length / lines.length * 100) : 0;
  const fc = funcs.length > 0 ? (funcs.filter(function(v) { return v > 0; }).length / funcs.length * 100) : 0;
  const ms = lines.filter(function(v) { return v === 0; }).length;
  const idx = k.lastIndexOf('\\');
  const sp = idx >= 0 ? k.substring(idx + 1) : k;
  results.push({ file: sp, lineCov: lc, funcCov: fc, missing: ms });
});
results.sort(function(a, b) { return a.lineCov - b.lineCov; });
console.log('=== 低覆盖率文件 TOP 15 ===');
results.slice(0, 15).forEach(function(r) {
  console.log(r.file.padEnd(45) + ' lines:' + r.lineCov.toFixed(1) + '% funcs:' + r.funcCov.toFixed(1) + '% missing:' + r.missing);
});
console.log('');
console.log('=== 高覆盖率文件（参考）===');
results.slice(-10).reverse().forEach(function(r) {
  console.log(r.file.padEnd(45) + ' lines:' + r.lineCov.toFixed(1) + '% funcs:' + r.funcCov.toFixed(1) + '% missing:' + r.missing);
});
console.log('');
console.log('后端覆盖文件总数:', results.length);
