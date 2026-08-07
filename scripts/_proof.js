const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const PUBLIC = path.join(__dirname, '..', 'public');
const OUT = path.join(__dirname, '..', '.logo-proof');
fs.mkdirSync(OUT, { recursive: true });

const buf = (n) => fs.readFileSync(path.join(PUBLIC, n));
const sizes = [16, 32, 48, 64, 128, 256];
// map size -> which file (small uses simple variant)
const fileFor = (s) => (s <= 48 ? `icon-${s}.png` : `icon-${s}.png`);

async function row(files, baseY, bg) {
  let x = 30;
  const items = [];
  for (const f of files) {
    const b = buf(f);
    items.push({ input: b, left: x, top: baseY });
    // advance by icon width + gap
    x += 24 + 28; // icon drawn at 24px display? we keep native; use 24 step
  }
  return items;
}

async function sheet(name, bgColor, rowA, rowB, rowBfiles) {
  const W = 1000, H = 360;
  const base = await sharp({ create: { width: W, height: H, channels: 4, background: bgColor } }).png().toBuffer();
  const comps = [];
  // row A at y=40
  let x = 40;
  for (const s of rowA) {
    const b = await sharp(buf(fileFor(s))).resize(s, s).png().toBuffer();
    comps.push({ input: b, left: x, top: 40 });
    x += s + 36;
  }
  // row B at y=200
  x = 40;
  for (const f of rowBfiles) {
    const b = await sharp(buf(f)).resize(64, 64).png().toBuffer();
    comps.push({ input: b, left: x, top: 200 });
    x += 64 + 36;
  }
  const out = await sharp(base).composite(comps).png().toBuffer();
  fs.writeFileSync(path.join(OUT, name), out);
  console.log('wrote', name);
}

(async () => {
  await sheet('proof-light.png', { r: 241, g: 245, b: 249, alpha: 1 }, sizes, [], ['logo-dark.png', 'logo-mono.png', 'logo-dark-512.png']);
  await sheet('proof-dark.png', { r: 15, g: 23, b: 42, alpha: 1 }, sizes, [], ['logo-dark.png', 'logo-mono-light.png', 'logo-dark-512.png']);
})();
