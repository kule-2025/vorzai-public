#!/usr/bin/env node
/**
 * Vorzai 电商 Agent · 多尺寸 Logo 图标生成器
 * ────────────────────────────────────────────────
 * 输入：public/logo.svg (1024x1024 矢量源) 或 public/icon.png
 * 输出：
 *   public/icon.png          (1024x1024 主图标)
 *   public/icon.ico          (Windows 应用图标：16/32/48/64/128/256 多尺寸)
 *   public/icon-{16,32,48,64,128,256,512}.png (多尺寸 PNG)
 *
 * 用法：
 *   node scripts/build-icons.js
 *   npm run build:icons
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SVG_PATH = path.join(PUBLIC, 'logo.svg');
const PNG_MASTER = path.join(PUBLIC, 'icon.png');

const SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

async function main() {
  // 延迟加载 sharp（CommonJS）
  let sharp;
  try {
    sharp = require('sharp');
  } catch (e) {
    console.error('✗ sharp 未安装，请先: npm install --save-dev sharp png-to-ico');
    process.exit(1);
  }

  // 延迟加载 png-to-ico（v3 是 ESM，必须 dynamic import）
  let pngToIco;
  try {
    const mod = await import('png-to-ico');
    pngToIco = mod.default || mod;
  } catch (e) {
    console.error('✗ png-to-ico 未安装，请先: npm install --save-dev sharp png-to-ico');
    process.exit(1);
  }

  console.log('▸ Vorzai Logo 图标生成器');
  console.log(`  源: ${SVG_PATH}`);
  console.log(`  输出目录: ${PUBLIC}\n`);

  // ─── 1. 把 SVG 渲染为 1024x1024 PNG（主图标）───
  let masterBuffer;
  if (fs.existsSync(SVG_PATH)) {
    console.log('[1/4] SVG → 1024x1024 PNG ...');
    masterBuffer = await sharp(fs.readFileSync(SVG_PATH), { density: 300 })
      .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    fs.writeFileSync(PNG_MASTER, masterBuffer);
    console.log(`  ✓ ${PNG_MASTER} (${(masterBuffer.length / 1024).toFixed(1)} KB)`);
  } else if (fs.existsSync(PNG_MASTER)) {
    console.log('[1/4] 使用现有 1024x1024 主图标');
    masterBuffer = fs.readFileSync(PNG_MASTER);
  } else {
    console.error('✗ 找不到 logo.svg 或 icon.png');
    process.exit(1);
  }

  // ─── 2. 生成多尺寸 PNG ───
  console.log('\n[2/4] 生成多尺寸 PNG ...');
  for (const size of SIZES) {
    const out = path.join(PUBLIC, `icon-${size}.png`);
    const buf = await sharp(masterBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(out, buf);
    console.log(`  ✓ icon-${size}.png (${(buf.length / 1024).toFixed(1)} KB)`);
  }

  // ─── 3. 生成 Windows .ico（多尺寸：16/32/48/64/128/256）───
  console.log('\n[3/4] 生成 Windows .ico (多尺寸 16/32/48/64/128/256) ...');
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoBuffers = await Promise.all(
    icoSizes.map((size) =>
      sharp(masterBuffer)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );
  // png-to-ico v3 接受 buffer 数组
  const icoBuffer = await pngToIco(icoBuffers);
  const icoPath = path.join(PUBLIC, 'icon.ico');
  fs.writeFileSync(icoPath, icoBuffer);
  console.log(`  ✓ icon.ico (${(icoBuffer.length / 1024).toFixed(1)} KB, 6 尺寸)`);

  // ─── 4. 同步拷贝到 build/（electron-builder 默认查找位置）───
  const buildDir = path.join(ROOT, 'build');
  if (fs.existsSync(buildDir)) {
    fs.copyFileSync(PNG_MASTER, path.join(buildDir, 'icon.png'));
    fs.copyFileSync(icoPath, path.join(buildDir, 'icon.ico'));
    console.log(`\n[4/4] 同步至 build/`);
  } else {
    console.log(`\n[4/4] build/ 不存在，跳过同步（不影响运行）`);
  }

  console.log('\n✅ 全部图标生成完毕');
}

main().catch((err) => {
  console.error('✗ 生成失败:', err);
  process.exit(1);
});
