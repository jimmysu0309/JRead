#!/usr/bin/env node
// 生成 iOS / iPadOS / macOS（iOS-on-Mac）home screen 用的 AppIcon（1024×1024）。
//
// v2.2.13：來源改成向量原稿 safari-app/JRead-iOS/icon-source/app-icon-<name>.svg
// （Claude Design 畫布「JRead App Icon」匯出，原稿存於 claude design/JRead App Icon/）。
// 舊版拿 docs/icon-512.png（512 點陣）放大兩倍當 1024 → 字邊糊。
// 向量幾何是從 icon-512.png 逐像素反推的（Jimmy 2026-10-28）：J = Georgia Bold，
// 字級 798.4 / 1024、原點 (315.4, 819.2)，與原稿 IoU 0.996。滿版方形不透明——
// 圓角交給 iOS 遮罩（app icon 不可含 alpha，透明圓角會被 iOS 合成成黑 / 白邊）。
//
// 產出：
//   blue  → AppIcon.appiconset/universal-icon-1024@1x.png（主圖示）
//   white → AppIcon-White.appiconset/universal-icon-1024@1x.png（替代圖示，
//           設定頁「App 圖示」切換；ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES 登記）
//
// 字型：SVG 用系統 Georgia（macOS 內建）。Georgia 缺席時瀏覽器會默默換字型，
// 這裡先量 J 的寬度比對 fallback，缺字型直接中止，不產出錯的圖示。
//
//   node tools/generate-ios-appicon.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'safari-app', 'JRead-iOS', 'icon-source');
const XCASSETS = path.join(ROOT, 'safari-app', 'JRead-iOS', 'JRead', 'Assets.xcassets');
const N = 1024;

const ICONS = [
  { src: 'app-icon-blue.svg', set: 'AppIcon.appiconset' },
  { src: 'app-icon-white.svg', set: 'AppIcon-White.appiconset' }
];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: N, height: N }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();

  await page.setContent('<!doctype html><canvas id="m" width="10" height="10"></canvas>');
  const hasGeorgia = await page.evaluate(() => {
    const x = document.getElementById('m').getContext('2d');
    x.font = '700 400px Georgia, monospace';
    const a = x.measureText('J').width;
    x.font = '700 400px monospace';
    return Math.abs(a - x.measureText('J').width) > 1;
  });
  if (!hasGeorgia) {
    console.error('ERROR: 系統沒有 Georgia 字型，產出的 J 會是錯的字型。請在 macOS 上跑');
    process.exit(1);
  }

  for (const icon of ICONS) {
    const svgPath = path.join(SRC_DIR, icon.src);
    if (!fs.existsSync(svgPath)) {
      console.error(`ERROR: 來源不存在 ${svgPath}`);
      process.exit(1);
    }
    const svg = fs.readFileSync(svgPath, 'utf8');
    await page.setContent(`<!doctype html><meta charset="utf-8">
      <style>html,body{margin:0;padding:0}svg{display:block}</style>${svg}`);
    const out = path.join(XCASSETS, icon.set, 'universal-icon-1024@1x.png');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // omitBackground:false → 不透明輸出（app icon 不可含 alpha）
    await (await page.$('svg')).screenshot({ path: out, omitBackground: false });
    console.log(`[OK] ${path.relative(ROOT, out)}（來源 icon-source/${icon.src}）`);
  }
  await browser.close();
})();
