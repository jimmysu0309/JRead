#!/usr/bin/env node
// Page Rounds harness — JRead 批次視覺驗收 Playwright 工具
// -----------------------------------------------------------------------------
// 對單一 URL 執行完整 A-F 視覺驗收流程，產出 5 組分頁截圖 + audit.json。
// Claude 用 Read tool 看截圖做視覺判定——截圖是主角，audit 是輔助信號。
//
// 用法：
//   JREAD_URL="https://udn.com/..." node tools/page-rounds-harness.js
//   node tools/page-rounds-harness.js --url "https://udn.com/..."
//   node tools/page-rounds-harness.js --keep    # 跑完不關瀏覽器
//
// 輸出：
//   docs/excluded/page-rounds/<hostname>_<path-hash>/
//     original-page-01.png   — 原頁面（reader mode 前）
//     light-page-01.png      — reader mode 亮色
//     delayed-page-01.png    — 5s 後（C7 延遲雜訊比對）
//     dark-page-01.png       — 暗色模式
//     restored-page-01.png   — 退出 reader mode 後
//     audit.json             — 輔助信號
// -----------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));

const crypto = require('crypto');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const EXT_PATH = path.join(PROJECT_ROOT, 'jread');

const NOISE_AUDIT_KEYWORDS = [
  '相關', '其他人', '推薦', '最新', '延伸', '查看原始', '看更多', '看原文',
  '加入', '訂閱', 'LINE 官方', 'LINE官方', '官方帳號', '粉絲專頁', '好友',
  'AI 摘要', 'AI摘要', '網友貼文',
  '轉發', '留言', '建立貼文', '熱門', '繼續看下去', '回覆',
  '廣告', '贊助', '業配',
  '登入', '註冊', '原始文章',
  '追蹤',
  'Google新聞', 'Google 新聞',
  '聽新聞', '聽書', '想成為', '玩問答', '拿課程', '抽獎', '免費領'
];

// ---- CLI 參數 ----
const urlArg = process.argv.find((a, i) => a === '--url' && process.argv[i + 1]);
const TARGET_URL = (urlArg ? process.argv[process.argv.indexOf('--url') + 1] : null)
  || process.env.JREAD_URL
  || 'https://www.chinatalk.media/p/best-books-q1-2026';
const KEEP = process.argv.includes('--keep');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
}

function outDirName(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const hash = crypto.createHash('md5').update(u.pathname).digest('hex').slice(0, 6);
    return `${host}_${hash}`;
  } catch { return 'unknown'; }
}

// ---- 分頁截圖 helper ----
async function takePagedScreenshots(page, outDir, prefix) {
  const info = await page.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight
  }));
  const step = Math.floor(info.viewportHeight * 0.9);
  const count = Math.max(1, Math.ceil(info.docHeight / step));
  const paths = [];
  for (let i = 0; i < count; i++) {
    await page.evaluate(y => window.scrollTo(0, y), i * step);
    await sleep(400);
    const p = path.join(outDir, `${prefix}-page-${String(i + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: p });
    paths.push(p);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  console.log(`  ${prefix}: ${count} pages`);
  return paths;
}

// ---- Residual audit（輔助信號）----
async function runResidualAudit(page, keywords) {
  return page.evaluate((kws) => {
    const art = document.querySelector('[data-jread-active="1"]');
    if (!art) return { error: 'no article', total: 0, warnings: [], items: [] };
    function isVisible(el) {
      let cur = el;
      while (cur) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
        const cs = window.getComputedStyle(cur);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (cur === document.body) break;
        cur = cur.parentElement;
      }
      return true;
    }
    function norm(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
    const items = [];
    for (const el of art.querySelectorAll('*')) {
      if (!isVisible(el)) continue;
      const tagUpper = el.tagName.toUpperCase();
      if (['TITLE', 'DESC', 'STYLE', 'SCRIPT', 'NOSCRIPT'].includes(tagUpper)) continue;
      const direct = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('');
      const text = norm(direct);
      if (!text || text.length > 60 || text.length < 2) continue;
      const hitKws = kws.filter(kw => text.includes(kw));
      items.push({ tag: el.tagName, text: text.slice(0, 60), hitKeywords: hitKws });
      if (items.length >= 200) break;
    }
    return { total: items.length, warnings: items.filter(i => i.hitKeywords.length > 0), items: items.slice(0, 60) };
  }, keywords);
}

// ---- Gap audit（輔助信號）----
async function runGapAudit(page) {
  return page.evaluate(() => {
    const art = document.querySelector('[data-jread-active="1"]');
    if (!art) return { error: 'no article', gaps: [], blockCount: 0 };
    function isVisible(el) {
      let cur = el;
      while (cur) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
        const cs = window.getComputedStyle(cur);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (cur === document.body) break;
        cur = cur.parentElement;
      }
      return true;
    }
    const blocks = [];
    for (const el of art.querySelectorAll('p, h1, h2, h3, h4, h5, h6, figure, img, ul, ol, blockquote, pre')) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      blocks.push({ top: r.top, bottom: r.bottom, tag: el.tagName,
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
    }
    blocks.sort((a, b) => a.top - b.top);
    const gaps = [];
    for (let i = 1; i < blocks.length; i++) {
      const gap = blocks[i].top - blocks[i - 1].bottom;
      if (gap >= 80) gaps.push({ gap: Math.round(gap), prev: `${blocks[i-1].tag} "${blocks[i-1].text}"`, next: `${blocks[i].tag} "${blocks[i].text}"` });
    }
    return { gaps, blockCount: blocks.length };
  });
}

// ---- Tail audit（文末元素 dump）----
async function runTailAudit(page) {
  return page.evaluate(() => {
    const art = document.querySelector('[data-jread-active="1"]');
    if (!art) return { error: 'no article', items: [] };
    function isVisible(el) {
      let cur = el;
      while (cur) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
        const cs = window.getComputedStyle(cur);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (cur === document.body) break;
        cur = cur.parentElement;
      }
      return true;
    }
    const sel = 'p, h1, h2, h3, h4, h5, h6, figure, img, ul, ol, blockquote, pre, form, input, button, a, div, span, section, aside, nav, footer';
    const all = [];
    for (const el of art.querySelectorAll(sel)) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 5) continue;
      const direct = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
      if (!direct && !['IMG', 'FORM', 'INPUT', 'BUTTON', 'FIGURE'].includes(el.tagName)) continue;
      all.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 80), text: direct.slice(0, 60), top: Math.round(r.top) });
    }
    all.sort((a, b) => a.top - b.top);
    const cutoff = Math.floor(all.length * 0.8);
    return { total: all.length, items: all.slice(cutoff) };
  });
}

// ---- Content stats（輔助信號）----
async function getContentStats(page) {
  return page.evaluate(() => {
    const art = document.querySelector('[data-jread-active="1"]');
    if (!art) return null;
    function isVisible(el) {
      let cur = el;
      while (cur) {
        if (cur.dataset && cur.dataset.jreadHidden === '1') return false;
        const cs = window.getComputedStyle(cur);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        if (cur === document.body) break;
        cur = cur.parentElement;
      }
      return true;
    }
    const visibleEls = (sel) => [...art.querySelectorAll(sel)].filter(isVisible);
    const h1s = visibleEls('h1, h2');
    const imgs = visibleEls('img').filter(el => { const r = el.getBoundingClientRect(); return r.width > 100 && r.height > 100; });
    const ps = visibleEls('p');
    const totalText = ps.reduce((sum, p) => sum + (p.textContent || '').trim().length, 0);
    const links = visibleEls('a[href]');
    const blockquotes = visibleEls('blockquote');
    const videos = visibleEls('video, iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="vimeo"]');
    let visibleTextLength = 0;
    const walker = document.createTreeWalker(art, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (isVisible(node.parentElement)) visibleTextLength += (node.textContent || '').trim().length;
    }
    return { h1Count: h1s.length, imgCount: imgs.length, pTextLength: totalText, visibleTextLength,
      linkCount: links.length, blockquoteCount: blockquotes.length, videoCount: videos.length };
  });
}

(async () => {
  const hostname = hostnameOf(TARGET_URL);
  const dirName = outDirName(TARGET_URL);
  const outDir = path.join(PROJECT_ROOT, 'docs', 'excluded', 'page-rounds', dirName);

  // 清舊截圖
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const PROFILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jread-pr-'));

  console.log(`Page Rounds: ${TARGET_URL}`);
  console.log(`Output: ${outDir}`);

  // ---- 1. 啟動 Chromium + extension ----
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chromium',
    headless: false,
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=-2400,-2400'
    ]
  });

  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
  if (!sw) { console.error('ERROR: service worker 未啟動'); process.exit(1); }
  console.log('SW ready:', sw.url());

  // 關掉 about:blank
  for (const p of ctx.pages()) { try { await p.close(); } catch {} }
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message.slice(0, 200)));

  // ---- 2. 開頁面 ----
  console.log('Loading:', TARGET_URL);
  try {
    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 60000 });
  } catch (e) {
    console.log('load timeout, fallback domcontentloaded:', e.message.slice(0, 80));
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  await sleep(2500);

  // ---- 3. 原頁截圖 ----
  console.log('Phase: original');
  await page.evaluate(() => { document.body.style.zoom = '0.5'; });
  await sleep(300);
  await takePagedScreenshots(page, outDir, 'original');

  // ---- 4. 進入 reader mode ----
  const tabId = await sw.evaluate(async (u) => {
    const ts = await chrome.tabs.query({});
    return (ts.find(t => t.url === u) || ts.find(t => t.url && !t.url.startsWith('chrome')))?.id;
  }, TARGET_URL);

  if (!tabId) { console.error('ERROR: 找不到 tab'); process.exit(1); }

  const toggle = await sw.evaluate(async (id) => {
    try { return { ok: true, res: await chrome.tabs.sendMessage(id, { type: 'TOGGLE_READER_MODE' }) }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, tabId);
  console.log('toggle enter:', JSON.stringify(toggle));
  await sleep(1200);

  // ---- 5. 確認 reader mode 啟動 ----
  const readerActive = await page.evaluate(() => !!document.querySelector('[data-jread-active="1"]'));
  console.log('reader mode active:', readerActive);

  const audit = { url: TARGET_URL, hostname, dirName, readerModeActive: readerActive,
    contentStats: null, residual: { initial: null, delayed: null },
    gaps: { initial: null, delayed: null }, tail: null, restored: null };

  if (!readerActive) {
    console.log('WARNING: reader mode 未啟動，截圖供 Claude 判定 fallback');
    await takePagedScreenshots(page, outDir, 'light');
    fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(audit, null, 2));
    if (!KEEP) await ctx.close();
    return;
  }

  // ---- 6. 亮色截圖 ----
  console.log('Phase: light');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  await takePagedScreenshots(page, outDir, 'light');

  // ---- 7. Residual + gap audit（輔助信號）----
  audit.contentStats = await getContentStats(page);
  audit.residual.initial = await runResidualAudit(page, NOISE_AUDIT_KEYWORDS);
  audit.gaps.initial = await runGapAudit(page);

  if (audit.residual.initial.warnings.length > 0) {
    console.log(`  ⚠️  residual warnings: ${audit.residual.initial.warnings.length}`);
    for (const w of audit.residual.initial.warnings.slice(0, 5)) {
      console.log(`    ${w.tag} "${w.text}" [${w.hitKeywords.join(', ')}]`);
    }
  } else {
    console.log('  ✅ residual: 無命中');
  }
  if (audit.gaps.initial.gaps.length > 0) {
    console.log(`  ⚠️  gap warnings: ${audit.gaps.initial.gaps.length}`);
    for (const g of audit.gaps.initial.gaps.slice(0, 3)) {
      console.log(`    ${g.gap}px: ${g.prev} → ${g.next}`);
    }
  } else {
    console.log('  ✅ gaps: 無 >= 80px');
  }
  console.log('  content stats:', JSON.stringify(audit.contentStats));

  // ---- 7b. Tail audit（文末元素 dump）----
  audit.tail = await runTailAudit(page);
  const tailItems = audit.tail.items;
  const tailLast = tailItems.slice(-10);
  console.log(`  tail audit: ${tailItems.length} items (last 20% of ${audit.tail.total}), showing last ${tailLast.length}:`);
  for (const t of tailLast) {
    console.log(`    ${t.tag}${t.cls ? '.' + t.cls.split(' ')[0] : ''} "${t.text}"`);
  }

  // ---- 8. 等 5s + scroll 觸發 lazy-load ----
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(2500);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(2500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(1000);

  // ---- 9. 延遲截圖（C7）----
  console.log('Phase: delayed');
  await takePagedScreenshots(page, outDir, 'delayed');
  audit.residual.delayed = await runResidualAudit(page, NOISE_AUDIT_KEYWORDS);
  audit.gaps.delayed = await runGapAudit(page);

  if (audit.residual.delayed.warnings.length > 0) {
    console.log(`  ⚠️  delayed residual warnings: ${audit.residual.delayed.warnings.length}`);
  } else {
    console.log('  ✅ delayed residual: 無命中');
  }

  // ---- 10. 暗色模式 ----
  console.log('Phase: dark');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'set-theme', theme: 'dark' } }));
  });
  await sleep(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await takePagedScreenshots(page, outDir, 'dark');

  // ---- 11. 還原 ----
  console.log('Phase: restored');
  // 切回亮色
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('__jread_debug', { detail: { type: 'set-theme', theme: 'light' } }));
  });
  await sleep(300);
  // 退出 reader mode
  const toggleOff = await sw.evaluate(async (id) => {
    try { return { ok: true, res: await chrome.tabs.sendMessage(id, { type: 'TOGGLE_READER_MODE' }) }; }
    catch (e) { return { ok: false, err: e.message }; }
  }, tabId);
  console.log('toggle exit:', JSON.stringify(toggleOff));
  await sleep(800);

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await takePagedScreenshots(page, outDir, 'restored');

  // 確認還原
  audit.restored = await page.evaluate(() => ({
    jreadActive: !!document.querySelector('[data-jread-active]'),
    jreadStyle: !!document.getElementById('__jread-style')
  }));
  console.log('restored state:', JSON.stringify(audit.restored));

  // ---- 12. 寫 audit.json ----
  fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify(audit, null, 2));
  console.log(`\nDone. Screenshots in: ${outDir}`);
  console.log('audit.json written.');

  if (!KEEP) {
    await ctx.close();
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  } else {
    console.log('--keep, leaving browser open');
  }
})().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
