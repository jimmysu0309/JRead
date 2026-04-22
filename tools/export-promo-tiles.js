#!/usr/bin/env node
// 一次性：把 Claude Design 匯出的 4 張 promo tile HTML 截成精確尺寸的 PNG。
// 跑完檔案落在 store-assets/ 下。一次性工具，跑完可刪除。
//
//   node tools/export-promo-tiles.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'store-assets', 'sources');
const OUT = path.join(ROOT, 'store-assets');

const JOBS = [
  { html: path.join(SRC, 'promo-440x280-a.html'),     selector: '.tile',    w: 440,  h: 280, out: path.join(OUT, 'promo-440x280-a.png') },
  { html: path.join(SRC, 'promo-440x280-b.html'),     selector: '.tile',    w: 440,  h: 280, out: path.join(OUT, 'promo-440x280-b.png') },
  { html: path.join(SRC, 'marquee-1400x560-main.html'), selector: '.marquee', w: 1400, h: 560, out: path.join(OUT, 'marquee-1400x560-main.png') },
  { html: path.join(SRC, 'marquee-1400x560-alt.html'),  selector: '.marquee', w: 1400, h: 560, out: path.join(OUT, 'marquee-1400x560-alt.png') }
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 700 },
    deviceScaleFactor: 1
  });
  const page = await ctx.newPage();

  for (const job of JOBS) {
    const url = 'file://' + job.html;
    await page.goto(url, { waitUntil: 'networkidle' });
    const node = await page.$(job.selector);
    if (!node) {
      console.error(`[FAIL] selector ${job.selector} not found in ${job.html}`);
      continue;
    }
    const box = await node.boundingBox();
    if (!box || Math.round(box.width) !== job.w || Math.round(box.height) !== job.h) {
      console.error(`[WARN] ${path.basename(job.out)} got ${box?.width}×${box?.height}, expected ${job.w}×${job.h}`);
    }
    await node.screenshot({ path: job.out, omitBackground: false });
    console.log(`[OK]  ${path.basename(job.out)} ${job.w}×${job.h}`);
  }

  await browser.close();
})();
