#!/usr/bin/env node
// JRead 自動化除錯 harness
// -----------------------------------------------------------------------------
// 用 Playwright 的 bundled Chromium 以 persistent context 載入 unpacked extension，
// 打開目標頁 → 透過 SW 觸發閱讀模式 → 讀 DOM / 算 gap / 截圖。
//
// 重點理解：content script 的 window.__JRead 在 isolated world，
// page.evaluate 預設在 page main world 執行——兩者互相看不到 JS 變數。
// 因此所有「進閱讀模式」動作一律走 SW → chrome.tabs.sendMessage 觸發 content script；
// 驗證則限定在 shared DOM 的副作用（data-* attribute、injected <style>、
// 元素 getBoundingClientRect 等）。
//
// 用法：
//   node tools/debug-harness.js                      # 預設 URL
//   JREAD_URL=https://example.com node tools/debug-harness.js
//   node tools/debug-harness.js --fresh              # 清 profile 後啟動
//   node tools/debug-harness.js --keep               # 跑完不關瀏覽器（方便肉眼驗證）
// -----------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const PROJECT_ROOT = path.join(__dirname, '..');
const EXT_PATH = path.join(PROJECT_ROOT, 'jread');
const PROFILE_DIR = '/tmp/jread-pw-profile';
const SCREENSHOT_OUT = path.join(PROJECT_ROOT, '.playwright-mcp', 'jread-viewport.png');

const URL = process.env.JREAD_URL || 'https://www.chinatalk.media/p/best-books-q1-2026';
const FRESH = process.argv.includes('--fresh');
const KEEP = process.argv.includes('--keep');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  if (FRESH) fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chromium',          // 必須：用 bundled Chromium，才能載 unpacked extension
    headless: false,              // 必須：extension 僅 headed 模式可用
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check'
    ]
  });

  // 等 SW 起來
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null);
  if (!sw) { console.error('service worker 未啟動'); process.exit(1); }
  console.log('sw:', sw.url());
  sw.on('console', m => console.log('SW', m.type(), m.text().slice(0, 300)));

  // extension 載入前 Chromium 已經開了 about:blank，那個 tab 不會有 content script，
  // 關掉重開
  for (const p of ctx.pages()) { try { await p.close(); } catch {} }
  const page = await ctx.newPage();
  page.on('console', m => {
    const t = m.text();
    if (/SUBSTACK|░/.test(t)) return; // 噪音過濾
    console.log('PAGE', m.type(), t.slice(0, 200));
  });
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

  console.log('nav', URL);
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await sleep(2500); // 等 content script 於 document_idle 注入

  // 找 tab id
  const tabId = await sw.evaluate(async (u) => {
    const ts = await chrome.tabs.query({});
    return (ts.find(t => t.url === u) || ts.find(t => t.url && !t.url.startsWith('chrome')))?.id;
  }, URL);
  console.log('tabId:', tabId);

  // 透過 SW 觸發 content script 的 TOGGLE_READER_MODE
  const toggle = await sw.evaluate(async (id) => {
    try {
      const res = await chrome.tabs.sendMessage(id, { type: 'TOGGLE_READER_MODE' });
      return { ok: true, res };
    } catch (e) {
      return { ok: false, err: e.message };
    }
  }, tabId);
  console.log('toggle:', toggle);

  await sleep(1200);

  // DOM 驗證（shared with page）
  const state = await page.evaluate(() => {
    const art = document.querySelector('[data-jread-active="1"]');
    return {
      articleFound: !!art,
      articleTag: art && art.tagName,
      articlePreview: art && (art.textContent || '').trim().slice(0, 80),
      htmlHasJreadClass: document.documentElement.classList.contains('__jread-active'),
      jreadStyleInjected: !!document.getElementById('__jread-style'),
      jreadStyleLen: document.getElementById('__jread-style')?.textContent.length || 0
    };
  });
  console.log('DOM state:', state);

  if (!state.articleFound) {
    console.log('reader mode not active — saving screenshot for inspection');
  } else {
    // 若有 JREAD_FIND 環境變數，scroll 到文字命中該關鍵字的第一個元素附近
    const findTarget = process.env.JREAD_FIND;
    await page.evaluate((needle) => {
      const art = document.querySelector('[data-jread-active="1"]');
      if (!art) return;
      let target = null;
      if (needle) {
        for (const el of art.querySelectorAll('p, h1, h2, h3, h4, h5, h6')) {
          if ((el.textContent || '').includes(needle)) { target = el; break; }
        }
      }
      if (!target) target = art.querySelector('img');
      if (!target) return;
      window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top - 100);
    }, findTarget);
    await sleep(400);

    // gap 診斷：相鄰區塊元素間的實際垂直距離 > 40px 視為「可疑留白」
    const gaps = await page.evaluate(() => {
      const art = document.querySelector('[data-jread-active="1"]');
      if (!art) return [];
      const sel = 'p, h1, h2, h3, h4, h5, h6, figure, blockquote, ul, ol, pre, img, picture, video';
      const items = [];
      for (const el of art.querySelectorAll(sel)) {
        if (el.dataset.jreadHidden === '1') continue;
        if (items.length && items[items.length - 1].el.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.height < 5) continue;
        items.push({ el, tag: el.tagName, top: r.top, bottom: r.top + r.height, text: (el.textContent || '').trim().slice(0, 30) });
      }
      const out = [];
      for (let i = 1; i < items.length; i++) {
        const g = items[i].top - items[i - 1].bottom;
        if (g > 40) {
          out.push({ gap: Math.round(g),
            prev: `${items[i-1].tag} "${items[i-1].text}" bot=${Math.round(items[i-1].bottom)}`,
            next: `${items[i].tag} "${items[i].text}" top=${Math.round(items[i].top)}` });
        }
        if (out.length >= 8) break;
      }
      return out;
    });
    console.log('gaps:', JSON.stringify(gaps, null, 2));
  }

  fs.mkdirSync(path.dirname(SCREENSHOT_OUT), { recursive: true });
  await page.screenshot({ path: SCREENSHOT_OUT });
  console.log('saved', SCREENSHOT_OUT);

  if (!KEEP) await ctx.close();
  else console.log('--keep, leaving open');
})().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
