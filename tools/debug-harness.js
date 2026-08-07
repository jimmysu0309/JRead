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
//   node tools/debug-harness.js --profile work       # Tier 2：用持久 profile（跨 run 留登入態）
//   node tools/debug-harness.js --profile work --login --url https://site.com  # 一次性登入該站
//   node tools/debug-harness.js --shinkansen         # toggle 後翻譯（驗 body 層殘留）
//   node tools/debug-harness.js --translate-first    # 先翻譯→再 toggle（對應 Safari 實機順序）
// -----------------------------------------------------------------------------

const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require(path.join(__dirname, '..', 'node_modules', 'playwright'));
// audit 邏輯與 NOISE_AUDIT_KEYWORDS 的單一資料源（v0.8.39 抽出，與
// page-rounds-harness 共用；anti-drift forcing function 見
// test/regression/harness-audit-lib.spec.js）
const audits = require(path.join(__dirname, 'audit-lib.js'));
const { NOISE_KEYWORD_TIERS } = audits;

const PROJECT_ROOT = path.join(__dirname, '..');
const EXT_PATH = path.join(PROJECT_ROOT, 'jread');
// --profile <name>（Tier 2，登入態除錯）：用 ~/.jread-debug/profiles/<name> 這個
// 穩定持久 profile 取代預設 /tmp（重開機不會清）。同一 name 跨 run 重用 →
// 在該 profile 登入過的站台 cookie/session 會留存，之後背景跑就帶著登入態。
// 不給 --profile 時維持舊行為（/tmp/jread-pw-profile）。
const profileArgIdx = process.argv.indexOf('--profile');
const PROFILE_NAME = (profileArgIdx >= 0 && process.argv[profileArgIdx + 1]) || null;
const PROFILE_DIR = PROFILE_NAME
  ? path.join(os.homedir(), '.jread-debug', 'profiles', PROFILE_NAME)
  : '/tmp/jread-pw-profile';
// --login（Tier 2 一次性登入）：把視窗放到螢幕上、headed、不關閉，且跳過
// toggle/audit——純粹開站台讓 Jimmy 手動登入一次。登入後該 --profile 的 session
// 留存，之後同 --profile 的背景跑（headless、螢幕外）就自動帶登入態，不再干擾。
const LOGIN = process.argv.includes('--login');
const SCREENSHOT_OUT = path.join(PROJECT_ROOT, '.playwright-mcp', 'jread-viewport.png');
const FULLPAGE_OUT = path.join(PROJECT_ROOT, '.playwright-mcp', 'jread-reader-fullpage.png');

// --url 優先，其次 JREAD_URL 環境變數，最後預設
const urlArgIdx = process.argv.indexOf('--url');
const URL = (urlArgIdx >= 0 && process.argv[urlArgIdx + 1]) || process.env.JREAD_URL || 'https://www.chinatalk.media/p/best-books-q1-2026';
// --fresh：砍掉重建 persistent profile。**改過 background SW 後必加**——
// Chromium 會把 unpacked extension 的 SW 快取在 profile 內，重啟
// launchPersistentContext 不一定重載新 SW（content script 倒是每次從磁碟
// 新載）。症狀：content 端行為是新 code、SW 端回應是舊 code（v0.7.230
// debug 翻頁模式時 GET_SETTINGS 回應缺新欄位、SW 內新加的 console.log
// 不出現，燒 4 輪才定位）。懷疑「SW 行為跟 code 對不上」直接 --fresh。
const FRESH = process.argv.includes('--fresh');
const KEEP = process.argv.includes('--keep');
// --width <px>：覆寫 viewport 寬度（預設 1280 桌面）。驗收手機版心寬度用——
// 例 `--width 390` 模擬 iPhone 15 邏輯寬、`--width 430` 模擬 Pro Max。窄
// viewport 下 styler 的 padding / margin clamp 才會觸發，桌面寬量不到手機行為。
const widthArgIdx = process.argv.indexOf('--width');
const VIEWPORT_WIDTH = (widthArgIdx >= 0 && parseInt(process.argv[widthArgIdx + 1], 10)) || 1280;
// --scheme dark：模擬 prefers-color-scheme: dark（macOS 深色模式使用者看到的
// 站點樣式）。v0.7.225 tymscar code block 對比 bug 只在 dark scheme 重現——
// 站點為深底設計的 syntax 色 + reader 白卡。預設 light。
const schemeArgIdx = process.argv.indexOf('--scheme');
const COLOR_SCHEME = (schemeArgIdx >= 0 && process.argv[schemeArgIdx + 1]) || 'light';
// --translate-first：先 Shinkansen 翻譯 → 再 toggle JRead（對應 Jimmy 實機
// Safari 順序）。隱含 --shinkansen（需載入 Shinkansen extension）。
// 動機（v0.8.12）：detector/cleaner 的輸出受頁面文字內容影響（Readability 評分、
// og:title 文字比對）。翻譯把文字換成中文後會走進「英文未翻譯」從沒測過的 code
// path——chinatalk.media 實案：translate-first 後 detector 把站名 logo H1 當 hero
// 上浮、留言+推薦括進主文。普通 --shinkansen 是「toggle→翻譯」順序、抓不到此類
// （主 RESIDUAL AUDIT 在 toggle 當下跑、DOM 還是英文）。--translate-first 把翻譯
// 移到 toggle 之前，讓既有 RESIDUAL / CONTRAST / GAP audit 全跑在「翻譯後偵測
// 的 DOM」上，這類 in-article 雜訊殘留才驗得到。Chromium 即可重現 = 不需 WebKit。
const TRANSLATE_FIRST = process.argv.includes('--translate-first');
const WITH_SHINKANSEN = process.argv.includes('--shinkansen') || TRANSLATE_FIRST;
// --paged：toggle 前先把 settings.pagedMode 寫成 true（直接寫 storage.sync，
// 與 popup checkbox 同一條資料路徑），驗收電子書式水平翻頁。v0.7.230 WebKit
// column-count: 1 翻頁全滅 bug 修法後加入——Chromium 端翻頁視覺 / 頁數 /
// scrollLeft stride 從此可由 harness 自驗，不再依賴一次性 probe。
// 注意：本 harness 是 Chromium，只驗 Chrome 軌；WebKit 軌（Safari）的
// engine 行為驗證要用 Playwright WebKit 或 safaridriver（真 Safari），且
// safaridriver 自動化視窗 visibilityState=hidden、rAF 不發，只能驗同步
// scrollLeft、不能驗 rAF 翻頁動畫。
const PAGED = process.argv.includes('--paged');
// --headed：不加 --headless=new（用真窗口跑，視窗仍移到螢幕外）。Cloudflare
// 類 bot challenge 會偵測 headless 模式直接出驗證頁（upmedia.mg 實證——
// headless 下 detector 撿到的是 challenge 頁、驗收全失真），這類站必加。
const HEADED = process.argv.includes('--headed');
// --orion：模擬 iOS Orion（Kagi）瀏覽器——進閱讀模式後，手動在 <html> 蓋
// .jread-orion + 設 --jread-orion-top（正常由 content/orion-detect.js 讀 window.kagi
// 蓋上，但 Chromium harness 沒有 window.kagi）。驗 styler 的 .jread-orion gated CSS
// specificity 在真實引擎下真的把標題推下去（jsdom regex 驗不到 cascade）。
const ORION = process.argv.includes('--orion');
const SHINKANSEN_EXT = path.resolve(PROJECT_ROOT, '..', 'Shinkansen', 'shinkansen');

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Shinkansen 翻譯觸發：實作住 audit-lib.js（與 page-rounds-harness 共用單一
// 資料源，2026-08-07 抽出——原本兩支各一份必然 drift）。
const triggerShinkansenTranslate = (page) => audits.triggerShinkansenTranslate(page);

(async () => {
  if (FRESH) fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  // 載入 extension：JRead 必載，--shinkansen 時同時載 Shinkansen
  const extPaths = [EXT_PATH];
  if (WITH_SHINKANSEN) {
    if (!fs.existsSync(path.join(SHINKANSEN_EXT, 'manifest.json'))) {
      console.error('Shinkansen extension 不在預期位置:', SHINKANSEN_EXT);
      process.exit(1);
    }
    extPaths.push(SHINKANSEN_EXT);
    console.log('shinkansen: enabled');
  }
  const extList = extPaths.join(',');

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    channel: 'chromium',          // 必須：用 bundled Chromium，才能載 unpacked extension
    headless: false,              // 必須：extension 僅 headed 模式可用
    viewport: { width: VIEWPORT_WIDTH, height: 900 },
    colorScheme: COLOR_SCHEME,    // --scheme dark 模擬深色模式使用者

    args: [
      `--disable-extensions-except=${extList}`,
      `--load-extension=${extList}`,
      '--no-first-run',
      '--no-default-browser-check',
      // --login 時把視窗放到螢幕左上角讓 Jimmy 操作登入；其餘情境一律推到
      // 螢幕外（-2400,-2400），背景跑不干擾。
      LOGIN ? '--window-position=40,40' : '--window-position=-2400,-2400',
      // --login 必須 headed（要看得到頁面登入）；其餘維持 --headed 決策。
      ...((HEADED || LOGIN) ? [] : ['--headless=new'])
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

  // ===== --login 短路（Tier 2 一次性登入）=====
  // 純粹開站台讓 Jimmy 在螢幕上手動登入，跳過 toggle + 所有 audit + 截圖。
  // 登入完成後關掉視窗即可——session 已寫進該 --profile，之後同 --profile 的
  // 背景跑（headless、螢幕外）會自動帶登入態。
  if (LOGIN) {
    if (!PROFILE_NAME) {
      console.error('⚠️  --login 必須搭配 --profile <name>，否則登入態存進 /tmp 重開機就沒了');
    }
    console.log('\n===== LOGIN 模式 =====');
    console.log(`profile: ${PROFILE_DIR}`);
    console.log('視窗已開在螢幕左上角，請在裡面手動登入這個站台。');
    console.log('登入完成後直接關閉該 Chromium 視窗即可（session 會留存）。');
    console.log(`之後背景除錯跑：node tools/debug-harness.js --profile ${PROFILE_NAME || '<name>'} --url <文章URL>`);
    console.log('======================\n');
    // 不關 context——等 Jimmy 自己關視窗。偵測視窗關閉後結束 process。
    await new Promise((resolve) => ctx.on('close', resolve));
    console.log('視窗已關閉，登入態已存入 profile。');
    return;
  }

  // 找 tab id
  const tabId = await sw.evaluate(async (u) => {
    const ts = await chrome.tabs.query({});
    return (ts.find(t => t.url === u) || ts.find(t => t.url && !t.url.startsWith('chrome')))?.id;
  }, URL);
  console.log('tabId:', tabId);

  // --paged：toggle 前寫入 pagedMode 設定（enter 路徑的 getSettings 會讀到）。
  // 非 --paged 也明確寫 false——profile 跨 run 重用，上一輪 --paged 殘留的
  // true 會讓後續普通驗收意外跑進翻頁模式。
  await sw.evaluate((on) => chrome.storage.sync.set({ pagedMode: on }), PAGED);
  if (PAGED) console.log('paged: settings.pagedMode = true');

  // v0.8.40：清掉閱讀位置記憶——profile 跨 run 重用，上一輪同 URL 的記錄會讓
  // enter 直接跳回上次位置（PAGED AUDIT 預期從第 1 頁起跳、GAP/RESIDUAL scan
  // 預期從頁首掃起）。位置記憶功能本身的驗證走獨立 probe，不靠本 harness。
  await sw.evaluate(() => chrome.storage.local.remove('readingPositions'));

  // --translate-first：toggle JRead 之前先翻譯（對應 Jimmy 實機 Safari 順序）。
  // 翻譯完成後下面的 toggle + 所有 audit 都跑在「翻譯後 DOM」上。
  if (TRANSLATE_FIRST) {
    console.log('\n===== SHINKANSEN TRANSLATE-FIRST（toggle 前翻譯） =====');
    await triggerShinkansenTranslate(page);
  }

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

  // ===== ORION SIMULATION AUDIT（--orion）=====
  // 模擬 Orion：蓋 .jread-orion + --jread-orion-top，量標題（reader card 第一個
  // 可見內容元素）的 viewport 頂距是否被推下約 inset。驗 styler gated CSS 的
  // specificity / cascade 在真實引擎生效（Safari 永遠不會有此 class、零回歸）。
  if (ORION && state.articleFound) {
    const orionState = await page.evaluate(async (paged) => {
      const art = document.querySelector('[data-jread-active="1"]');
      const firstTop = () => {
        // reader card 第一個有高度的內容元素（標題）距 viewport 頂的距離
        const el = art.querySelector('h1, h2, h3, p, [data-jread-byline]') || art;
        return Math.round(el.getBoundingClientRect().top);
      };
      const before = firstTop();
      const cardTopBefore = Math.round(art.getBoundingClientRect().top);
      const de = document.documentElement;
      de.classList.add('jread-orion');
      de.style.setProperty('--jread-orion-top', '59px');
      await new Promise(r => setTimeout(r, 350)); // reflow
      const after = firstTop();
      const cardTopAfter = Math.round(art.getBoundingClientRect().top);
      const cs = getComputedStyle(document.body);
      const artCs = getComputedStyle(art);
      return {
        mode: paged ? 'paged' : 'scroll',
        titleTopBefore: before, titleTopAfter: after, titleShift: after - before,
        cardTopBefore, cardTopAfter, cardShift: cardTopAfter - cardTopBefore,
        bodyPaddingTop: cs.paddingTop,
        cardPosition: artCs.position, cardTop: artCs.top,
      };
    }, PAGED);
    console.log('\n===== ORION SIMULATION =====');
    console.log(orionState);
    const shift = PAGED ? orionState.cardShift : orionState.titleShift;
    const ok = shift >= 50; // 約 59px，留一點容差
    console.log(ok
      ? `✅ Orion gated CSS 生效：${PAGED ? '卡片' : '標題'}下推 ${shift}px（約 59）`
      : `❌ Orion gated CSS 未生效：位移僅 ${shift}px（specificity/cascade 沒贏）`);
  }

  // ===== PAGED AUDIT（--paged）=====
  // 驗：multicol 分頁 CSS 算出值（column-width 不可為 auto——auto 代表退回
  // column-count 路徑，WebKit 翻頁全滅 bug 的型態）、頁數 > 1、鍵盤翻頁後
  // scrollLeft 跳 stride、頁碼指示文字。不驗：WebKit 軌（本 harness 是
  // Chromium）、swipe 手勢（Playwright 觸控模擬與實機差異大）。
  if (PAGED && state.articleFound) {
    const pagedState = await page.evaluate(() => {
      const art = document.querySelector('[data-jread-active="1"]');
      const cs = getComputedStyle(art);
      // v0.7.231 stride 恆等式：右內距改 transparent border 後
      // stride = clientWidth − 左右 padding + column-gap（≠ clientWidth）
      const stride = art.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + parseFloat(cs.columnGap);
      return {
        columnWidth: cs.columnWidth,
        columnCount: cs.columnCount,
        columnFill: cs.columnFill,
        position: cs.position,
        paddingRight: cs.paddingRight,
        borderRightWidth: cs.borderRightWidth,
        clientWidth: art.clientWidth,
        scrollWidth: art.scrollWidth,
        stride,
        pages: Math.max(1, Math.round(art.scrollWidth / stride)),
        indicator: (document.getElementById('__jread-page-indicator') || {}).textContent || '(無)'
      };
    });
    console.log('PAGED AUDIT:', pagedState);
    const pagedWarn = [];
    if (pagedState.columnWidth === 'auto') pagedWarn.push('column-width 是 auto（必須是版心寬——count 路徑在 WebKit 翻頁全滅）');
    if (pagedState.pages <= 1) pagedWarn.push('頁數 <= 1（multicol overflow columns 沒長出來）');
    if (pagedState.paddingRight !== '0px') pagedWarn.push(`padding-right=${pagedState.paddingRight}（必須 0——WebKit 尾端 padding 不算進 scrollable overflow，最後一頁會錯位 56px，v0.7.231）`);
    // 鍵盤翻頁實測：→ 應讓 scrollLeft 跳一個 stride
    await page.keyboard.press('ArrowRight');
    await sleep(600); // 等 260ms 翻頁動畫 + 緩衝
    const afterTurn = await page.evaluate(() => {
      const art = document.querySelector('[data-jread-active="1"]');
      return {
        scrollLeft: art.scrollLeft,
        indicator: (document.getElementById('__jread-page-indicator') || {}).textContent
      };
    });
    console.log('PAGED 按 → 後:', afterTurn);
    if (pagedState.pages > 1 && Math.round(afterTurn.scrollLeft) !== Math.round(pagedState.stride)) {
      pagedWarn.push(`翻頁後 scrollLeft=${afterTurn.scrollLeft}，預期 stride=${pagedState.stride}`);
    }
    console.log(pagedWarn.length
      ? '⚠️ PAGED WARNINGS:\n' + pagedWarn.map(w => '  ⚠️ ' + w).join('\n')
      : '✅ PAGED AUDIT 通過（column-width 路徑 + 多頁 + 鍵盤翻頁 stride 正確）');
  }

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
    // 這是 forcing function：cleaner rule 跑完若仍有雜訊可見，這裡一定報
    // WARNING——避免之前「grep 沒命中 = 清乾淨」的偽陰性驗收。
    // 實作在 audit-lib.js（與 page-rounds 共用同一份）。
    const residual = await audits.runResidualText(page, NOISE_KEYWORD_TIERS);

    function printAudit(label, r) {
      console.log(`\n===== RESIDUAL AUDIT (${label}) =====`);
      console.log(`reader card 內 visible heading/a/button 總數: ${r.total}`);
      if (r.warnings && r.warnings.length > 0) {
        console.log(`\n⚠️  殘留雜訊 ${r.warnings.length} 項（cleaner rule 漏網）：`);
        for (const w of r.warnings) {
          console.log(`   [${w.severity || 'strict'}] ${w.tag}.${w.elCls || '(anon)'} [${w.hitKeywords.join(', ')}] "${w.text}"`);
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
    // 後自動巡視這些位置。threshold 與實作在 audit-lib.js。
    const runGapAudit = () => audits.runGapAudit(page);

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

    // ---- Contrast audit：reader card 內 visible 文字 vs effective bg 對比 ----
    // Jimmy 2026-06-07 回報 tymscar code block 白底白字後加的第三層 audit。
    // 訊號層次：本 audit 驗「文字色 vs effective bg（ancestor 爬升 + alpha
    // 合成）的 WCAG 對比」；不驗圖片 / iframe 內部內容（DOM 摸不到）、不驗
    // ::before / ::after pseudo 文字、不驗 opacity / filter 造成的視覺淡化。
    // < 3:1（WCAG 大字 / UI 元件下限）即 ⚠️——residual / gap audit 都抓不到
    // 這類「東西在、看不見」的 bug，grep keyword 更不可能命中。forcing
    // function：修 styler / theme 類改動後驗收必看本段。實作在 audit-lib.js。
    const runContrastAudit = () => audits.runContrastAudit(page);

    function printContrastAudit(label, c) {
      console.log(`\n===== CONTRAST AUDIT (${label}) =====`);
      if (c.error) { console.log(c.error); console.log('==========================\n'); return; }
      if (!c.warnings || c.warnings.length === 0) {
        console.log(`✅ 無 < 3:1 低對比文字（掃描 ${c.scanned} 個 visible 文字載體）`);
      } else {
        console.log(`⚠️  ${c.warnings.length} 項低對比文字（< 3:1，styler theme / bg strip 誤傷或站點 dark scheme 色被白卡吃掉）：`);
        for (const w of c.warnings) {
          console.log(`   ${String(w.ratio).padStart(5)}:1  ${w.tag}.${w.cls || '(anon)'} fg=${w.color} bg=${w.bg} "${w.text}"`);
        }
      }
      console.log('==========================\n');
    }

    const contrastInitial = await runContrastAudit();
    printContrastAudit('initial, 1.2s post-toggle', contrastInitial);

    // ===== WIDTH AUDIT（v0.7.246）=====
    // 驗「內文段落寬度 == reader card 版心內距寬」。Jimmy roomie.tw 回報：
    // 圖片 / 標題撐滿版心、內文段落卻左右窄一截（中間 wrapper 帶水平 padding
    // 把內文壓窄）。styler 的 enforceContentWidth 自我檢查應把內文撐回滿版。
    // 本 audit 是 forcing function：頂層內文 p（非 blockquote/li/figure/table
    // 內）的 content-box 寬若比 card 版心窄 > 2px → ⚠️。
    // 翻頁模式 multicol 下 card clientWidth 含全部欄、量不準，--paged 時跳過。
    // 這條驗「視覺幾何」層，不驗「CSS 字串」——padding 被清但元素若被別的
    // rule 再夾窄也抓得到。實作在 audit-lib.js。
    if (!PAGED) {
      const widthAudit = await audits.runContentWidthAudit(page);
      console.log('\n===== WIDTH AUDIT (initial) =====');
      if (widthAudit.error) {
        console.log('  ', widthAudit.error);
      } else if (widthAudit.narrow.length === 0) {
        console.log(`✅ 內文符合版心寬（card 版心 ${widthAudit.cardContentW}px，檢查 ${widthAudit.checked} 段全部滿版）`);
      } else {
        console.log(`⚠️ ${widthAudit.narrow.length} 段內文窄於版心 ${widthAudit.cardContentW}px（enforceContentWidth 漏網）：`);
        for (const n of widthAudit.narrow) console.log(`   ${n.pw}px  「${n.text}…」`);
      }

      // ===== OVERFLOW AUDIT（v0.8.39）=====
      // page-rounds 一直有、debug-harness 一直沒有的訊號層——單次 debug 驗收
      // 從此也抓「元素衝出 card 右緣 / 整頁長水平 scrollbar」。翻頁模式
      // multicol 天生超出 viewport，--paged 跳過。
      const overflowAudit = await audits.runOverflowAudit(page);
      console.log('\n===== OVERFLOW AUDIT (initial) =====');
      if (overflowAudit.error) {
        console.log('  ', overflowAudit.error);
      } else if (!overflowAudit.overflow) {
        console.log(`✅ 無水平溢出（card ${overflowAudit.cardWidth}px）`);
      } else {
        console.log(`⚠️ 水平溢出：doc ${overflowAudit.docScrollWidth}px / viewport ${overflowAudit.docClientWidth}px，card ${overflowAudit.cardWidth}px`);
        for (const it of overflowAudit.items.slice(0, 5)) {
          console.log(`   ${it.tag}.${it.cls.split(' ')[0]} width=${it.width}px overflow=${it.overflowPx}px "${it.text}"`);
        }
      }

      // ===== TEXT-IMAGE OVERLAP AUDIT（圖疊文，2026-06-25）=====
      // 補洞：reader mode 應線性流，content 文字不該疊在圖片上。autocar 作者欄
      // float 頭像溢出裁切容器、bio 文字疊上去——overflow/gap/contrast 全測不到，
      // 只有文字 rect vs img rect 幾何重疊能抓。詳見 audit-lib.js auditTextImageOverlap。
      const overlapAudit = await audits.runTextImageOverlapAudit(page);
      console.log('\n===== TEXT-IMAGE OVERLAP AUDIT =====');
      if (overlapAudit.error) {
        console.log('  ', overlapAudit.error);
      } else if (!overlapAudit.overlap) {
        console.log('✅ 無圖疊文');
      } else {
        console.log(`⚠️ 圖疊文：${overlapAudit.overlapCount} 段文字疊在圖片上`);
        for (const it of overlapAudit.items.slice(0, 5)) {
          console.log(`   ${it.textEl} 疊 ${it.img}(${it.imgSize}) frac=${it.frac} "${it.text}"`);
        }
      }
    }

    // 第 2 次 audit（+3s，捕 Jimmy 回報的「文章出現後約 3 秒按鈕才注入」
    // 時機）。LINE Today 類 SPA 站點 lazy-inject 常在 toggle 後 2-4s 發
    // 生，這個時間點最接近使用者眼見為實的「突然跳出雜訊」瞬間。
    await sleep(3000);
    // 擴掃：任何 visible a/button（含空 direct text 的 icon button），
    // 用 textContent（整棵子樹的 text）作判定——LINE 分享這類
    // `<a><svg/><span>分享</span></a>` 才不會漏。實作在 audit-lib.js。
    const residual3s = await audits.runResidualLinks(page, NOISE_KEYWORD_TIERS);
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
    const residualDelayed = await audits.runResidualText(page, NOISE_KEYWORD_TIERS);
    printAudit('delayed +scroll +15s', residualDelayed);

    // delayed 時機再跑一次 gap audit（lazy-load / late inject 的 placeholder
    // 都已展開，這張最接近實機使用者看到的狀態）
    const gapDelayed = await runGapAudit();
    printGapAudit('delayed +scroll +15s', gapDelayed);

    // delayed 時機再跑一次 contrast audit（lazy-inject 的內容也要過對比檢查）
    const contrastDelayed = await runContrastAudit();
    printContrastAudit('delayed +scroll +15s', contrastDelayed);

    // ---- Shinkansen 翻譯後 audit（--shinkansen 啟用時） --------------------
    // 觸發 Shinkansen 翻譯（Google MT，免 API key），等翻譯完成後再跑一次
    // residual audit，抓「翻譯 extension 在 body 層注入/重建元素導致站名殘留」
    // 類 bug。v0.7.199 修法後 body 在 ancestor 鏈內，body 的非 ancestor 直接
    // 子元素被 CSS 隱藏——Shinkansen 翻譯不應讓任何非主文內容重新浮現。
    // --translate-first 已在 toggle 前翻譯過、主 audit 也跑在翻譯後 DOM，這裡
    // 不重複翻譯（避免多等 15s + 重複觸發）；普通 --shinkansen 才走 toggle 後翻譯。
    if (WITH_SHINKANSEN && !TRANSLATE_FIRST) {
      console.log('\n===== SHINKANSEN TRANSLATION =====');
      await triggerShinkansenTranslate(page);

      // 翻譯後 residual audit：掃整個 body（不只 article 內），抓翻譯後
      // article 外是否有可見非主文殘留。實作在 audit-lib.js。
      const residualPostTranslate = await audits.runOutsideArticle(page);

      console.log(`\n===== POST-TRANSLATION AUDIT =====`);
      console.log(`Shinkansen 翻譯元素數: ${residualPostTranslate.translatedCount}`);
      if (residualPostTranslate.outsideArticle && residualPostTranslate.outsideArticle.length > 0) {
        console.log(`\n⚠️  article 外可見文字 ${residualPostTranslate.outsideArticle.length} 項（翻譯後殘留）：`);
        for (const w of residualPostTranslate.outsideArticle) {
          console.log(`   <${w.tag}> rect=[${w.rect}] "${w.text}"`);
        }
      } else {
        console.log('✅ 翻譯後 article 外無可見文字殘留');
      }
      console.log('==========================\n');
    }
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
  // jread-page-01.png / jread-page-02.png ...，直到 scroll 到底（上限 40 頁，
  // 截斷會明確 log）。Claude Read 每張依序看，覆蓋整篇 reader card 不會漏網。
  // 同時 zoom 0.5 的縮放仍生效——每張一次吃 1.8 個 viewport 的內容。
  // 實作在 audit-lib.js（與 page-rounds 共用）。
  const PAGE_SCREENSHOT_DIR = path.join(PROJECT_ROOT, '.playwright-mcp');
  // 清掉舊 page 截圖避免混淆
  for (const f of fs.readdirSync(PAGE_SCREENSHOT_DIR)) {
    if (f.startsWith('jread-page-') && f.endsWith('.png')) {
      try { fs.unlinkSync(path.join(PAGE_SCREENSHOT_DIR, f)); } catch {}
    }
  }
  await audits.takePagedScreenshots(page, { dir: PAGE_SCREENSHOT_DIR, prefix: 'jread' });

  if (!KEEP) await ctx.close();
  else console.log('--keep, leaving open');
})().catch(e => { console.error('ERR:', e.message, e.stack); process.exit(1); });
