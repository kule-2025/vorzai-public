#!/usr/bin/env node
/**
 * Fix livestreamService.ts — 将 addSandboxMetrics 移入类内部
 *
 * R3 审计修复 (729ba2c) 在追加 LC-01 时出现了结构性错误：
 *   addSandboxMetrics 方法被写在了 class 闭合括号 {line 2329} 之后，
 *   而非之前。这导致 server/tsconfig.json 下 TypeScript 报 TS1005。
 *
 * 修复策略：
 *   1. 识别 class 闭合括号位置
 *   2. 识别 addSandboxMetrics 方法范围
 *   3. 将方法从尾部剪切，插入到 class 闭合括号之前
 */
'use strict';

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'server', 'src', 'services', 'livestreamService.ts');
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

console.log('=== livestreamService.ts 修复脚本 ===');
console.log('总行数:', lines.length);

// ── 1. 定位 class 闭合括号 ──────────────────────────────────────────
let classEndIndex = -1, braceCount = 0, inClass = false;
for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  if (trimmed.startsWith('export class LivestreamService')) {
    inClass = true;
  }
  if (inClass) {
    for (const ch of lines[i]) {
      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;
    }
    if (braceCount === 0 && i > 0) {
      classEndIndex = i;
      break;
    }
  }
}
console.log('Class 闭合括号: line', classEndIndex + 1, '(index', classEndIndex + ')');

// ── 2. 定位 addSandboxMetrics 方法 ─────────────────────────────────
let methodStart = -1, methodEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('addSandboxMetrics')) {
    methodStart = i;
    let mb = 0;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === '{') mb++;
        if (ch === '}') mb--;
      }
      if (mb === 0 && j > i) {
        methodEnd = j;
        break;
      }
    }
    break;
  }
}
console.log('addSandboxMetrics: line', methodStart + 1, '-', methodEnd + 1, '(索引', methodStart, '-', methodEnd + ')');

if (classEndIndex === -1 || methodStart === -1) {
  console.error('❌ 无法定位 class 或方法');
  process.exit(1);
}

// ── 3. 重新组装 ────────────────────────────────────────────────────
// 目标结构：
//   [0 .. classEndIndex-1]     → class 体（不含闭合括号）
//   [空行]
//   [methodStart .. methodEnd] → addSandboxMetrics 方法
//   [classEndIndex]            → class 闭合括号 }
//   [classEndIndex+1 .. methodStart-1] → 原有 helper 函数
//   [methodEnd+1 .. end]       → export 语句等

const partClassBody = lines.slice(0, classEndIndex);           // 不含闭合括号
const partMethod = lines.slice(methodStart, methodEnd + 1);    // 方法体
const partHelper = lines.slice(classEndIndex + 1, methodStart); // helper 函数（mapReview 等）
const partExport = lines.slice(methodEnd + 1);                  // export 语句

const newLines = [...partClassBody, '', ...partMethod, ...partHelper, ...partExport];

// ── 4. 验证 ────────────────────────────────────────────────────────
let bc = 0, ic = false;
for (const line of newLines) {
  if (line.trim().startsWith('export class LivestreamService')) ic = true;
  if (ic) {
    for (const ch of line) { if (ch === '{') bc++; if (ch === '}') bc--; }
  }
}
console.log('新总行数:', newLines.length);
console.log('括号平衡:', bc, '(期望 0)');
console.log('方法位置检查:');
let newMethodStart = -1;
for (let i = 0; i < newLines.length; i++) {
  if (newLines[i].includes('addSandboxMetrics')) { newMethodStart = i; break; }
}
console.log('  addSandboxMetrics line:', newMethodStart + 1);
console.log('  预期: 在 class 闭合括号之前');

// 写入
fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log('✅ 修复完成，已写入文件');
