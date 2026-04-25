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
const FULLPAGE_OUT = path.join(PROJECT_ROOT, '.playwright-mcp', 'jread-reader-fullpage.png');

// 殘留偵測名單：reader card 內若出現這些字樣 = cleaner rule 漏網（雜訊殘留）。
// 規則：跨站常見的「推薦 / 相關 / 社群 / CTA / 訂閱 / 留言」等非主文字樣。
// 新增字樣請同步維護 cleaner.js 的 NOISE_*_RE regex；此清單是 forcing
// function—— harness 每次驗收必跑、任一命中都印 WARNING。
const NOISE_AUDIT_KEYWORDS = [
  '更多', '相關', '其他人', '推薦', '最新', '延伸', '查看原始', '看更多', '看原文',
  '加入', '訂閱', 'LINE 官方', 'LINE官方', '官方帳號', '粉絲專頁', '好友',
  'AI 摘要', 'AI摘要', '網友貼文', '貼文',
  '轉發', '留言', '建立貼文', '熱門', '繼續看下去', '貼文', '回覆',
  '廣告', '贊助', '業配',
  '登入', '註冊',
  '原始文章',
  '追蹤', '關注', '訂閱',
  'Google新聞', 'Google 新聞', '透過',
  '聽新聞', '聽書', '想成為', '玩問答', '拿課程', '抽獎', '免費領'
];

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
  // timeout 60s：theverge / nytimes 類重站 30s 不夠。waitUntil load 若超時 fallback domcontentloaded 不中斷驗收。
  try {
    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  } catch (e) {
    console.log('goto load timeout，fallback domcontentloaded:', e.message.slice(0, 80));
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
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

    // ---- Residual audit：列出 reader card 內所有可見 heading + 連結的文字 ----
    // 抓 reader card 內每個 visible h1-h6 + a + button + top-level section/p
    // 的 text，檢查有沒有落在 NOISE_AUDIT_KEYWORDS 名單裡。這是 forcing
    // function：cleaner rule 跑完若仍有雜訊可見，這裡一定報 WARNING——
    // 避免之前「grep 沒命中 = 清乾淨」的偽陰性驗收。
    const residual = await page.evaluate((keywords) => {
      const art = document.querySelector('[data-jread-active="1"]');
      if (!art) return { error: 'no article' };

      function isVisible(el) {
        if (el.dataset && el.dataset.jreadHidden === '1') return false;
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
      // 掃 articleEl 內所有 element，列出「自身直接 textNode 有內容 <= 60 chars」
      // 的 element——這些是 heading / button / span / tag / meta 類短文字，
      // 最容易是非主文雜訊。p 含長段落會被 > 60 門檻過濾掉，不會污染 outline。
      for (const el of art.querySelectorAll('*')) {
        if (!isVisible(el)) continue;
        // SVG <title> / <desc> 是 accessibility 補充文字（tooltip），肉眼不
        // 可見，audit 不列。HTML <style> / <script> 同理。
        const tag = el.tagName;
        const tagUpper = tag.toUpperCase();
        if (tagUpper === 'TITLE' || tagUpper === 'DESC' || tagUpper === 'STYLE' ||
            tagUpper === 'SCRIPT' || tagUpper === 'NOSCRIPT') continue;
        // 只看 direct text（不抓子孫的），避免「包了主文的 wrapper」產生假 outline
        const direct = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent).join('');
        const text = norm(direct);
        if (!text || text.length > 60) continue;
        if (text.length < 2) continue;
        const hitKws = keywords.filter(kw => text.includes(kw));
        items.push({
          tag: tag,
          text: text.slice(0, 60),
          hitKeywords: hitKws,
          elCls: (el.className || '').toString().slice(0, 80),
          parents: hitKws.length > 0 ? (() => {
            const out = [];
            let p = el.parentElement;
            for (let i = 0; i < 3 && p; i++) {
              const c = ((p.className || '').toString().split(/\s+/).slice(0, 2).join('.')) || '(anon)';
              out.push(`${p.tagName}.${c}`);
              p = p.parentElement;
            }
            return out.join(' > ');
          })() : null
        });
        if (items.length >= 200) break;
      }

      const warnings = items.filter(it => it.hitKeywords.length > 0);
      return { total: items.length, warnings, items: items.slice(0, 60) };
    }, NOISE_AUDIT_KEYWORDS);

    function printAudit(label, r) {
      console.log(`\n===== RESIDUAL AUDIT (${label}) =====`);
      console.log(`reader card 內 visible heading/a/button 總數: ${r.total}`);
      if (r.warnings && r.warnings.length > 0) {
        console.log(`\n⚠️  殘留雜訊 ${r.warnings.length} 項（cleaner rule 漏網）：`);
        for (const w of r.warnings) {
          console.log(`   ${w.tag}.${w.elCls || '(anon)'} [${w.hitKeywords.join(', ')}] "${w.text}"`);
          if (w.parents) console.log(`     ancestors: ${w.parents}`);
        }
      } else {
        console.log('✅ 無殘留雜訊命中 NOISE_AUDIT_KEYWORDS');
      }
      console.log('\nvisible items outline (前 40)：');
      if (r.items) {
        for (const it of r.items) {
          console.log(`   ${it.tag.padEnd(8)} "${it.text}"`);
        }
      }
      console.log('==========================\n');
    }
    printAudit('initial, 1.2s post-toggle', residual);

    // ---- Gap audit：reader card 內相鄰 visible block 間 gap > 80px 警告 ----
    // Jimmy 2026-04-25 要求加的第二層 residual：以前 residual 只抓
    // NOISE_AUDIT_KEYWORDS 命中的雜訊文字、對「未清的 empty wrapper / 廣告
    // placeholder / 塌陷的 figure」這類 visible 不在但佔高度的 bug 完全
    // 漏抓。techbang 262px 空白就是這種 case——靠 Jimmy 實機截圖才發現。
    // 現在對 p/h*/figure/img/ul/ol/blockquote 等 content anchor 按 y 位置
    // 排序、量連續兩個 block 間 gap，>= 80px 印警告。非 forcing function
    // （某些段落間合法大 margin 例如 h2 前 60-80px），只提醒 Claude 修法
    // 後自動巡視這些位置。threshold 80 是「正常段落 margin」（line-height
    // 1.7 × 18px ≈ 30px，h2 margin-top 多站慣例 40-60px）與 techbang 實測
    // 262px 案例間取的中位，可未來調整。
    async function runGapAudit() {
      return await page.evaluate(() => {
        const art = document.querySelector('[data-jread-active="1"]');
        if (!art) return { error: 'no article' };
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
        const blocks = [];
        // content anchor：主文常見的「一段內容」元素。div 故意不收——div 太
        // 通用、會納入 wrapper 造成 double-count。figure / img 含圖片 / ul /
        // ol 含列表、都是 Jimmy 視覺上會記住「上個區塊結束」的點。
        for (const el of art.querySelectorAll('p, h1, h2, h3, h4, h5, h6, figure, img, ul, ol, blockquote, pre')) {
          if (!isVisible(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 10 || r.height < 10) continue;
          blocks.push({
            top: r.top, bottom: r.bottom,
            tag: el.tagName,
            text: norm(el.innerText || el.textContent || '').slice(0, 40)
          });
        }
        blocks.sort((a, b) => a.top - b.top);
        const gaps = [];
        for (let i = 1; i < blocks.length; i++) {
          const gap = blocks[i].top - blocks[i - 1].bottom;
          if (gap >= 80) {
            gaps.push({
              gap: Math.round(gap),
              prev: `${blocks[i-1].tag} "${blocks[i-1].text}"`,
              next: `${blocks[i].tag} "${blocks[i].text}"`,
              y: Math.round(blocks[i-1].bottom)
            });
          }
        }
        return { gaps, blockCount: blocks.length };
      });
    }

    function printGapAudit(label, g) {
      console.log(`\n===== GAP AUDIT (${label}) =====`);
      if (g.error) { console.log(g.error); console.log('==========================\n'); return; }
      if (!g.gaps || g.gaps.length === 0) {
        console.log(`✅ 無 >= 80px gap（reader card 內 ${g.blockCount} 個 content block、consecutive gap 皆正常）`);
      } else {
        console.log(`⚠️  ${g.gaps.length} 段 >= 80px gap（疑似未清的 empty wrapper / 廣告 placeholder / 塌陷 figure、看 fullpage 截圖對應位置）：`);
        for (const x of g.gaps) {
          console.log(`   ${String(x.gap).padStart(4)}px @ y=${x.y}  ${x.prev} → ${x.next}`);
        }
      }
      console.log('==========================\n');
    }

    const gapInitial = await runGapAudit();
    printGapAudit('initial, 1.2s post-toggle', gapInitial);

    // 第 2 次 audit（+3s，捕 Jimmy 回報的「文章出現後約 3 秒按鈕才注入」
    // 時機）。LINE Today 類 SPA 站點 lazy-inject 常在 toggle 後 2-4s 發
    // 生，這個時間點最接近使用者眼見為實的「突然跳出雜訊」瞬間。
    await sleep(3000);
    const residual3s = await page.evaluate((keywords) => {
      const art = document.querySelector('[data-jread-active="1"]');
      if (!art) return { error: 'no article' };
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
      // 擴掃：任何 visible a/button（含空 direct text 的 icon button），
      // 用 textContent（整棵子樹的 text）作判定——LINE 分享這類
      // `<a><svg/><span>分享</span></a>` 才不會漏
      for (const btn of art.querySelectorAll('a, button, [role="button"]')) {
        if (!isVisible(btn)) continue;
        const text = norm(btn.textContent).slice(0, 60);
        const cls = (btn.className || '').toString().slice(0, 60);
        const href = btn.getAttribute ? (btn.getAttribute('href') || '') : '';
        items.push({
          tag: btn.tagName,
          text: text || '(no text)',
          cls, href: href.slice(0, 40),
          hitKeywords: keywords.filter(kw => text.includes(kw) || cls.toLowerCase().includes(kw.toLowerCase()))
        });
        if (items.length >= 200) break;
      }
      return { total: items.length, warnings: items.filter(i => i.hitKeywords.length > 0 || /share|social|subscribe|follow/i.test(i.cls) || /line\.me|twitter|facebook|x\.com/.test(i.href)), items: items.slice(0, 60) };
    }, NOISE_AUDIT_KEYWORDS);
    console.log('\n===== RESIDUAL AUDIT (+3s all a/button) =====');
    console.log(`reader card 內 visible a/button/role=button 總數: ${residual3s.total}`);
    if (residual3s.warnings && residual3s.warnings.length > 0) {
      console.log(`\n⚠️  殘留 a/button ${residual3s.warnings.length} 項（cleaner rule 漏網）：`);
      for (const w of residual3s.warnings) {
        console.log(`   ${w.tag}.${w.cls || '(anon)'} text="${w.text}" href="${w.href}" hits=[${w.hitKeywords.join(', ')}]`);
      }
    } else {
      console.log('✅ 無可疑 a/button');
    }
    console.log('==========================\n');

    // 第 2 次 audit：scroll 到底 + 等更久 (15s) 抓 lazy-load 後才注入的雜訊
    // （SPA 站點常見留言面板 / 轉發按鈕 / 推薦文章 widget 都是延遲注入，
    // 有些要 user scroll 到底才 API fetch）。若 MutationObserver articleEl
    // subtree 正常工作，這時 visible outline 應與第 1 次相同。
    // Jimmy 2026-04-23 回報 line today 留言面板 / 繼續看下去 5 筆推薦在
    // 實機 Chrome 看到、harness 5s 卻看不到——證實 lazy-load 時機遠於 5s，
    // 拉到 15s + scroll trigger 更接近 Jimmy 實際情境。
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(3000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(10000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(2000);
    const residualDelayed = await page.evaluate((keywords) => {
      const art = document.querySelector('[data-jread-active="1"]');
      if (!art) return { error: 'no article' };
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
        if (tagUpper === 'TITLE' || tagUpper === 'DESC' || tagUpper === 'STYLE' ||
            tagUpper === 'SCRIPT' || tagUpper === 'NOSCRIPT') continue;
        const direct = Array.from(el.childNodes)
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent).join('');
        const text = norm(direct);
        if (!text || text.length > 60 || text.length < 2) continue;
        items.push({
          tag: el.tagName,
          text: text.slice(0, 60),
          hitKeywords: keywords.filter(kw => text.includes(kw))
        });
        if (items.length >= 200) break;
      }
      return { total: items.length, warnings: items.filter(i => i.hitKeywords.length > 0), items: items.slice(0, 60) };
    }, NOISE_AUDIT_KEYWORDS);
    printAudit('delayed +scroll +15s', residualDelayed);

    // delayed 時機再跑一次 gap audit（lazy-load / late inject 的 placeholder
    // 都已展開，這張最接近實機使用者看到的狀態）
    const gapDelayed = await runGapAudit();
    printGapAudit('delayed +scroll +15s', gapDelayed);
  }

  fs.mkdirSync(path.dirname(SCREENSHOT_OUT), { recursive: true });
  // 截圖前縮放整頁到 50%（Jimmy 硬規則 2026-04-24）：同一張 fullpage 能看
  // 更多內容、Claude Read 截圖做整頁排版巡視時一次吃進更多 vertical 空間。
  // 用 document.body.style.zoom 保留清晰度（不是縮 DPR），只壓縮 layout。
  await page.evaluate(() => { document.body.style.zoom = '0.5'; });
  await sleep(300); // 等 reflow
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  await page.screenshot({ path: SCREENSHOT_OUT });
  console.log('saved viewport (zoom 0.5):', SCREENSHOT_OUT);
  // Full-page 截圖：拍完整 reader card（含 scroll 下方殘留）
  await page.screenshot({ path: FULLPAGE_OUT, fullPage: true });
  console.log('saved fullpage (zoom 0.5):', FULLPAGE_OUT);

  // ---- 分頁滾動截圖（v0.7.31 Jimmy 硬規則）-----------------------------
  // Playwright `fullPage: true` 對某些 SPA 站（cnyes 實測：Next.js
  // reconciliation 在 reader mode 下噴 NotFoundError、layout 整片變空白）
  // 拍出整張白圖；fullpage 截圖**不可靠**作為唯一視覺驗證。
  //
  // 改採分頁滾動：每次滑 viewport 高 × 0.9（留 10% 重疊），截一張，編號
  // jread-page-1.png / jread-page-2.png ...，直到 scroll 到底。
  // Claude Read 每張依序看，覆蓋整篇 reader card 不會漏網。
  // 同時 zoom 0.5 的縮放仍生效——每張一次吃 1.8 個 viewport 的內容。
  const PAGE_SCREENSHOT_PREFIX = path.join(PROJECT_ROOT, '.playwright-mcp', 'jread-page-');
  // 清掉舊 page 截圖避免混淆
  for (const f of fs.readdirSync(path.dirname(PAGE_SCREENSHOT_PREFIX))) {
    if (f.startsWith('jread-page-') && f.endsWith('.png')) {
      try { fs.unlinkSync(path.join(path.dirname(PAGE_SCREENSHOT_PREFIX), f)); } catch {}
    }
  }
  const docInfo = await page.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight
  }));
  const stepHeight = Math.floor(docInfo.viewportHeight * 0.9);
  const pageCount = Math.max(1, Math.ceil(docInfo.docHeight / stepHeight));
  console.log(`分頁滾動截圖：docHeight=${docInfo.docHeight} viewport=${docInfo.viewportHeight} step=${stepHeight} pages=${pageCount}`);
  for (let i = 0; i < pageCount; i++) {
    const y = i * stepHeight;
    await page.evaluate((sy) => window.scrollTo(0, sy), y);
    await sleep(400);
    const out = `${PAGE_SCREENSHOT_PREFIX}${String(i + 1).padStart(2, '0')}.png`;
    await page.screenshot({ path: out });
    console.log(`saved page ${i + 1}/${pageCount} (y=${y}): ${out}`);
  }

  if (!KEEP) await ctx.close();
  else console.log('--keep, leaving open');
})().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
