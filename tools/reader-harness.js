#!/usr/bin/env node
// JRead — Reader 整合 harness（v1.0.22）
// -----------------------------------------------------------------------------
// 在真實 Chromium 載入 unpacked extension，開 article.html?id=test，**stub
// Readwise fetch**（不需 token / 網路）回一篇假文章，驗證：
//   A. enterFromContainer → finalizeEnter → styler 真的套到合成 container
//      （data-jread-active / injected <style id="__jread-style"> / reader card）
//   B. 即時重套：改 storage.sync.theme → styler 經 onChanged 重套（頁面底色變）
//   C. 位置記憶：捲動 → reload → 回到原位置（spaRouteKey 以 article.html?id= 為 key）
//
// 用法：node tools/reader-harness.js [--keep]
// -----------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const PROJECT_ROOT = path.join(__dirname, '..');
const EXT_PATH = path.join(PROJECT_ROOT, 'jread');
const PROFILE_DIR = '/tmp/jread-reader-harness-profile';
const OUT_DIR = path.join(PROJECT_ROOT, '.playwright-mcp');
const KEEP = process.argv.includes('--keep');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 假文章：多段落 + 標題 + 圖（data: SVG，離線可渲染）+ 夠長以利捲動測試。
const PARAS = Array.from({ length: 30 }, (_, i) =>
  `<p>這是第 ${i + 1} 段內文，用來測試 JRead 閱讀版型與閱讀位置記憶是否正確套用在 Readwise Reader 文章上。Lorem ipsum dolor sit amet ${i}.</p>`
).join('');
const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="%23888"/><text x="300" y="160" font-size="40" fill="white" text-anchor="middle">IMG</text></svg>'
);
const FAKE_DOC = {
  id: 'test',
  title: 'Reader 整合測試文章',
  author: 'Harness',
  site_name: 'JRead Test',
  word_count: 1234,
  published_date: '2026-06-27T00:00:00Z',
  source_url: 'https://example.com/test',
  html_content: `<h2>第一節</h2>${PARAS.slice(0, PARAS.length / 2)}<figure><img src="${IMG}"><figcaption>圖說</figcaption></figure><h2>第二節</h2>${PARAS.slice(PARAS.length / 2)}`
};

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  // 每次清 profile，避免上一輪 readingPositions / 設定殘留
  try { fs.rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch (_) {}

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1100, height: 900 },
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run', '--no-default-browser-check',
      '--window-position=-2400,-2400', '--headless=new'
    ]
  });

  let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
  if (!sw) { console.error('SW 未啟動'); process.exit(1); }
  const extId = new URL(sw.url()).host;
  console.log('ext id:', extId);

  // 設 token（stub 不檢查、但 reader-article 會 gate）+ 預設主題
  await sw.evaluate(() => chrome.storage.sync.set({ readwiseToken: 'test-token', theme: 'light', fontSize: 18, contentWidth: 720 }));
  await sw.evaluate(() => chrome.storage.local.remove('readingPositions'));

  for (const p of ctx.pages()) { try { await p.close(); } catch (_) {} }
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  page.on('console', m => { const t = m.text(); if (/JRead|error|Error/.test(t)) console.log('PAGE', m.type(), t.slice(0, 200)); });

  // 多篇文件給 feed 模式（list 無 id）。單篇文件給文章模式（list 帶 id）。
  const FEED_DOCS = Array.from({ length: 12 }, (_, i) => ({
    id: 'doc' + i, title: `收件匣文章 ${i + 1}`, author: '作者' + i,
    site_name: '來源站', word_count: 100 + i,
    image_url: i % 2 ? IMG : undefined
  }));

  // stub fetch：攔 readwise list（依有無 id 回單篇/多篇）+ update（archive PATCH）；其餘照舊
  await page.addInitScript(({ doc, feed }) => {
    const real = window.fetch;
    window.fetch = async (url, opts) => {
      const u = typeof url === 'string' ? url : (url && url.url) || '';
      if (u.includes('readwise.io/api/v3/update/')) {
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (u.includes('readwise.io/api/v3/list/')) {
        const results = /[?&]id=/.test(u) ? [doc] : feed;
        return new Response(JSON.stringify({ count: results.length, nextPageCursor: null, results }),
          { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return real(url, opts);
    };
  }, { doc: FAKE_DOC, feed: FEED_DOCS });

  const url = `chrome-extension://${extId}/reader/article.html?id=test`;
  console.log('nav', url);
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await sleep(1500);

  // ---- A. styler 套用 ----
  const A = await page.evaluate(() => {
    const art = document.querySelector('[data-jread-active="1"]');
    const styleEl = document.getElementById('__jread-style');
    const h1 = document.querySelector('article h1');
    const imgs = document.querySelectorAll('article img');
    return {
      active: !!art,
      hasStyle: !!(styleEl && styleEl.textContent.length > 0),
      title: h1 && h1.textContent,
      imgCount: imgs.length,
      bodyBg: getComputedStyle(document.body).backgroundColor
    };
  });
  console.log('A styler:', JSON.stringify(A));

  await page.evaluate(() => { document.body.style.zoom = '0.5'; });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT_DIR, 'reader-article-light.png'), fullPage: true });
  await page.evaluate(() => { document.body.style.zoom = ''; });

  // ---- B. 即時重套：改主題 ----
  await sw.evaluate(() => chrome.storage.sync.set({ theme: 'sepia' }));
  await sleep(800); // onChanged + scheduleReapply 200ms debounce
  const B = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  console.log('B reapply sepia bodyBg:', B, '(light was', A.bodyBg + ')');
  await page.evaluate(() => { document.body.style.zoom = '0.5'; });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT_DIR, 'reader-article-sepia.png'), fullPage: true });
  await page.evaluate(() => { document.body.style.zoom = ''; });

  // ---- C. 位置記憶：捲動 → reload → 回到原位 ----
  await page.evaluate(() => { const s = document.scrollingElement || document.documentElement; s.scrollTop = Math.round(s.scrollHeight * 0.5); });
  await sleep(1400); // 等 position-memory debounce(1s) 寫入
  const beforeTop = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
  await page.reload({ waitUntil: 'load' });
  await sleep(2000); // 等 re-enter + restore + reassert
  const afterTop = await page.evaluate(() => (document.scrollingElement || document.documentElement).scrollTop);
  const restored = afterTop > beforeTop * 0.5;
  console.log(`C position memory: before=${beforeTop} after=${afterTop} restored=${restored}`);

  // ---- D. feed 頁：卡片渲染 + archive 移除 ----
  const feedUrl = `chrome-extension://${extId}/reader/reader.html`;
  await page.goto(feedUrl, { waitUntil: 'load', timeout: 30000 });
  await sleep(1200);
  const dBefore = await page.evaluate(() => document.querySelectorAll('.jr-card').length);
  // 點第一張卡的封存鈕
  await page.evaluate(() => { const b = document.querySelector('.jr-card .jr-archive'); if (b) b.click(); });
  await sleep(900);
  const dAfter = await page.evaluate(() => document.querySelectorAll('.jr-card').length);
  const firstLinkHref = await page.evaluate(() => { const a = document.querySelector('.jr-card .jr-card-link'); return a && a.getAttribute('href'); });
  const feedOk = dBefore === 10 && dAfter === 9 && /^article\.html\?id=/.test(firstLinkHref || '');
  console.log(`D feed: cards before=${dBefore} after archive=${dAfter} firstHref=${firstLinkHref}`);
  await page.evaluate(() => { document.body.style.zoom = '0.5'; });
  await sleep(300);
  await page.screenshot({ path: path.join(OUT_DIR, 'reader-feed.png'), fullPage: true });

  console.log('\n結果：');
  console.log(`  A styler 套用：${A.active && A.hasStyle ? 'PASS' : 'FAIL'}（active=${A.active} style=${A.hasStyle} title="${A.title}" imgs=${A.imgCount}）`);
  console.log(`  B 即時重套主題：${B !== A.bodyBg ? 'PASS' : 'FAIL'}（${A.bodyBg} → ${B}）`);
  console.log(`  C 位置記憶：${restored ? 'PASS' : 'FAIL'}（${beforeTop} → ${afterTop}）`);
  console.log(`  D feed 渲染 + archive：${feedOk ? 'PASS' : 'FAIL'}（10 篇上限、archive 後剩 9、卡片連 article.html?id=）`);
  console.log(`  截圖：${OUT_DIR}/reader-article-{light,sepia}.png、reader-feed.png`);

  if (!KEEP) await ctx.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
