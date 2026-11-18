#!/usr/bin/env node
// JRead — 翻頁模式 probe（Playwright WebKit / Chromium，免載 extension）
//
// Playwright WebKit 不能載 extension，Safari 軌的翻頁 bug 一直是每次臨時寫 probe、
// 用完即丟（v2.4.3 / v2.4.5 / v2.4.7 / v2.4.8 四輪）。這支把做法固定下來：
//   1. addInitScript 塞 chrome / browser API stub（storage 依 defaults merge、
//      runtime.onMessage 收 listener）
//   2. 依 manifest content_scripts 順序 addScriptTag 注入 main world
//   3. 對收到的 listener 呼叫 { type: 'TOGGLE_READER_MODE' } 進場（debug bridge 的
//      enter 要經 SW，stub 下不通）
//   4. 輸出「翻頁版面指紋」JSON ＋ 逐頁截圖（zoom 1.0，ArrowRight 真翻頁）
//
// 用法：
//   node tools/webkit-paged-probe.js --url <URL> [選項]
//   node tools/webkit-paged-probe.js --html <快照檔> [--url <當 base 的 URL>] [選項]
//
// 選項：
//   --engine webkit|chromium   預設 webkit
//   --ext <dir>                要注入的 jread/ 目錄（預設 repo 的 jread/；比對舊版時指向
//                              `git archive <rev> jread` 解出來的副本）
//   --viewports 1440x900,1280x720,430x850   預設這三種（vh 類結構要掃視窗高，v2.4.7 教訓）
//   --out <dir>                輸出目錄（預設 .playwright-mcp/paged-probe）
//   --label <name>             輸出檔名前綴（預設由 URL / 檔名推）
//   --set k=v                  覆寫設定（可重複；值走 JSON.parse，失敗當字串）
//   --wait <ms>                進場後等多久才量（預設 4500＝蓋過 1s / 3s 兩個重測計時器）
//   --exit                     量完後退出閱讀模式，另記 inline style 與進場前的差異
//   --no-shots                 不截圖（只要 JSON）
//   --after <module.js>        量完指紋後跑自訂步驟：module.exports = async (page, { sleep, toggle }) => 結果，
//                              結果記在 JSON 的 after 欄位（編輯模式點掉元素再退出這類流程；
//                              content script 在 main world，頁內可直接用 window.__JRead）
//   --snapshot <out.html>      不進閱讀模式：載入 URL 後存成可回放的快照（拿掉 script、
//                              CSSOM 動態插入的規則寫回 <style>、補 <base>），給 --html 用
//
// JSON 欄位（同一頁同一視窗，兩個版本的輸出可直接 diff）：
//   pages        頁碼指示器的總頁數
//   inline       主文內每個帶 style 屬性的元素：DOM 路徑 → style.cssText（寫入日誌）
//   blocks       主文內區塊 / 媒體元素：路徑、所在欄、頂端 y、碎片數、碎片總高
//   imgs         每張圖：欄號、碎片數（> 1＝被跨頁切開）、碎片總高
//   exit         （--exit）退出後 inline style 與進場前不同的元素
//   fonts        量測當下 document.fonts 已載入的字型（內嵌字型由 jread/assets/fonts/ 供應）
//
// 這條驗 X、不驗 Y：
//   驗——翻頁模式在 WebKit / Chromium 引擎下的版面結果（哪些元素被寫了什麼 inline
//        樣式、每個區塊落在第幾頁、圖有沒有被切）與退出後的還原
//   不驗——(a) 正式版 Safari：Playwright WebKit 是 trunk build，v2.2.6（Safari 27 多要
//        12px 餘裕）與 v2.4.9 都是它重現不出來的，綠燈不可當 Safari 綠
//        (b) extension 真實載入路徑（isolated world、SW、storage 事件）——那層歸
//        debug-harness；這裡 content script 跑在 main world，可能與站方全域撞名
//        (c) 手勢 / scrubber / 位置記憶
'use strict';

const path = require('path');
const fs = require('fs');
const pw = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(name);

const ENGINE = argOf('--engine', 'webkit');
const EXT_DIR = path.resolve(argOf('--ext', path.join(__dirname, '..', 'jread')));
const HTML_FILE = argOf('--html', null);
const URL_ARG = argOf('--url', null);
const SNAPSHOT_OUT = argOf('--snapshot', null);
const OUT_DIR = path.resolve(argOf('--out', path.join(__dirname, '..', '.playwright-mcp', 'paged-probe')));
const WAIT_MS = parseInt(argOf('--wait', '4500'), 10);
const DO_EXIT = has('--exit');
const NO_SHOTS = has('--no-shots');
const AFTER_MODULE = argOf('--after', null);
const MAX_SHOT_PAGES = 40;
const VIEWPORTS = argOf('--viewports', '1440x900,1280x720,430x850').split(',').map((s) => {
  const [w, h] = s.trim().split('x').map((n) => parseInt(n, 10));
  return { width: w, height: h };
});
const PAGE_URL = URL_ARG || (HTML_FILE ? 'https://paged-probe.local/' : null);
if (!PAGE_URL || (ENGINE !== 'webkit' && ENGINE !== 'chromium')) {
  console.error('用法：node tools/webkit-paged-probe.js (--url <URL> | --html <檔案>) [--engine webkit|chromium] …（見檔頭）');
  process.exit(2);
}
const LABEL = argOf('--label', (HTML_FILE ? path.basename(HTML_FILE).replace(/\.[^.]+$/, '') : new URL(PAGE_URL).hostname)
  .replace(/[^a-zA-Z0-9_.-]+/g, '_'));

const SETTINGS = { pagedMode: true };
argv.forEach((a, i) => {
  if (a !== '--set' || !argv[i + 1]) return;
  const kv = argv[i + 1];
  const eq = kv.indexOf('=');
  if (eq < 1) return;
  let v = kv.slice(eq + 1);
  try { v = JSON.parse(v); } catch (_) { /* 當字串 */ }
  SETTINGS[kv.slice(0, eq)] = v;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
const CONTENT_SCRIPTS = manifest.content_scripts[0].js;

// chrome / browser API stub——在頁面任何 script 之前就位。getURL 的 scheme 是
// namespace.js 判斷平台的訊號：WebKit 軌給 safari-web-extension:// 讓 Safari 分支照走
function installStub(cfg) {
  const sync = Object.assign({}, cfg.settings);
  const local = {};
  const listeners = [];
  const changed = [];
  const pick = (store, keys) => {
    if (keys == null) return Object.assign({}, store);
    if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
    if (Array.isArray(keys)) {
      const o = {};
      for (const k of keys) if (k in store) o[k] = store[k];
      return o;
    }
    const o = Object.assign({}, keys);
    for (const k of Object.keys(keys)) if (k in store) o[k] = store[k];
    return o;
  };
  const area = (store, name) => ({
    get: (keys, cb) => { const r = pick(store, keys); if (typeof cb === 'function') { cb(r); return undefined; } return Promise.resolve(r); },
    set: (obj, cb) => {
      const delta = {};
      for (const k of Object.keys(obj || {})) { delta[k] = { oldValue: store[k], newValue: obj[k] }; store[k] = obj[k]; }
      for (const fn of changed) { try { fn(delta, name); } catch (_) { /* */ } }
      if (typeof cb === 'function') { cb(); return undefined; }
      return Promise.resolve();
    },
    remove: (keys, cb) => {
      for (const k of [].concat(keys || [])) delete store[k];
      if (typeof cb === 'function') { cb(); return undefined; }
      return Promise.resolve();
    },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; return Promise.resolve(); }
  });
  const noopEvent = { addListener() {}, removeListener() {}, hasListener() { return false; } };
  const api = {
    runtime: {
      id: 'paged-probe',
      // 內嵌字型：stub 的擴充網址載不到檔案，導到下面 page.route 接的假主機（否則量到的是
      // fallback 的 Georgia、比 Source Serif 窄約 7%——v2.5.10 的 rect 表因此漏掉實機斷字）
      getURL: (p) => (/assets\/fonts\//.test(String(p))
        ? 'https://jread-fonts.local/' + String(p).split('/').pop()
        : cfg.extBase + String(p || '').replace(/^\//, '')),
      getManifest: () => cfg.manifest,
      sendMessage: () => Promise.resolve(undefined),
      sendNativeMessage: () => Promise.resolve(undefined),
      connect: () => ({ postMessage() {}, disconnect() {}, onMessage: noopEvent, onDisconnect: noopEvent }),
      onMessage: { addListener: (fn) => listeners.push(fn), removeListener() {}, hasListener() { return false; } },
      reload() {}
    },
    storage: {
      sync: area(sync, 'sync'),
      local: area(local, 'local'),
      onChanged: {
        addListener: (fn) => changed.push(fn),
        removeListener: (fn) => { const i = changed.indexOf(fn); if (i >= 0) changed.splice(i, 1); },
        hasListener: () => false
      }
    }
  };
  try { Object.defineProperty(window, 'chrome', { value: api, configurable: true, writable: true }); } catch (_) { window.chrome = api; }
  try { Object.defineProperty(window, 'browser', { value: api, configurable: true, writable: true }); } catch (_) { window.browser = api; }
  // 進 / 出閱讀模式：對 content script 註冊的 listener 送 TOGGLE_READER_MODE
  window.__pagedProbeToggle = () => new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    for (const fn of listeners) {
      try { fn({ type: 'TOGGLE_READER_MODE' }, {}, finish); } catch (e) { finish({ error: String(e) }); }
    }
    setTimeout(() => finish({ error: 'TOGGLE_TIMEOUT', listeners: listeners.length }), 15000);
  });
}

// 頁內：存可回放快照
function serializeSnapshot() {
  // CSSOM 動態插入的規則（styled-components / emotion 的 insertRule）不在 textContent 內
  for (const st of document.querySelectorAll('style')) {
    try {
      if (!st.textContent.trim() && st.sheet && st.sheet.cssRules.length) {
        st.textContent = Array.from(st.sheet.cssRules).map((r) => r.cssText).join('\n');
      }
    } catch (_) { /* */ }
  }
  const clone = document.documentElement.cloneNode(true);
  for (const el of clone.querySelectorAll('script, noscript, link[rel="preload"], link[rel="modulepreload"], iframe')) el.remove();
  for (const el of clone.querySelectorAll('*')) {
    for (const a of Array.from(el.attributes)) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
  }
  // 圖的實際來源寫回 src（lazy loader 被拿掉後才載得到）
  const live = document.querySelectorAll('img');
  const copies = clone.querySelectorAll('img');
  live.forEach((im, i) => {
    const c = copies[i];
    if (!c) return;
    if (im.currentSrc) { c.setAttribute('src', im.currentSrc); c.removeAttribute('srcset'); c.removeAttribute('sizes'); }
    c.removeAttribute('loading');
  });
  const head = clone.querySelector('head');
  if (head && !head.querySelector('base')) {
    const base = document.createElement('base');
    base.setAttribute('href', location.href);
    head.insertBefore(base, head.firstChild);
  }
  return '<!doctype html>\n' + clone.outerHTML;
}

// 頁內：翻頁版面指紋。量測前 scrollLeft 歸零（WebKit 對已捲動狀態的 fragment rect 會偏）
function collectFingerprint() {
  const art = document.querySelector('[data-jread-active]');
  const ind = document.getElementById('__jread-page-indicator');
  const out = { active: !!art, indicator: ind ? ind.textContent.trim() : null, pages: 0, inline: {}, blocks: [], imgs: [] };
  if (!art) return out;
  const m = /(\d+)\s*\/\s*(\d+)/.exec(out.indicator || '');
  out.pages = m ? parseInt(m[2], 10) : 0;
  const pathOf = (el) => {
    const parts = [];
    for (let n = el; n && n !== art; n = n.parentElement) {
      let i = 1;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) i++;
      parts.unshift(n.tagName.toLowerCase() + ':' + i);
    }
    return parts.join('>') || '(art)';
  };
  const prev = art.scrollLeft;
  art.scrollLeft = 0;
  const cs = getComputedStyle(art);
  const r0 = art.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft) || 0;
  const padR = parseFloat(cs.paddingRight) || 0;
  const bL = parseFloat(cs.borderLeftWidth) || 0;
  const bR = parseFloat(cs.borderRightWidth) || 0;
  const stride = r0.width - padL - padR - bL - bR + (parseFloat(cs.columnGap) || 0);
  const left0 = r0.left + bL + padL;
  const colOf = (x) => (stride > 0 ? Math.floor((x - left0 + 1) / stride) : 0);
  const r1 = (n) => Math.round(n * 10) / 10;
  out.card = { w: r1(r0.width), h: r1(r0.height), stride: r1(stride) };
  out.inline['(art)'] = art.style.cssText;
  for (const el of art.querySelectorAll('[style]')) {
    if (el.style.cssText) out.inline[pathOf(el)] = el.style.cssText;
  }
  for (const el of art.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, figure, figcaption, blockquote, pre, table, img, video, iframe, svg')) {
    const rects = el.getClientRects();
    if (!rects.length) continue;
    let h = 0;
    for (const r of rects) h += r.height;
    if (!(h > 0)) continue;
    const row = { path: pathOf(el), col: colOf(rects[0].left), top: r1(rects[0].top), frags: rects.length, h: r1(h) };
    out.blocks.push(row);
    if (el.tagName === 'IMG' && h >= 60) {
      out.imgs.push({ path: row.path, col: row.col, top: row.top, frags: row.frags, h: row.h, w: r1(rects[0].width), loaded: el.complete && el.naturalWidth > 0 });
    }
  }
  art.scrollLeft = prev;
  return out;
}

// 頁內：全文件 inline style 快照（進場前 / 退出後比對用）。元素參照存 window 上，
// 退出後同一批元素再讀一次
function snapshotInlineBefore() {
  const els = Array.from(document.querySelectorAll('body, body *'));
  window.__pagedProbeEls = els;
  window.__pagedProbeBefore = els.map((el) => el.getAttribute('style') || '');
  return els.length;
}
function diffInlineAfter() {
  const els = window.__pagedProbeEls || [];
  const before = window.__pagedProbeBefore || [];
  const diffs = [];
  const desc = (el) => {
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 6; n = n.parentElement) {
      let i = 1;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) i++;
      parts.unshift(n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + ':' + i);
    }
    return parts.join('>');
  };
  els.forEach((el, i) => {
    if (!el.isConnected) return;
    const now = el.getAttribute('style') || '';
    const norm = (s) => s.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
    if (norm(now) !== norm(before[i])) diffs.push({ el: desc(el), before: before[i], after: now });
  });
  return { active: !!document.querySelector('[data-jread-active]'), diffs };
}

async function runViewport(browser, vp) {
  const tag = `${LABEL}-${ENGINE}-${vp.width}x${vp.height}`;
  const ctx = await browser.newContext({ viewport: vp, bypassCSP: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).slice(0, 300)));
  await page.addInitScript(installStub, {
    settings: SETTINGS,
    manifest,
    extBase: ENGINE === 'webkit' ? 'safari-web-extension://paged-probe/' : 'chrome-extension://paged-probe/'
  });
  await page.route((u) => u.hostname === 'jread-fonts.local', (route) => {
    const f = path.join(EXT_DIR, 'assets', 'fonts', path.basename(new URL(route.request().url()).pathname));
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'font/woff2', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(f) });
  });
  if (HTML_FILE) {
    const html = fs.readFileSync(path.resolve(HTML_FILE), 'utf8');
    // 只攔主文件；快照內的相對資源照 <base> / PAGE_URL 走網路
    await page.route((u) => u.href === PAGE_URL, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  }
  await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 60000 }).catch((e) => console.log(`[${tag}] goto: ${String(e.message).split('\n')[0]}`));
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await sleep(800);

  if (SNAPSHOT_OUT) {
    const html = await page.evaluate(serializeSnapshot);
    fs.mkdirSync(path.dirname(path.resolve(SNAPSHOT_OUT)), { recursive: true });
    fs.writeFileSync(path.resolve(SNAPSHOT_OUT), html);
    console.log(`[${tag}] 快照已存：${path.resolve(SNAPSHOT_OUT)}（${html.length} chars）`);
    await ctx.close();
    return null;
  }

  if (DO_EXIT) await page.evaluate(snapshotInlineBefore);
  for (const rel of CONTENT_SCRIPTS) await page.addScriptTag({ path: path.join(EXT_DIR, rel) });
  const toggled = await page.evaluate(() => window.__pagedProbeToggle());
  await sleep(WAIT_MS);
  const fp = await page.evaluate(collectFingerprint);
  // 實際載入的字型（字寬 / 斷行類量測的前提；空陣列＝內嵌字型沒載到、數字不可信）
  fp.fonts = await page.evaluate(() => Array.from(document.fonts).filter((f) => f.status === 'loaded')
    .map((f) => `${f.family.replace(/["']/g, '')} ${f.weight} ${f.style}`).filter((v, i, a) => a.indexOf(v) === i).sort());
  fp.meta = { url: PAGE_URL, html: HTML_FILE, engine: ENGINE, viewport: vp, ext: EXT_DIR, version: manifest.version, toggled, settings: SETTINGS };

  if (!NO_SHOTS && fp.active) {
    const n = Math.min(fp.pages || 1, MAX_SHOT_PAGES);
    for (let i = 1; i <= n; i++) {
      await page.screenshot({ path: path.join(OUT_DIR, `${tag}-page-${String(i).padStart(2, '0')}.png`) });
      if (i < n) { await page.keyboard.press('ArrowRight'); await sleep(450); }
    }
    if ((fp.pages || 1) > MAX_SHOT_PAGES) console.log(`[${tag}] ⚠️ 共 ${fp.pages} 頁，只截前 ${MAX_SHOT_PAGES} 頁`);
    if (n > 1) await page.keyboard.press('Home');
    await sleep(300);
  }
  if (AFTER_MODULE && fp.active) {
    const toggle = () => page.evaluate(() => window.__pagedProbeToggle());
    try { fp.after = await require(path.resolve(AFTER_MODULE))(page, { sleep, toggle }); } catch (e) { fp.after = { error: String(e && e.message || e) }; }
    console.log(`[${tag}] after: ${JSON.stringify(fp.after)}`);
  }
  if (DO_EXIT && fp.active && !AFTER_MODULE) {
    await page.evaluate(() => window.__pagedProbeToggle());
    await sleep(900);
    fp.exit = await page.evaluate(diffInlineAfter);
  }
  fp.pageErrors = errors.slice(0, 10);
  fs.writeFileSync(path.join(OUT_DIR, `${tag}.json`), JSON.stringify(fp, null, 1));
  const cut = fp.imgs.filter((im) => im.frags > 1).length;
  console.log(`[${tag}] active=${fp.active} pages=${fp.pages} inline=${Object.keys(fp.inline).length} blocks=${fp.blocks.length} imgs=${fp.imgs.length}（被切 ${cut}）` +
    (fp.exit ? ` exit: active=${fp.exit.active} 殘留差異=${fp.exit.diffs.length}` : '') +
    (errors.length ? ` pageErrors=${errors.length}` : ''));
  console.log(`[${tag}] fonts=${fp.fonts.length ? fp.fonts.join(' | ') : '（沒有載入任何字型——字寬數字不可信）'}`);
  await ctx.close();
  return fp;
}

// 整體期限 + 心跳檔（tools/watchdog.js）：卡住時自動中止（exit 124），不再無限等待。
require(path.join(__dirname, 'watchdog.js')).install({ name: 'webkit-paged-probe', limitSec: 600 });

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await pw[ENGINE].launch({ headless: true });
  try {
    for (const vp of (SNAPSHOT_OUT ? VIEWPORTS.slice(0, 1) : VIEWPORTS)) {
      try { await runViewport(browser, vp); } catch (e) { console.log(`[${LABEL}-${ENGINE}-${vp.width}x${vp.height}] 失敗：${String(e && e.message || e).split('\n')[0]}`); }
    }
  } finally {
    await browser.close();
  }
})();
