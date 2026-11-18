#!/usr/bin/env node
// JRead — Article View 閱讀進度寫回的 HTTP 請求清單 rig（假 Readwise）
//
// v2.5.6 / v2.5.10 兩輪都為了「這個操作到底會不會多送一筆進度」臨時重建，v2.5.12 收進來。
//
// 用法：
//   node tools/readwise-request-rig.js [--ext <jread 目錄>] [--label <名稱>] [--cells a,b]
//        [--modes scroll,paged] [--rounds N] [--port 18443] [--out <file.json>]
//   比對兩版：各跑一次（--ext 指向舊版副本、--label 與 --port 各自不同），對 out JSON 的 requests 欄
//
// 安全：Chromium 以 --host-resolver-rules="MAP * 127.0.0.1:<port>" 把**所有**主機名解析到本機
// 假伺服器（自簽憑證＋--ignore-certificate-errors），沒有任何連線能離開本機；token 是假的。
// Chromium 自己的 Google 背景連線也會被導進來（只記錄，不是外洩）。
//
// 這條驗 X、不驗 Y：
//   驗——Chromium 載擴充、Article View、CDP 真觸控下，假伺服器實際收到的請求（方法 / 路徑 / body）
//   不驗——iOS Safari 實機、WebKit、Instapaper 路徑、真 Readwise 的時序與回應內容
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { execFileSync } = require('child_process');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const EXT = path.resolve(arg('ext', path.join(__dirname, '..', 'jread')));
const LABEL = arg('label', 'x');
const ROUNDS = parseInt(arg('rounds', '1'), 10);
const MODES = arg('modes', 'scroll,paged').split(',');
const ONLY = arg('cells', '') ? arg('cells').split(',') : null;
const WORK = path.join(os.tmpdir(), 'jread-readwise-rig');
fs.mkdirSync(WORK, { recursive: true });
const OUT = arg('out', path.join(WORK, `out-${LABEL}.json`));
const PORT = parseInt(arg('port', '18443'), 10);
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DOC_ID = 'fakedoc0001';
const TOKEN = 'FAKE_TOKEN_RIG_NOT_REAL';

function ensureCert() {
  const dir = path.join(WORK, 'cert');
  const key = path.join(dir, 'key.pem'), crt = path.join(dir, 'crt.pem');
  if (!fs.existsSync(crt)) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '2', '-subj', '/CN=readwise.io'], { stdio: 'ignore' });
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}
function articleHtml() {
  let h = '<h1>rig synthetic article</h1>';
  for (let i = 0; i < 140; i++) h += `<p id="p${i}">段落 ${i}：這是一段合成的測試文字，用來把文章撐到夠長，讓翻頁模式有二十幾頁、捲動模式有上萬像素可以捲。The quick brown fox jumps over the lazy dog, again and again, paragraph ${i}.</p>`;
  return h;
}
const reqLog = [];
let tlsErrors = 0;
function startServer() {
  const doc = () => ({
    id: DOC_ID, url: 'https://read.readwise.io/read/' + DOC_ID, source_url: 'https://example.invalid/a', title: 'rig synthetic article',
    author: 'rig', category: 'article', location: 'new', tags: {}, word_count: 4000, reading_progress: 0.3,
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-10T00:00:00Z', saved_at: '2026-11-01T00:00:00Z', parent_id: null
  });
  const srv = https.createServer(ensureCert(), (req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'https://x');
      const rec = { t: Date.now(), host: req.headers.host, method: req.method, path: u.pathname, query: u.search, body: body.slice(0, 300), auth: req.headers.authorization || '' };
      reqLog.push(rec);
      const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'OPTIONS') return json(204, {});
      if (!/(^|\.)readwise\.io(:\d+)?$/.test(String(req.headers.host || ''))) return json(418, { rig: 'unexpected host' });
      if (u.pathname === '/api/v3/list/') {
        const d = doc();
        if (u.searchParams.get('withHtmlContent') === 'true') d.html_content = articleHtml();
        if (u.searchParams.get('id') && u.searchParams.get('id') !== DOC_ID) return json(200, { count: 0, nextPageCursor: null, results: [] });
        return json(200, { count: 1, nextPageCursor: null, results: [d] });
      }
      if (u.pathname.startsWith('/api/v3/update/')) return json(200, { id: DOC_ID, url: 'https://read.readwise.io/read/' + DOC_ID });
      if (u.pathname === '/api/v2/export/') return json(200, { count: 0, nextPageCursor: null, results: [] });
      if (u.pathname === '/api/v2/auth/') { res.writeHead(204); return res.end(); }
      return json(404, { rig: 'no route' });
    });
  });
  srv.on('tlsClientError', () => { tlsErrors++; });
  return new Promise((r) => srv.listen(PORT, '127.0.0.1', () => r(srv)));
}

// 整體期限 + 心跳檔（tools/watchdog.js）：卡住時自動中止（exit 124），不再無限等待。
require(path.join(__dirname, 'watchdog.js')).install({ name: 'readwise-request-rig', limitSec: 600 });

(async () => {
  const srv = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `jread-rig-${LABEL}-`));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: false, viewport: { width: 430, height: 850 }, hasTouch: true, deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check',
      '--window-position=-2400,-2400', '--headless=new',
      `--host-resolver-rules=MAP * 127.0.0.1:${PORT}`, '--ignore-certificate-errors',
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-pings', '--disable-domain-reliability', '--disable-quic',
      '--disable-features=OptimizationHints,MediaRouter,DialMediaRouteProvider'
    ]
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
  const extId = new URL(sw.url()).host;
  const page = ctx.pages()[0] || await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const ARTICLE = `chrome-extension://${extId}/reader/article.html?id=${DOC_ID}`;
  const pos = () => page.evaluate(() => {
    const NS = window.__JRead; const pm = NS && NS.pagedMode;
    const p = pm && pm.isInstalled && pm.isInstalled() ? pm.getPosition() : null;
    const se = document.scrollingElement;
    return { paged: !!p, idx: p ? p.idx : null, total: p ? p.total : null, top: se ? Math.round(se.scrollTop) : null, max: se ? se.scrollHeight - window.innerHeight : null };
  }).catch(() => null);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });

  async function open(paged) {
    await page.goto('about:blank');
    await sw.evaluate(async (s) => { await chrome.storage.local.clear(); await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); },
      { readwiseToken: TOKEN, storageService: 'readwise', pagedMode: paged });
    reqLog.length = 0;
    await page.goto(ARTICLE, { waitUntil: 'load' });
    // 等還原套用：捲動模式 scrollTop 被搬離 0；翻頁模式頁碼離開 0
    const t0 = Date.now();
    for (;;) {
      const p = await pos();
      if (p && (paged ? (p.paged && p.idx > 0) : (!p.paged && p.top > 200))) return { restoredAt: Date.now(), p };
      if (Date.now() - t0 > 15000) throw new Error('還原逾時 ' + JSON.stringify(p));
      await sleep(15);
    }
  }
  async function exitEsc() {
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape');
      try { await page.waitForURL(/reader\.html/, { timeout: 2500 }); return i + 1; } catch (_) { /* 再按一次（長按選單等先吃掉 ESC） */ }
    }
    return 0;
  }
  const floatRect = () => page.evaluate(() => { const h = document.getElementById('__jread-floating-host'); if (!h) return null; const b = (h.shadowRoot && h.shadowRoot.querySelector('button, [role=button], div')) || h; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; });

  const CELLS = {
    // ---- 觸控（還原後 0.1 秒起手）----
    'touch-drag-long': async (paged, r) => {
      const samples = []; let x = paged ? 380 : 215, y = paged ? 425 : 720;
      await sleep(Math.max(0, r.restoredAt + 100 - Date.now()));
      await touch('touchStart', x, y);
      while (Date.now() - r.restoredAt < 1900) { if (paged) x = Math.max(40, x - 5); else y = Math.max(60, y - 8); await touch('touchMove', x, y); const p = await pos(); samples.push([Date.now() - r.restoredAt, paged ? p.idx : p.top]); await sleep(30); }
      await touch('touchEnd');
      await sleep(700);
      return { samples };
    },
    'touch-fling': async (paged, r) => {
      let x = paged ? 380 : 215, y = paged ? 425 : 700;
      await sleep(Math.max(0, r.restoredAt + 100 - Date.now()));
      await touch('touchStart', x, y);
      for (let i = 0; i < 6; i++) { if (paged) x -= 50; else y -= 55; await touch('touchMove', x, y); await sleep(16); }
      await touch('touchEnd');
      await sleep(2200);
    },
    'touch-tap': async (paged, r) => {
      await sleep(Math.max(0, r.restoredAt + 100 - Date.now()));
      await touch('touchStart', 215, 425); await sleep(40); await touch('touchEnd');
      await sleep(2000);
    },
    'touch-drag-on-icon': async (paged, r) => {
      const fr = await floatRect();
      if (!fr) return { note: '找不到浮動圖示' };
      let x = fr.x, y = fr.y;
      await sleep(Math.max(0, r.restoredAt + 100 - Date.now()));
      await touch('touchStart', x, y);
      while (Date.now() - r.restoredAt < 1900) { y -= 2; await touch('touchMove', x, y); await sleep(35); }
      await touch('touchEnd');
      await sleep(700);
      return { icon: fr };
    },
    'touch-hold': async (paged, r) => {
      await sleep(Math.max(0, r.restoredAt + 100 - Date.now()));
      await touch('touchStart', 215, 425); await sleep(1800); await touch('touchEnd');
      await sleep(700);
    },
    'touch-drag-out-back': async (paged, r) => {
      const samples = []; let x = paged ? 380 : 215, y = paged ? 425 : 700; const y0 = y, x0 = x;
      await sleep(Math.max(0, r.restoredAt + 100 - Date.now()));
      await touch('touchStart', x, y);
      while (Date.now() - r.restoredAt < 1000) { if (paged) x = Math.max(80, x - 10); else y = Math.max(400, y - 10); await touch('touchMove', x, y); const p = await pos(); samples.push([Date.now() - r.restoredAt, paged ? p.idx : p.top]); await sleep(30); }
      while (paged ? x < x0 : y < y0) { if (paged) x = Math.min(x0, x + 10); else y = Math.min(y0, y + 10); await touch('touchMove', x, y); const p = await pos(); samples.push([Date.now() - r.restoredAt, paged ? p.idx : p.top]); await sleep(30); }
      await sleep(150);
      await touch('touchEnd');
      await sleep(700);
      return { samples };
    },
    // ---- 鍵盤 / 滑鼠抽樣（還原後 2 秒才動作）----
    'kb-nothing': async () => { await sleep(2000); },
    'kb-x': async () => { await sleep(2000); await page.keyboard.press('x'); await sleep(500); },
    'kb-move': async (paged) => { await sleep(2000); if (paged) await page.keyboard.press('ArrowRight'); else { await page.mouse.move(215, 425); await page.mouse.wheel(0, 300); } await sleep(700); },
    'kb-move-back': async (paged) => {
      await sleep(2000);
      if (paged) { await page.keyboard.press('ArrowRight'); await sleep(500); await page.keyboard.press('ArrowLeft'); }
      else { await page.mouse.move(215, 425); await page.mouse.wheel(0, 300); await sleep(500); await page.mouse.wheel(0, -300); }
      await sleep(700);
    },
    'kb-switch-mode': async (paged) => { await sleep(2000); await sw.evaluate((v) => chrome.storage.sync.set({ pagedMode: v }), !paged); await sleep(2000); },
    // 切模式後按一個不移動位置的鍵（x）：切完停的頁碼 / 捲動位置不該被當成「使用者移動」
    'kb-switch-then-x': async (paged) => { await sleep(2000); await sw.evaluate((v) => chrome.storage.sync.set({ pagedMode: v }), !paged); await sleep(2000); await page.keyboard.press('x'); await sleep(500); },
    // 切模式後真的移動一步（翻一頁 / 滾 300px）：會送，送出的值應該接著切換前的位置
    'kb-switch-then-move': async (paged) => {
      await sleep(2000); await sw.evaluate((v) => chrome.storage.sync.set({ pagedMode: v }), !paged); await sleep(2000);
      if (!paged) await page.keyboard.press('ArrowRight'); else { await page.mouse.move(215, 425); await page.mouse.wheel(0, 300); }
      await sleep(700);
    },
    'kb-archive-E': async () => { await sleep(2000); await page.keyboard.press('e'); try { await page.waitForURL(/reader\.html/, { timeout: 4000 }); } catch (_) { /* 留在本頁 */ } await sleep(800); return { noEsc: true }; }
  };

  const results = [];
  const names = (ONLY || Object.keys(CELLS));
  // 前置確認：必然會送的情境（真的翻一頁 / 捲 300px 後 ESC）假伺服器收得到
  {
    const r = await open(true); await CELLS['kb-move'](true, r); await exitEsc(); await sleep(1200);
    const patches = reqLog.filter((q) => q.method === 'PATCH');
    const hosts = [...new Set(reqLog.map((q) => q.host))];
    console.log('[precheck] PATCH', JSON.stringify(patches.map((q) => q.body)), 'hosts', JSON.stringify(hosts), 'tlsErrors', tlsErrors);
    if (!patches.length) { console.error('前置確認失敗：假伺服器沒收到進度寫回'); await ctx.close(); srv.close(); process.exit(2); }
    // 瀏覽器自己的背景連線（google 帳號 / GCM）一樣被導到本機、只記錄；其他非 readwise 主機才停
    if (hosts.some((h) => !/(^|\.)readwise\.io$/.test(h) && !/(^|\.)(google|googleapis|gstatic|gvt1)\.com$/.test(h))) { console.error('出現非預期 host，停止', hosts); await ctx.close(); srv.close(); process.exit(3); }
  }
  const allHosts = new Set();
  for (let round = 1; round <= ROUNDS; round++) {
    for (const mode of MODES) {
      const paged = mode === 'paged';
      for (const name of names) {
        let row = { label: LABEL, round, mode, cell: name };
        try {
          const r = await open(paged);
          row.restored = paged ? `${r.p.idx}/${r.p.total}` : `${r.p.top}/${r.p.max}`;
          const extra = (await CELLS[name](paged, r)) || {};
          const before = await pos();
          row.beforeExit = before ? (before.paged ? `p${before.idx}/${before.total}` : `s${before.top}/${before.max}`) : null;
          if (!extra.noEsc) row.escPresses = await exitEsc();
          await sleep(1200);
          row.requests = reqLog.filter((q) => /(^|\.)readwise\.io$/.test(q.host) && q.method !== 'GET' && q.method !== 'OPTIONS').map((q) => `${q.method} ${q.path} ${q.body}`);
          reqLog.forEach((q) => allHosts.add(q.host));
          if (extra.samples) row.samples = extra.samples;
          if (extra.note) row.note = extra.note;
          if (extra.icon) row.icon = extra.icon;
        } catch (e) { row.error = String(e && e.message || e).slice(0, 200); }
        results.push(row);
        console.log(JSON.stringify(Object.assign({}, row, { samples: row.samples ? `(${row.samples.length} 筆)` : undefined })));
      }
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, ext: EXT, hosts: [...allHosts], tlsErrors, results }, null, 1));
  console.log('hosts:', [...allHosts], 'tlsErrors:', tlsErrors, '→', OUT);
  await ctx.close();
  srv.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* 留著無妨 */ }
})().catch((e) => { console.error('rig 失敗', e); process.exit(1); });
