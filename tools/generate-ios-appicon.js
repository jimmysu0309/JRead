#!/usr/bin/env node
// 生成 iOS / iPadOS / macOS（iOS-on-Mac）home screen 用的 AppIcon（1024×1024）。
// 跟 Chrome 工具列 icon（tools/generate-icons.js）規格不同的兩個關鍵點：
//
//   1. 全出血（full-bleed）：品牌藍 #2b6cb0 必須填滿整個 1024 畫布、不留白邊。
//      iOS 會對 app icon 自己套 squircle 圓角遮罩——若來源圖自帶白邊 + 自帶
//      圓角，遮罩後會看到「白框 + 雙重圓角」（Jimmy 2026-06-09 home screen
//      回報）。app icon 來源一律滿版方形、圓角交給系統。
//   2. 不透明（no alpha）：app icon 不可含透明像素（透明會被系統合成成黑/白
//      邊）。body 同樣鋪藍底、screenshot 不 omitBackground，輸出純不透明。
//
// 品牌字面與顏色沿用 popup logomark / Chrome icon 同一份規格（單一資料源）：
// #2b6cb0 底 + 白色 serif J，font-size 0.643×N、letter-spacing -0.02em、
// padding-right 0.071×N。差別只在「滿版方形、無 border-radius」。
//
//   node tools/generate-ios-appicon.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(
  ROOT,
  'safari-app', 'JRead-iOS', 'JRead', 'Assets.xcassets',
  'AppIcon.appiconset', 'universal-icon-1024@1x.png'
);

const N = 1024;
const BG = '#2b6cb0';          // 品牌藍（與 generate-icons.js / popup 同一份）
const FS_RATIO  = 0.643;       // font-size / N
const PAD_RATIO = 0.071;       // padding-right / N（serif J 視覺置中微調）

function iconHtml(n) {
  const fontSize = Math.round(n * FS_RATIO);
  const pad = Math.max(0, Math.round(n * PAD_RATIO));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; background: ${BG}; }
    .icon {
      width: ${n}px;
      height: ${n}px;
      background: ${BG};
      /* 無 border-radius：圓角交給 iOS 系統 squircle 遮罩 */
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
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: N, height: N },
    deviceScaleFactor: 1
  });
  const page = await ctx.newPage();
  await page.setContent(iconHtml(N), { waitUntil: 'networkidle' });
  const el = await page.$('.icon');
  // omitBackground: false（預設）→ 輸出不透明（app icon 不可含 alpha）
  await el.screenshot({ path: OUT, omitBackground: false });
  console.log(`[OK] ${path.relative(ROOT, OUT)}（full-bleed, opaque）`);
  await browser.close();
})();
