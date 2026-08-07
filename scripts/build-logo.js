#!/usr/bin/env node
/**
 * Vorzai · 原创 Logo 资源生成器（Apex Escalation 方案）
 * ────────────────────────────────────────────────────────
 * 读取 public/logo*.svg，输出：
 *   · 彩色主版：icon.png(1024) + icon-{64,128,256,512}.png
 *   · 极简版(≤48px 更清晰)：icon-{16,32,48}.png
 *   · 暗色版：logo-dark.png(1024) + logo-dark-512.png
 *   · 单色版：logo-mono.png / logo-mono-light.png（透明底）
 *   · Windows 应用图标：icon.ico（16/32/48/64/128/256/512 多尺寸）
 * 并同步至 build/（若存在）。
 *
 * 用法：node scripts/build-logo.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const BUILD = path.join(ROOT, 'build');

const read = (f) => fs.readFileSync(path.join(PUBLIC, f));

// 透明底
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

async function main() {
  const sharp = require('sharp');
  const pngToIco = (await import('png-to-ico')).default;

  const ensureDir = (d) => fs.existsSync(d) || fs.mkdirSync(d, { recursive: true });
  ensureDir(PUBLIC);

  // 渲染某 SVG 到指定边长 PNG
  const render = async (svgName, size, transparent = false) =>
    sharp(read(svgName), { density: 384 })
      .resize(size, size, { fit: 'contain', background: transparent ? TRANSPARENT : { r: 255, g: 255, b: 255, alpha: 0 } })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();

  const write = (name, buf) => {
    fs.writeFileSync(path.join(PUBLIC, name), buf);
    console.log(`  ✓ ${name} (${(buf.length / 1024).toFixed(1)} KB)`);
  };

  console.log('▸ Vorzai Logo 资源生成（Apex Escalation）\n');

  // 1) 彩色主版 → 大尺寸
  console.log('[1/5] 彩色主版（icon.png + 64/128/256/512）...');
  const master = await render('logo.svg', 1024);
  write('icon.png', master);
  for (const s of [512, 256, 128, 64]) write(`icon-${s}.png`, await render('logo.svg', s));

  // 2) 极简版 → 小尺寸（16/32/48 更清晰）
  console.log('\n[2/5] 极简版（icon-16/32/48）...');
  for (const s of [48, 32, 16]) write(`icon-${s}.png`, await render('logo-simple.svg', s));

  // 3) 暗色版
  console.log('\n[3/5] 暗色版（logo-dark / logo-dark-512）...');
  write('logo-dark.png', await render('logo-dark.svg', 1024));
  write('logo-dark-512.png', await render('logo-dark.svg', 512));

  // 4) 单色版（透明底）
  console.log('\n[4/5] 单色版（logo-mono / logo-mono-light）...');
  write('logo-mono.png', await render('logo-mono.svg', 1024, true));
  write('logo-mono-light.png', await render('logo-mono-light.svg', 1024, true));

  // 5) Windows .ico（多尺寸；小尺寸用极简版保证清晰）
  console.log('\n[5/5] 生成 icon.ico（16/32/48/64/128/256/512）...');
  const icoMap = [
    [16, 'logo-simple.svg'],
    [32, 'logo-simple.svg'],
    [48, 'logo-simple.svg'],
    [64, 'logo.svg'],
    [128, 'logo.svg'],
    [256, 'logo.svg'],
    [512, 'logo.svg'],
  ];
  const icoBuffers = [];
  for (const [size, src] of icoMap) icoBuffers.push(await render(src, size));
  const icoBuf = await pngToIco(icoBuffers);
  write('icon.ico', icoBuf);

  // 同步至 build/
  if (fs.existsSync(BUILD)) {
    fs.copyFileSync(path.join(PUBLIC, 'icon.png'), path.join(BUILD, 'icon.png'));
    fs.copyFileSync(path.join(PUBLIC, 'icon.ico'), path.join(BUILD, 'icon.ico'));
    console.log('\n▸ 已同步 icon.png / icon.ico → build/');
  } else {
    console.log('\n▸ build/ 不存在，跳过同步（不影响运行）');
  }

  console.log('\n✅ Logo 资源全部生成完毕');
}

main().catch((e) => {
  console.error('✗ 生成失败:', e);
  process.exit(1);
});
