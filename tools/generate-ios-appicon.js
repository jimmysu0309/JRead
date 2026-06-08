#!/usr/bin/env node
// 生成 iOS / iPadOS / macOS（iOS-on-Mac）home screen 用的 AppIcon（1024×1024）。
//
// 來源：docs/icon-512.png（Claude Design 品牌 badge——品牌藍圓角方塊 + 白色
// serif J，透明背景）。直接拿來當 app icon 會有兩個問題：
//   1. 圓角是透明的——iOS 對 app icon 再套 squircle 遮罩前會把透明合成成
//      黑/白邊（Jimmy 2026-06-09 home screen 白框回報的同型態）。
//   2. app icon 不可含 alpha。
// 修法（full-bleed composite）：badge 的方形「直邊」本來就頂到畫布邊緣
//   （opaque bbox = 滿版 512²，只有四個圓角是透明），所以把 badge 疊在一張
//   滿版品牌藍底上 → 透明圓角被同色藍填滿 → 滿版出血、不透明、圓角交給 iOS。
//   藍底色 = #2b6cb0（與 badge 方塊同色，實測 rgb 43,108,176，blue-on-blue
//   無縫）。J 字面沿用 Claude Design 原稿、不重繪。
//
//   node tools/generate-ios-appicon.js

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'icon-512.png');
const OUT = path.join(
  ROOT,
  'safari-app', 'JRead-iOS', 'JRead', 'Assets.xcassets',
  'AppIcon.appiconset', 'universal-icon-1024@1x.png'
);

const N = 1024;
const BG = '#2b6cb0'; // 品牌藍（= badge 方塊色，填滿圓角透明區用）

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error(`ERROR: 來源不存在 ${SRC}`);
    process.exit(1);
  }
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: N, height: N },
    deviceScaleFactor: 1
  });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0}</style>
    <canvas id="c" width="${N}" height="${N}"></canvas>`);

  await page.evaluate(async ({ src, n, bg }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.getElementById('c');
    const x = c.getContext('2d');
    // 1. 滿版品牌藍底（填掉 badge 透明圓角 → full-bleed）
    x.fillStyle = bg;
    x.fillRect(0, 0, n, n);
    // 2. badge 疊上（512 → 1024 high-quality 放大；直邊頂邊、圓角藍底透出）
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, n, n);
  }, { src: dataUrl, n: N, bg: BG });

  const el = await page.$('#c');
  // omitBackground:false → 不透明輸出（app icon 不可含 alpha）
  await el.screenshot({ path: OUT, omitBackground: false });
  console.log(`[OK] ${path.relative(ROOT, OUT)}（來源 docs/icon-512.png，full-bleed, opaque）`);
  await browser.close();
})();
