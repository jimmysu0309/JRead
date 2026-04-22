#!/usr/bin/env node
// 用 Playwright + JRead Design System 的 logomark 規格（#2b6cb0 圓角方塊 + 白色 serif J）
// 生成 Chrome Extension 需要的 icon 尺寸。跑完放在 jread/assets/icons/。
//
//   node tools/generate-icons.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'jread', 'assets', 'icons');

// manifest 需要 16/32/48/128；另外加一張 store-assets/ 的 128（Chrome Web Store listing）
const SIZES = [16, 32, 48, 128];

// logomark 比例（取自 popup：28px 方塊、radius 6、font-size 18、padding-right 2）
// radius/N = 6/28 ≈ 0.214
// font-size/N = 18/28 ≈ 0.643
// padding-right/N = 2/28 ≈ 0.071
const R_RATIO   = 0.214;
const FS_RATIO  = 0.643;
const PAD_RATIO = 0.071;

function iconHtml(N) {
  const radius = Math.max(2, Math.round(N * R_RATIO));
  const fontSize = Math.round(N * FS_RATIO);
  const pad = Math.max(0, Math.round(N * PAD_RATIO));

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: transparent; }
    .icon {
      width: ${N}px;
      height: ${N}px;
      background: #2b6cb0;
      border-radius: ${radius}px;
      display: grid;
      place-items: center;
      font-family: "Noto Serif TC", "Songti TC", Georgia, "Times New Roman", serif;
      font-weight: 600;
      color: #ffffff;
      line-height: 1;
      letter-spacing: -0.02em;
      box-sizing: border-box;
      -webkit-font-smoothing: antialiased;
    }
    .glyph {
      font-size: ${fontSize}px;
      padding-right: ${pad}px;
      display: block;
    }
  </style></head><body>
    <div class="icon"><span class="glyph">J</span></div>
  </body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: 1
  });
  const page = await ctx.newPage();

  for (const N of SIZES) {
    await page.setContent(iconHtml(N), { waitUntil: 'networkidle' });
    const el = await page.$('.icon');
    const out = path.join(OUT, `icon-${N}.png`);
    await el.screenshot({ path: out, omitBackground: true });
    console.log(`[OK] icon-${N}.png`);
  }

  // 另外給 Chrome Web Store listing 用：複製 128 到 store-assets/
  const storeOut = path.join(ROOT, 'store-assets', 'icon-128-store.png');
  fs.copyFileSync(path.join(OUT, 'icon-128.png'), storeOut);
  console.log(`[OK] store-assets/icon-128-store.png`);

  await browser.close();
})();
