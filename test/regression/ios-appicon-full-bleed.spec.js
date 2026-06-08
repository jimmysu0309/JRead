// JRead — iOS AppIcon 全出血 forcing function（v0.8.1）
//
// 背景：home screen app icon 來源圖（AppIcon.appiconset/universal-icon-1024@1x.png）
// 若自帶白邊 + 自帶圓角，iOS 會在其上再套 squircle 遮罩 → 使用者看到「白框 +
// 雙重圓角」（Jimmy 2026-06-09 iPhone home screen 回報）。app icon 來源必須是
// 滿版方形不透明圖、圓角交給系統。
//
// 這條驗「來源圖滿版且不透明」這一層：
//   - 1024×1024
//   - 不含 alpha 通道（colorType 不是 4/6）——app icon 不可有透明像素
//   - 四角像素都是品牌藍 #2b6cb0（= 滿版出血，沒有白邊）
// 不驗「字面設計 / 視覺美感」（那是 Claude Design / 肉眼）——本層只擋「白框 /
// 留白 / 透明」這類整合層回歸。重生來源：tools/generate-ios-appicon.js。
//
// sanity：把來源圖換回有白邊的舊圖（或 colorType 6）→ 四角非藍 / 有 alpha → fail。

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

const REPO_ROOT = path.join(__dirname, '..', '..');
const APPICON = path.join(
  REPO_ROOT, 'safari-app', 'JRead-iOS', 'JRead', 'Assets.xcassets',
  'AppIcon.appiconset', 'universal-icon-1024@1x.png'
);

const BRAND = { r: 43, g: 108, b: 176 }; // #2b6cb0
const TOL = 12;                          // 抗 antialiasing / 重壓縮微差

// 純 node PNG 解碼（colorType 2 = RGB / bitDepth 8）：讀 IHDR、串接 IDAT、
// inflate、套 PNG filter 還原成 raw RGB，回傳取色函式。
function decodePng(file) {
  const buf = fs.readFileSync(file);
  assert.strictEqual(buf.toString('ascii', 1, 4), 'PNG', `${file} 不是合法 PNG`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf.readUInt8(24);
  const colorType = buf.readUInt8(25);
  let off = 8;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') idat.push(buf.slice(off + 8, off + 8 + len));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return { width, height, bitDepth, colorType, idat: Buffer.concat(idat) };
}

// 套 PNG filter（None/Sub/Up/Average/Paeth）還原 RGB raw，回 (x,y)->{r,g,b}
function unfilterRGB(meta) {
  const { width, height, idat } = meta;
  const bpp = 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(idat);
  const out = Buffer.alloc(height * stride);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let i = 0; i < stride; i++) {
      const rawByte = raw[pos++];
      const a = i >= bpp ? out[y * stride + i - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = (y > 0 && i >= bpp) ? out[(y - 1) * stride + i - bpp] : 0;
      let val;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: val = rawByte + paeth(a, b, c); break;
        default: throw new Error(`未知 PNG filter ${filter}`);
      }
      out[y * stride + i] = val & 0xff;
    }
  }
  return (x, yy) => {
    const idx = yy * stride + x * bpp;
    return { r: out[idx], g: out[idx + 1], b: out[idx + 2] };
  };
}

function isBrand(px) {
  return Math.abs(px.r - BRAND.r) <= TOL
    && Math.abs(px.g - BRAND.g) <= TOL
    && Math.abs(px.b - BRAND.b) <= TOL;
}

describe('iOS AppIcon 全出血（home screen 無白框）', () => {
  const meta = decodePng(APPICON);

  it('必須是 1024×1024', () => {
    assert.strictEqual(meta.width, 1024);
    assert.strictEqual(meta.height, 1024);
  });

  it('不可含 alpha 通道（app icon 不允許透明像素）', () => {
    assert.ok(
      meta.colorType !== 4 && meta.colorType !== 6,
      `AppIcon colorType=${meta.colorType} 含 alpha——app icon 須不透明，透明區會被系統合成成黑/白邊`
    );
  });

  it('四角像素必須是品牌藍 #2b6cb0（滿版出血、無白邊）', () => {
    const at = unfilterRGB(meta);
    const W = meta.width - 1, H = meta.height - 1;
    const corners = {
      'top-left': at(0, 0),
      'top-right': at(W, 0),
      'bottom-left': at(0, H),
      'bottom-right': at(W, H),
    };
    for (const [name, px] of Object.entries(corners)) {
      assert.ok(
        isBrand(px),
        `${name} 角為 rgb(${px.r},${px.g},${px.b})，非品牌藍——代表有白框/留白（iOS squircle 遮罩後會露白邊）`
      );
    }
  });
});
