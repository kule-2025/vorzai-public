/** 违禁词库规模审计（一次性诊断脚本） */
import fs from 'node:fs';

const s = fs.readFileSync('server/src/services/livestreamService.ts', 'utf8');
const i = s.indexOf('LexiconEntry[] = [');
const seg = s.slice(i, s.indexOf('\n];', i));
const words = [...seg.matchAll(/word:\s*'([^']+)'/g)].map((m) => m[1]);
const cats = [...seg.matchAll(/category:\s*'([^']+)'/g)].map((m) => m[1]);
const counter = {};
for (const c of cats) counter[c] = (counter[c] || 0) + 1;

console.log('违禁词条数:', words.length);
console.log('分类分布:', JSON.stringify(counter, null, 2));
console.log('样例:', words.slice(0, 12).join(' / '));

const shouldHave = [
  '国家级', '最高级', '绝对化', '第一品牌', '独家', '唯一', '包治百病', '根治',
  '无效退款', '祖传秘方', '最安全', '万能', '史无前例', '空前绝后', '永久',
  '瞬间见效', '抗癌', '防癌', '壮阳', '丰胸', '解毒', '排毒养颜', '零风险',
];
const missing = shouldHave.filter((w) => !words.some((x) => x.includes(w) || w.includes(x)));
console.log('高危缺口 (' + missing.length + '/' + shouldHave.length + '):', missing.join(' / '));
