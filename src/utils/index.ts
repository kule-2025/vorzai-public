export * from './icons';

/** 金额格式化 */
export function formatCurrency(value: number, currency = 'CNY'): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency }).format(value);
}

/** 数字格式化（带千分位） */
export function formatNumber(value: number): string {
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(2)}万`;
  if (value >= 1000) return `${value.toLocaleString()}`;
  return String(value);
}

/** 百分比变化 */
export function formatPercent(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(2)}%`;
}

/** 日期格式化 */
export function formatDate(date: string | Date, fmt = 'YYYY-MM-DD'): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  const map: Record<string, string> = {
    YYYY: String(year), MM: month, DD: day,
    HH: hours, mm: minutes, ss: seconds,
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (m) => map[m] || m);
}

/** 相对时间 */
export function relativeTime(date: string | Date): string {
  const now = Date.now();
  const target = new Date(date).getTime();
  const diff = Math.floor((now - target) / 1000);

  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}天前`;
  return formatDate(date);
}

/** 生成唯一 ID（加密安全，跨环境兼容：浏览器 + Node.js） */
export function generateId(prefix = 'id'): string {
  const hex = crypto.getRandomValues(new Uint8Array(4));
  const rand = Array.from(hex, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${Date.now()}_${rand}`;
}
