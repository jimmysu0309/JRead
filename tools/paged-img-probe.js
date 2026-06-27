#!/usr/bin/env node
// Probe：翻頁模式下「靠後頁面的圖片是否載入」。真實 imgproxy 遠端圖 + 大量文字
// 撐成多頁，pagedMode=true，載入後檢查每張圖 complete/naturalWidth，並逐頁翻過去
// 再檢查。對照組：捲動模式（pagedMode=false）。
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const EXT_PATH = path.join(__dirname, '..', 'jread');
const PROFILE_DIR = '/tmp/jread-paged-probe-profile';
const PAGED = !process.argv.includes('--scroll');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 真實 imgproxy 圖（取自 sspai HiDPI 文）。每張各放一段、中間塞大量文字撐多頁。
const IMG_URLS = [
  'https://imgproxy.readwise.io/?url=https%3A//cdnfile.sspai.com/2026/06/19/86b2e144caa1d31046bd1fd3aea9f1af.png%3FimageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp&hash=a0381e971f72712c3eebcd1cee94e4a2&referer=https://sspai.com',
  'https://imgproxy.readwise.io/?url=https%3A//cdnfile.sspai.com/2026/06/19/ce88d3c81de7225faec2ccbf5e4355da.png%3FimageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp&hash=bbad9091e08ff0e02b8e4dd1a96442d1&referer=https://sspai.com',
  'https://imgproxy.readwise.io/?url=https%3A//cdnfile.sspai.com/2026/06/19/4cd4f612e4a286f332d3ccaa3a096eca.png%3FimageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp&hash=649e006d587be3533d51cd67b2e5cfa7&referer=https://sspai.com',
  'https://imgproxy.readwise.io/?url=https%3A//cdnfile.sspai.com/2026/06/19/e38bc2be768d562033fb5b38a2ce34b0.jpg%3FimageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp&hash=868c7009b0ecf18ccd33b30e99651f2c&referer=https://sspai.com',
  'https://imgproxy.readwise.io/?url=https%3A//cdnfile.sspai.com/2026/06/19/7c8f133f0372bab22e6e5f0c38698846.png%3FimageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp&hash=d2b709b007d38efb8b26abb72e4d554a&referer=https://sspai.com',
  'https://imgproxy.readwise.io/?url=https%3A//cdnfile.sspai.com/2026/06/19/a6f2a82128350d07dcdb16ea4eaf1a4e.png%3FimageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp&hash=c83cd58522a7402c9636bfecca0d2456&referer=https://sspai.com',
  'https://imgproxy.readwise.io/?url=https%3A//cdnfile.sspai.com/2026/06/19/ec181a3059b8ce79e07bd010b361139b.jpg%3FimageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp&hash=0b7dcebfa9e04ee22365eab7c9580845&referer=https://sspai.com',
  'https://imgproxy.readwise.io/?url=https%3A//cdnfile.sspai.com/2026/06/19/6cab13f1bffa3f2a51ebb906098eed10.png%3FimageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp&hash=be79f82fb10f0a5b1445d1a965bc476a&referer=https://sspai.com',
  'https://imgproxy.readwise.io/?url=https%3A//cdnfile.sspai.com/2026/06/19/d384b774a3300e5552479afa6e65c2cd.jpg%3FimageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp&hash=99d33f03e62ad2ec31623beb3e8c33e1&referer=https://sspai.com',
  'https://imgproxy.readwise.io/?url=https%3A//cdnfile.sspai.com/2026/06/22/3a5c29e9bc0ed6ff8af8de8bbd5e0059.png%3FimageView2/2/w/1120/q/90/interlace/1/ignore-error/1/format/webp&hash=2566afcd6cee8e846bdcc268bce2979c&referer=https://sspai.com'
];
const LOREM = '<p>這是一段用來撐版面的內文，讓圖片分散到不同頁面。Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. 段落要夠長才能把後面的圖推到後面的翻頁欄位。</p>';
let body = '';
IMG_URLS.forEach((u, i) => {
  body += `<h3>第 ${i + 1} 節</h3>` + LOREM.repeat(4) + `<figure><img src="${u}"><figcaption>圖 ${i + 1}</figcaption></figure>` + LOREM.repeat(3);
});
const DOC = { id: 'test', title: '翻頁圖片載入 probe', author: 'probe', site_name: 'probe', html_content: body };

(async () => {
  try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (_) {}
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chromium', headless: false, viewport: { width: 430, height: 850 },
    args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`, '--no-first-run', '--window-position=-2400,-2400', '--headless=new']
  });
  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
  const extId = new URL(sw.url()).host;
  // 等 onInstalled 寫完預設值再覆寫（否則 readwiseToken 被預設 '' 蓋掉），set→readback 重試
  let back = {};
  for (let t = 0; t < 6; t++) {
    await sleep(700);
    await sw.evaluate((p) => chrome.storage.sync.set({ readwiseToken: 'test-token', theme: 'light', pagedMode: p, contentWidth: 720, fontSize: 18 }), PAGED);
    back = await sw.evaluate(() => chrome.storage.sync.get(['readwiseToken', 'pagedMode']));
    if (back && back.readwiseToken === 'test-token') break;
  }
  await sw.evaluate(() => chrome.storage.local.remove('readingPositions'));
  console.log('storage readback:', JSON.stringify(back));

  for (const p of ctx.pages()) { try { await p.close(); } catch (_) {} }
  const page = await ctx.newPage();
  await page.addInitScript((doc) => {
    const real = window.fetch;
    window.fetch = async (u, o) => {
      const s = typeof u === 'string' ? u : (u && u.url) || '';
      if (s.includes('readwise.io/api/v3/list/')) return new Response(JSON.stringify({ results: [doc] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return real(u, o);
    };
  }, DOC);

  await page.goto(`chrome-extension://${extId}/reader/article.html?id=test`, { waitUntil: 'load', timeout: 30000 });
  console.log('mode:', PAGED ? 'PAGED' : 'SCROLL');
  await sleep(4000); // 等圖片有機會載入

  const env = await page.evaluate(() => ({
    active: !!document.querySelector('[data-jread-active="1"]'),
    article: !!document.querySelector('article'),
    imgs: document.querySelectorAll('img').length,
    status: (document.getElementById('jr-status') || {}).textContent || null
  }));
  console.log('env:', JSON.stringify(env));

  const imgStat = async (label) => {
    const s = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.map((im, i) => ({ i, loaded: im.complete && im.naturalWidth > 0, nw: im.naturalWidth }));
    });
    const loaded = s.filter(x => x.loaded).length;
    console.log(`${label}: ${loaded}/${s.length} loaded — per-img: ` + s.map(x => x.loaded ? '✓' : '✗').join(''));
    return s;
  };
  await imgStat('initial (no flip)');

  if (PAGED) {
    // 翻到最後一頁再檢查（模擬使用者翻到後面）
    const total = await page.evaluate(() => {
      const NS = window.__JRead; // isolated world 看不到——改量 scroll 容器
      const se = document.scrollingElement || document.documentElement;
      return null;
    });
    // 直接把 paged 容器 scrollLeft 推到底、逐步推進觸發任何 lazy
    await page.evaluate(async () => {
      const card = document.querySelector('[data-jread-active="1"]') || document.querySelector('article');
      const scroller = card && (card.scrollWidth > card.clientWidth ? card : (document.scrollingElement || document.documentElement));
      if (!scroller) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      for (let x = 0; x <= max; x += scroller.clientWidth) { scroller.scrollLeft = x; await new Promise(r => setTimeout(r, 250)); }
      scroller.scrollLeft = max;
    });
    await sleep(3000);
    await imgStat('after flipping to end');
  } else {
    await page.evaluate(async () => {
      const se = document.scrollingElement || document.documentElement;
      const max = se.scrollHeight - se.clientHeight;
      for (let y = 0; y <= max; y += se.clientHeight) { se.scrollTop = y; await new Promise(r => setTimeout(r, 250)); }
    });
    await sleep(3000);
    await imgStat('after scrolling to end');
  }
  await ctx.close();
})().catch(e => { console.error(e); process.exit(1); });
