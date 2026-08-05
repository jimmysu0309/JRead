// JRead — 全面 review 批次 6：效能 + 安全（v1.7.44）
//
// 效能組（E1-E14）：行為等價的效能重構——讀寫分離、cheap gate、TreeWalker
// REJECT 整枝、掃描 scope 化、cache 共用。行為正確性由各功能的既有 spec 繼續
// 把關（dark-contrast / flex-collapse / grid-track-overflow / title 家族全數
// 沿用）；本 spec 守「重構後的結構還在、沒被改回舊寫法」這層 forcing +
// 可純測的決策函式行為。
// 安全組（X1-X2）：X1 reader-article sanitizer denylist → allowlist（行為
// 直測）；X2 panel clickjacking 握手（source forcing——跨 context messaging
// jsdom 模擬不了）。
//
// 訊號層次：source-scan 條目驗「程式碼形狀」不驗 runtime 效能數字（毫秒級
// 差異 jsdom 無法量、真實 Chrome 的效能驗證走 harness / cage instrument）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const CONTENT = path.join(ROOT, 'jread', 'content');
const read = (p) => fs.readFileSync(p, 'utf8');

const STYLER_SRC = read(path.join(CONTENT, 'styler.js'));
const CLEANER_SRC = read(path.join(CONTENT, 'cleaner.js'));
const DETECTOR_SRC = read(path.join(CONTENT, 'detector.js'));
const PM_SRC = read(path.join(CONTENT, 'position-memory.js'));
const SS_SRC = read(path.join(CONTENT, 'space-scroll.js'));
const EDIT_SRC = read(path.join(CONTENT, 'edit-mode.js'));
const FLOATING_SRC = read(path.join(CONTENT, 'floating-icon.js'));
const POPUP_SRC = read(path.join(ROOT, 'jread', 'popup', 'popup.js'));
const SW_SRC = read(path.join(ROOT, 'jread', 'background', 'service-worker.js'));
const ARTICLE = require(path.join(ROOT, 'jread', 'reader', 'reader-article.js'));
const ARTICLE_SRC = read(path.join(ROOT, 'jread', 'reader', 'reader-article.js'));
const pm = require(path.join(CONTENT, 'position-memory.js'));

const { JSDOM } = require('jsdom');
function freshDoc() {
  return new JSDOM('<!doctype html><html><body></body></html>').window.document;
}

// ---- E1：styler phase 3 對比兜底兩段式 + effective bg memoize ---------------

describe('review-b6 E1 — phase 3 對比兜底讀寫分離（v1.7.44）', () => {
  it('phase 3 必須先收集 contrastFixes 再統一寫（不再邊讀邊寫）', () => {
    assert.match(STYLER_SRC, /const contrastFixes = \[\]/,
      'phase 3 必須有 fixes worklist（讀寫分離 phase A）');
    assert.match(STYLER_SRC, /for \(const f of contrastFixes\)/,
      'phase 3 必須有統一寫入迴圈（讀寫分離 phase B）');
  });
  it('effective bg 必須沿 DOM 樹 memoize（bgMemo）', () => {
    assert.match(STYLER_SRC, /const bgMemo = new Map\(\)/,
      '祖先鏈 effective bg 必須 memoize——兄弟元素共用祖先段快取');
  });
});

// ---- E2：visibleRenderedText cheap 閘門 -------------------------------------

describe('review-b6 E2 — visibleRenderedText textContent 快速閘門（v1.7.44）', () => {
  it('visibleRenderedText 開頭必須有 norm(textContent) 空字串閘門', () => {
    const m = CLEANER_SRC.match(/function visibleRenderedText\(el\) \{[\s\S]*?\n  \}/);
    assert.ok(m, '找得到 visibleRenderedText');
    assert.match(m[0], /norm\(el\.textContent\)\.length === 0\) return ''/,
      'textContent 全集為空 → visible 子集必空，須跳過逐節點 getComputedStyle 慢路');
  });
});

// ---- E3：position-memory 寫入節流 ------------------------------------------

describe('review-b6 E3 — position-memory 整包寫入節流（v1.7.44）', () => {
  it('writeThrottleDelay：force 一律 0（flush 路徑立即落盤）', () => {
    assert.strictEqual(pm.writeThrottleDelay(1000, 900, true), 0);
    assert.strictEqual(pm.writeThrottleDelay(0, 0, true), 0);
  });
  it('writeThrottleDelay：窗口外 0、窗口內回剩餘毫秒', () => {
    const T = pm.MIN_WRITE_INTERVAL_MS;
    assert.strictEqual(pm.writeThrottleDelay(10000 + T, 10000, false), 0, '滿窗口 → 立即寫');
    assert.strictEqual(pm.writeThrottleDelay(10000 + T - 1200, 10000, false), 1200,
      '窗口內 → 回剩餘毫秒（trailing 寫入補最後位置）');
    assert.strictEqual(pm.writeThrottleDelay(500, 0, false), T - 500, 'lastTs 未設（0）也照算');
  });
  it('flushNow 必須走 persistNow(true)（略過節流）', () => {
    const m = PM_SRC.match(/function flushNow\(\) \{[\s\S]*?\n  \}/);
    assert.ok(m && /persistNow\(true\)/.test(m[0]),
      'flush（pagehide / hidden / endSession）不可被節流吃掉——iOS 背景凍結防護的落盤點');
  });
  it('persistNow 節流分支必須排 trailing 寫入（不丟最後位置）', () => {
    const m = PM_SRC.match(/function persistNow\(force\) \{[\s\S]*?\n  \}/);
    assert.ok(m, 'persistNow 有 force 參數');
    assert.match(m[0], /writeThrottleDelay\(now, lastWriteTs, !!force\)/, '節流決策走純函式單一資料源');
    assert.match(m[0], /setTimeout\(\(\) => \{ saveTimer = null; persistNow\(\); \}, delay\)/,
      '窗口內必須排 trailing timer，否則停止捲動後的最後位置永不落盤');
  });
});

// ---- E4：space-scroll blocksCache observer attributeFilter -------------------

describe('review-b6 E4 — blocksCache observer attributeFilter（v1.7.44）', () => {
  it('MutationObserver 必須帶 attributeFilter 且不再訂 characterData', () => {
    const m = SS_SRC.match(/blocksCacheMo\.observe\(root, \{[\s\S]*?\}\)/);
    assert.ok(m, '找得到 observer options');
    assert.match(m[0], /attributeFilter: \['style', 'class', 'hidden', 'data-jread-hidden', 'loading'\]/,
      'lazy loader 的 src/srcset 風暴不可再打失效快取（v1.6.29 快取退化回全掃的病灶）');
    assert.doesNotMatch(m[0], /characterData/,
      '純文字替換不改 block 收集結果，幾何變化由 ResizeObserver 訊號接');
  });
});

// ---- E5：overflow-right cheap gate ------------------------------------------

describe('review-b6 E5 — overflow-right scrollWidth cheap gate（v1.7.44）', () => {
  it('overflow pass 必須 gate 在 articleEl.scrollWidth > clientWidth', () => {
    assert.match(STYLER_SRC,
      /!opts\.pagedMode && articleEl\.scrollWidth > articleEl\.clientWidth \+ 2/,
      '無水平溢出時整段 O(全子樹) rect 掃描必須跳過');
  });
  it('行為：無水平溢出（scrollWidth == clientWidth）時 grid 容器不被塌', () => {
    // 與 nyt-grid-track-overflow.spec 同 fixture、但不 stub scrollWidth（jsdom
    // 恆 0 = 無溢出）→ gate 生效、gridfit 不動
    const { loadFixtureWithScripts, stubRect } = require('../helpers');
    const env = loadFixtureWithScripts({
      fixturePath: path.join(__dirname, 'fixtures', 'nyt-grid-track-overflow.html'),
      scripts: ['detector', 'styler'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const { document } = env;
    const $ = (id) => document.getElementById(id);
    stubRect($('art'), { left: 0, top: 0, width: 720, height: 4000 });
    stubRect($('gridfit'), { left: 0, top: 100, width: 720, height: 600 });
    stubRect($('wideitem'), { left: 64, top: 100, width: 1024, height: 600 });
    env.NS.styler.apply($('art'), {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, paragraphSpacing: 1.0
    });
    assert.notStrictEqual($('gridfit').style.display, 'block',
      'scrollWidth 未超過 clientWidth → cheap gate 應整段跳過、容器不塌');
  });
});

// ---- E6：hideFixedOutsideArticle TreeWalker REJECT --------------------------

describe('review-b6 E6 — hideFixedOutsideArticle 整枝跳過（v1.7.44）', () => {
  it('必須用 TreeWalker、REJECT articleEl 子樹與已 hide 子樹', () => {
    const m = CLEANER_SRC.match(/function hideFixedOutsideArticle\([\s\S]*?\n  \}/);
    assert.ok(m, '找得到 hideFixedOutsideArticle');
    assert.match(m[0], /createTreeWalker/, '必須走 TreeWalker（取代 querySelectorAll 全掃）');
    assert.match(m[0], /el === articleEl\) return NodeFilter\.FILTER_REJECT/,
      '主文子樹必須在 articleEl 一個節點 REJECT 整枝');
    assert.match(m[0], /jreadHidden === '1'\) return NodeFilter\.FILTER_REJECT/,
      '已 hide 子樹必須 REJECT（省整片 getComputedStyle）');
    assert.match(m[0], /el\.contains\(articleEl\)\) return NodeFilter\.FILTER_SKIP/,
      '主文祖先自身 SKIP 但要走進其他分支（site chrome 掛在祖先層）');
  });
});

// ---- E7：checkDynamicNoise custom element 掃描 hyphen 先篩 -------------------

describe('review-b6 E7 — custom element 掃描 hyphen 先篩（v1.7.44）', () => {
  it('custom element 子孫掃描必須先以 localName 含 - 篩掉一般元素', () => {
    const m = CLEANER_SRC.match(
      /customElementIsInteractiveWidget\(node\)[\s\S]{0,900}for \(const el of node\.querySelectorAll\('\*'\)\) \{[\s\S]*?\n      \}/);
    assert.ok(m, '找得到 checkDynamicNoise 的 custom element 子孫掃描');
    const idxHyphen = m[0].indexOf("el.localName.indexOf('-') < 0) continue");
    const idxClosest = m[0].indexOf("el.closest('[data-jread-hidden=\"1\"]')");
    assert.ok(idxHyphen !== -1, '必須有 hyphenated tag 先篩');
    assert.ok(idxClosest === -1 || idxHyphen < idxClosest,
      'hyphen 篩必須在 closest 慢檢查之前（React 整棵 re-append 數千節點的主要成本）');
  });
});

// ---- E8：subtreeHasLongNonAnchorText REJECT 整枝 -----------------------------

describe('review-b6 E8 — subtreeHasLongNonAnchorText REJECT 整枝（v1.7.44）', () => {
  it('必須 root 一次祖先判定 + filter REJECT，不再逐節點 closest', () => {
    const m = CLEANER_SRC.match(/function subtreeHasLongNonAnchorText\([\s\S]*?\n  \}/);
    assert.ok(m, '找得到 subtreeHasLongNonAnchorText');
    assert.match(m[0], /root\.closest\('a'\) \|\| root\.closest\('\[data-jread-hidden="1"\]'\)\)\) return false/,
      'root 自身在 <a> / 已隱藏子樹內 → 整棵必然排除，一次判定');
    assert.match(m[0], /el\.localName === 'a'\) return NodeFilter\.FILTER_REJECT/,
      '<a> 子樹必須 REJECT 整枝（localName 同時涵蓋 SVG <a>）');
    assert.match(m[0], /jreadHidden === '1'\) return NodeFilter\.FILTER_REJECT/,
      '已隱藏子樹必須 REJECT 整枝');
    // 迴圈內不得殘留逐節點 closest（O(n×depth) 舊寫法防復活）
    const loop = m[0].slice(m[0].indexOf('while (el)'));
    assert.doesNotMatch(loop, /closest\(/, '走訪迴圈內不得再逐節點 closest');
  });
});

// ---- E9：collapseInnerFlexWrap 讀寫分離 -------------------------------------

describe('review-b6 E9 — collapseInnerFlexWrap 讀寫分離（v1.7.44）', () => {
  it('必須 phase 1 收 writes worklist、phase 2 統一寫（比照 collapseGridWithHiddenCell）', () => {
    const m = CLEANER_SRC.match(/function collapseInnerFlexWrap\([\s\S]*?\n  \}/);
    assert.ok(m, '找得到 collapseInnerFlexWrap');
    assert.match(m[0], /const writes = \[\]/, 'phase 1 必須收 worklist');
    assert.match(m[0], /for \(const w of writes\)/, 'phase 2 必須統一寫');
    assert.match(m[0], /descWritten/,
      '巢狀 container 重複收到的 absolute 後代必須去重（否則第二份 snapshot 記到第一份寫入、restore 殘留）');
  });
});

// ---- E10：stackLopsidedImgCol 合併單次遍歷 -----------------------------------

describe('review-b6 E10 — stackLopsidedImgCol 合併進 anchor 2 迴圈（v1.7.44）', () => {
  it('img 掃描迴圈只剩一個、stackLopsidedImgCol 在其中呼叫', () => {
    const calls = STYLER_SRC.match(/stackLopsidedImgCol\(m\)/g) || [];
    assert.strictEqual(calls.length, 1, 'stackLopsidedImgCol 只在合併後的單一 img 迴圈呼叫');
    // 呼叫點必須在 A-parent skip 之前（stack 規則不豁免 <a> 內 avatar）
    const loop = STYLER_SRC.match(/stackLopsidedImgCol\(m\);[\s\S]{0,400}/)[0];
    assert.match(loop, /parentElement\.tagName === 'A'/,
      'stack 呼叫點之後才是 decolumn 的 A-parent skip（順序不可對調，<a> 內 avatar 要能 stack）');
  });
});

// ---- E11：markHeadingLinks scope 化 -----------------------------------------

describe('review-b6 E11 — remarkDynamicMarkers heading 掃描 scope 化（v1.7.44）', () => {
  it('markHeadingLinks 必須有 scopeEl 參數、dynamic path 只掃新增子樹', () => {
    assert.match(STYLER_SRC, /function markHeadingLinks\(articleEl, marked, scopeEl\)/,
      'markHeadingLinks 必須收 scopeEl');
    const m = STYLER_SRC.match(/remarkDynamicMarkers\(node\) \{[\s\S]*?\n    \}/);
    assert.ok(m, '找得到 remarkDynamicMarkers');
    assert.match(m[0], /markHeadingLinks\(s\.articleEl, s\.headingLinkMarked, wrapA \|\| node\)/,
      'dynamic path 必須傳 scope（wrapA 往上補「新 heading 掛進既有 <a>」的一段）');
  });
});

// ---- E12：detect/probe 共用祖先鏈 cache -------------------------------------

describe('review-b6 E12 — detect()/probe() 外包 withAncestorCache（v1.7.44）', () => {
  it('detect 主體必須包在 withAncestorCache 內', () => {
    assert.match(DETECTOR_SRC, /withAncestorCache\(\(\) => this\._detectStrategiesAndRefine\(\)\)/,
      'detect 全程（四策略 + promote / narrow / ensureH1）共用一份祖先鏈 cache');
  });
  it('probe 的策略鏈必須包在 withAncestorCache 內', () => {
    assert.match(DETECTOR_SRC, /const hit = withAncestorCache\(\(\) => \(/,
      'probe 四策略共用一份 cache');
  });
});

// ---- E13：edit-mode textLen collect 期間快取 --------------------------------

describe('review-b6 E13 — edit-mode textLen collect 快取（v1.7.44）', () => {
  it('textLen 必須支援 cache、collectBlocks 開關 cache', () => {
    assert.match(EDIT_SRC, /let textLenCache = null/, '必須有 cache 槽');
    const collect = EDIT_SRC.match(/function collectBlocks\(\) \{[\s\S]*?\n  \}/)[0];
    assert.match(collect, /textLenCache = new Map\(\)/, 'collect 開始必須開 cache');
    assert.match(collect, /finally \{\s*textLenCache = null;/, 'collect 結束必須棄 cache（finally 保證）');
  });
});

// ---- E14：markPromotedTitleIfMissing 粗篩 -----------------------------------

describe('review-b6 E14 — markPromotedTitleIfMissing 掃描粗篩（v1.7.44）', () => {
  it('候選掃描必須先 raw 長度粗篩再 normalizeTitle', () => {
    assert.match(DETECTOR_SRC, /const RAW_LEN_CAP = baseTitle\.length \* 4 \+ 40/,
      'raw 粗篩門檻存在');
    assert.match(DETECTOR_SRC, /rawT\.length < 10 \|\| rawT\.length > RAW_LEN_CAP\) continue/,
      '候選迴圈必須在 normalize 前粗篩（normalize regex 對主文級 wrapper 全文是最大成本）');
  });
  it('去重掃描必須用 bounded 淺走訪取代 querySelectorAll(*) 計數', () => {
    assert.match(DETECTOR_SRC, /hasAtMostNDescendants/,
      '後代數判定必須 bounded（最多走 max+1 個元素即定案）');
    const dedup = DETECTOR_SRC.match(/const hasAtMostNDescendants[\s\S]*?hidePromotedTitleSource\(el\);\s*\n      \}/);
    assert.ok(dedup && !/querySelectorAll\('\*'\)\.length/.test(dedup[0]),
      '去重迴圈不得殘留 querySelectorAll(\'*\').length');
  });
});

// ---- X1：reader-article allowlist sanitizer（行為直測）----------------------

describe('review-b6 X1 — sanitizer allowlist（v1.7.44）', () => {
  it('form action="javascript:" 整棵移除（舊 denylist 缺口）', () => {
    const document = freshDoc();
    const clean = ARTICLE.sanitizeHtml('<p>a</p><form action="javascript:alert(1)"><input value="x"><button>go</button></form>', document);
    assert.ok(!/form|input|button/i.test(clean), 'form 與表單控制項必須整棵移除');
    assert.ok(clean.includes('a'), '主文保留');
  });
  it('svg / math 整棵移除（SMIL / mXSS 載體）', () => {
    const document = freshDoc();
    const clean = ARTICLE.sanitizeHtml(
      '<p>t</p><svg><animate attributeName="href" values="javascript:alert(1)"/></svg><math><mtext>x</mtext></math>', document);
    assert.ok(!/<svg|<animate|<math/i.test(clean), 'svg/math 必須整棵移除（含子孫）');
  });
  it('未知標籤 unwrap 保留文字（custom element / 舊式標籤不掉字）', () => {
    const document = freshDoc();
    const clean = ARTICLE.sanitizeHtml('<p>前</p><my-widget>內文字<b>粗</b></my-widget><center>置中字</center>', document);
    assert.ok(!/my-widget|<center/i.test(clean), '未知標籤本體必須拆掉');
    assert.ok(clean.includes('內文字') && clean.includes('置中字'), 'unwrap 不可掉字');
    assert.ok(/<b>粗<\/b>/.test(clean), 'unwrap 後合法子元素保留');
  });
  it('on* 與未知屬性剝除；data-* 保留但 data-jread* 剝除', () => {
    const document = freshDoc();
    const clean = ARTICLE.sanitizeHtml(
      '<p onclick="x()" onmouseover="y()" data-foo="1" data-jread-hidden="1" custom-attr="z" class="c">t</p>', document);
    assert.ok(!/onclick|onmouseover/.test(clean), 'on* 必須剝除');
    assert.ok(!/custom-attr/.test(clean), '未知屬性必須剝除（allowlist 語意）');
    assert.ok(!/data-jread/.test(clean), 'data-jread* 必須剝除（不讓內容預埋內部 marker）');
    assert.ok(clean.includes('data-foo="1"'), '一般 data-* 保留');
    assert.ok(clean.includes('class="c"'), 'class 保留');
  });
  it('javascript: / vbscript: URL 屬性移除（含控制字元繞法）', () => {
    const document = freshDoc();
    const clean = ARTICLE.sanitizeHtml(
      '<a href="java\tscript:alert(1)">x</a><img src="vbscript:evil"><a href="https://ok.example/">ok</a>', document);
    assert.ok(!/javascript:|vbscript:/i.test(clean.replace(/\s/g, '')), '危險 scheme 必須移除');
    assert.ok(clean.includes('https://ok.example/'), '正常 URL 保留');
  });
  it('id 保留（footnote 錨點）但 __ 前綴移除（防 clobbering jread 注入 UI）', () => {
    const document = freshDoc();
    const clean = ARTICLE.sanitizeHtml('<p id="fn1">note</p><p id="__jread-style">x</p>', document);
    assert.ok(clean.includes('id="fn1"'), 'footnote id 保留');
    assert.ok(!clean.includes('__jread-style'), '__ 前綴 id 必須移除');
  });
  it('buildArticleContainer 走 sanitizeDom 搬節點（不二次 innerHTML parse）', () => {
    assert.match(ARTICLE_SRC, /const cleaned = sanitizeDom\(doc && doc\.html_content, document\)/,
      'body 組裝必須走 sanitizeDom');
    assert.match(ARTICLE_SRC, /while \(cleaned\.firstChild\) body\.appendChild\(cleaned\.firstChild\)/,
      '必須搬移節點——serialize 再 parse 的語境差是 mXSS 典型載體');
  });
});

// ---- X2：panel clickjacking 握手（source forcing）---------------------------

describe('review-b6 X2 — panel clickjacking 握手（v1.7.44）', () => {
  it('floating-icon 開 iframe 前必須送 PANEL_OPENED 登記', () => {
    const m = FLOATING_SRC.match(/function openFeaturePanelIframe\(\) \{[\s\S]*?frame\.src = popupUrl/);
    assert.ok(m, '找得到 openFeaturePanelIframe');
    assert.match(m[0], /type: NS\.MSG\.PANEL_OPENED/,
      'iframe 建立前必須向 SW 登記（sender.tab 為證、頁面 JS 無法偽造）');
  });
  it('SW 必須有 PANEL_OPENED / PANEL_HANDSHAKE case + 單次消費 TTL 驗證', () => {
    assert.match(SW_SRC, /case 'PANEL_OPENED':/, 'SW 登記 case');
    assert.match(SW_SRC, /case 'PANEL_HANDSHAKE':/, 'SW 驗證 case');
    assert.match(SW_SRC, /PANEL_TOKEN_TTL_MS/, '登記必須有 TTL');
    const consume = SW_SRC.match(/async function consumePanelOpen\([\s\S]*?\n\}/);
    assert.ok(consume, '找得到 consumePanelOpen');
    assert.match(consume[0], /storage\.session\.remove|panelOpenMem\.delete/,
      '驗證必須單次消費（驗過即銷毀，token 不可重放）');
  });
  it('popup panel 模式必須握手、未驗證前 capture 攔下互動', () => {
    assert.match(POPUP_SRC, /type: 'PANEL_HANDSHAKE'/, 'popup 必須送握手');
    assert.match(POPUP_SRC, /let panelVerified = !IS_PANEL/,
      '非 panel（原生工具列 popup）不受影響');
    assert.match(POPUP_SRC, /document\.addEventListener\('click', blockUnverified, true\)/,
      '未驗證前必須 capture 層攔 click');
    assert.match(POPUP_SRC, /document\.addEventListener\('change', blockUnverified, true\)/,
      '未驗證前必須 capture 層攔 change');
  });
});
