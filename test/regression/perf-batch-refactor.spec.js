// JRead — #12 效能重構（v1.6.29）regression
//
// 涵蓋五個子項：
//   A. cleaner canonical title 推導單一資料源（getCanonicalTitleText 合一，
//      anti-drift：og:title 推導不得再出現第二份 inline 實作）
//   B. styler zeroHoriz / figcaption floor / galleryFlex / ratioBoxes /
//      fixedHeightBoxes 讀寫批次化（source-shape forcing——退回逐元素讀寫交錯
//      會讓大頁面 enter 恢復 O(n) 強制 recalc；行為語意由既有 spec 鎖：
//      fixed-height-box-deadspace.spec / styler.spec 版心自我檢查等）
//   C. cleaner collapseInnerGridFlex 批次化（gridTargets 先收集後寫 + 巢狀
//      grid descendant 去重）
//   D. space-scroll collectBlocks 結果快取（行為：同 DOM 回同參照、mutation
//      同步失效、uninstall 拆快取）
//   E. detector probe() 記憶化（行為：TTL 內同 href 回快取，不重跑偵測）
//
// 訊號層次（CLAUDE.md 工作流原則 3）：
//   驗 —— 批次結構存在（source-shape）、快取命中/失效/拆除語意（jsdom 行為）
//   不驗 —— 真實 Chromium 的 recalc/layout 次數下降（那層由 scratchpad
//          perf-probe（CDP Performance.getMetrics）在 release 驗收時量）

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { loadFixtureWithScripts, SRC } = require('../helpers');

const ROOT = path.join(__dirname, '..', '..');
const CLEANER_SRC = SRC.cleaner;
const STYLER_SRC = SRC.styler;
const SPACE_SCROLL_SRC = fs.readFileSync(path.join(ROOT, 'jread', 'content', 'space-scroll.js'), 'utf8');
const NAMESPACE_SRC = SRC.namespace;

function extractFnBody(src, fnName) {
  const m = src.match(new RegExp('function\\s+' + fnName + '\\s*\\([^)]*\\)\\s*\\{'));
  if (!m) return null;
  const start = m.index + m[0].length;
  let balance = 1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') balance++;
    else if (src[i] === '}') { balance--; if (balance === 0) return src.slice(start, i); }
  }
  return null;
}

// ---- A. canonical title 單一資料源 ----------------------------------------
describe('perf v1.6.29 — cleaner canonical title 推導單一資料源', () => {
  it('og:title 的 querySelector 推導在 cleaner.js 只能出現一次（getCanonicalTitleText 內）', () => {
    // anti-drift forcing：歷史上四處 inline 同款推導（hideInsideArticleDirectChild
    // LinkBlocks / promoteUniqueTitleH1Into / hideInsideArticleSidebarColumns /
    // wrapperH1IsMainTitle）各自漂移。新增 og:title 消費端一律呼 getCanonicalTitleText
    const hits = CLEANER_SRC.match(/querySelector\(\s*['"]meta\[property="og:title"\]['"]\s*\)/g) || [];
    assert.strictEqual(hits.length, 1,
      `og:title querySelector 只能有一份（getCanonicalTitleText）——出現 ${hits.length} 份代表有人重新 inline 推導`);
    const fn = extractFnBody(CLEANER_SRC, 'getCanonicalTitleText');
    assert.ok(fn && /og:title/.test(fn), '唯一那份必須在 getCanonicalTitleText 內');
  });

  it('四個歷史消費端必須改呼 getCanonicalTitleText', () => {
    for (const fnName of ['hideInsideArticleDirectChildLinkBlocks', 'promoteUniqueTitleH1Into',
      'hideInsideArticleSidebarColumns', 'wrapperH1IsMainTitle']) {
      const body = extractFnBody(CLEANER_SRC, fnName);
      assert.ok(body, `找不到 ${fnName}`);
      assert.match(body, /getCanonicalTitleText\(\)/, `${fnName} 必須走 getCanonicalTitleText 單一資料源`);
    }
  });

  it('direct-text strict 比對必須收斂到 subtreeHasCanonicalTitleText', () => {
    assert.ok(extractFnBody(CLEANER_SRC, 'subtreeHasCanonicalTitleText'),
      '必須有 subtreeHasCanonicalTitleText helper');
    for (const fnName of ['hideInsideArticleDirectChildLinkBlocks', 'hideInsideArticleSidebarColumns']) {
      const body = extractFnBody(CLEANER_SRC, fnName);
      assert.match(body, /subtreeHasCanonicalTitleText/, `${fnName} 的標題區掃描必須走共用 helper`);
    }
  });
});

// ---- B. styler 批次化 source-shape ----------------------------------------
describe('perf v1.6.29 — styler 讀寫批次化（source-shape forcing）', () => {
  it('zeroHoriz / figcaption floor 必須先全讀再全寫（pending 陣列兩段式）', () => {
    assert.match(STYLER_SRC, /zeroHorizPending/,
      'zeroHoriz 必須批次化（zeroHorizPending 先收集）——退回逐元素讀寫交錯 = O(n) 強制 recalc');
    assert.match(STYLER_SRC, /capPending/,
      'figcaption 字級下限必須批次化（capPending 先收集）');
  });

  it('galleryFlex / ratioBoxes / fixedHeightBoxes 必須批次化 + snapshot 先記後寫', () => {
    assert.match(STYLER_SRC, /galleryPending/, 'galleryFlex 必須先收集候選再寫');
    assert.match(STYLER_SRC, /ratioPending/, 'ratioBoxes 必須先收集候選再批次 reset');
    assert.match(STYLER_SRC, /fixedHPending/, 'fixedHeightBoxes 必須先收集候選再批次 reset');
    // rollback 安全：寫入前先 push 進 snapshot 陣列（v1.6.27 部分快照自我還原
    // 才涵蓋批次中途拋錯時已寫入的元素）
    assert.match(STYLER_SRC, /ratioPushStart/, 'ratioBoxes 必須「先 push snapshot 再寫」＋guard 失敗移除');
    assert.match(STYLER_SRC, /fixedHPushStart/, 'fixedHeightBoxes 必須「先 push snapshot 再寫」＋guard 失敗移除');
  });
});

// ---- C. cleaner collapseInnerGridFlex 批次化 -------------------------------
describe('perf v1.6.29 — collapseInnerGridFlex 批次化', () => {
  it('必須先收集 gridTargets 再寫、descendant 掃描獨立 pass', () => {
    const body = extractFnBody(CLEANER_SRC, 'collapseInnerGridFlex');
    assert.ok(body, '找不到 collapseInnerGridFlex');
    assert.match(body, /gridTargets/, '必須先收集 gridTargets（讀）再 applyImportant（寫）');
    assert.match(body, /descTargets/, 'descendant reset 必須獨立收集 pass');
  });

  it('巢狀 grid 的 descendant 必須去重（descSeen）', () => {
    // 舊版靠「外層先寫 margin:0、內層讀到 0 自然跳過」隱性去重；批次化後讀取
    // 全在寫入前，必須顯式 Set 去重——否則同一 desc 兩份 snapshot，restore
    // 會把批次寫入的 important decls 當「原值」還原、退出殘留
    const body = extractFnBody(CLEANER_SRC, 'collapseInnerGridFlex');
    assert.match(body, /descSeen/, '必須有 descSeen 去重（巢狀 grid 雙重 snapshot 防護）');
  });
});

// ---- B2. scrollbar flash 繼承牆 -------------------------------------------
describe('perf v1.6.29 — scrollbar flash 的 body 繼承牆', () => {
  it('styler CSS 必須在 body 釘 scrollbar-color（止住 <html> toggle 的全文件繼承傳播）', () => {
    // forcing：scrollbar-color 是 inherited property，捲動 flash 在 <html> 上
    // toggle attribute 時若 body 無明確值，繼承傳播＝整份文件 style recalc
    // （Chromium 實測 wiki 5 輪捲動 recalc 3930ms；釘 body 後 183ms）。拿掉
    // 這條規則會讓捲動 jank 回歸
    assert.match(SRC.styler, /html\.\$\{HTML_CLASS\}\s+body\s*\{\s*\n?\s*scrollbar-color:\s*transparent\s+transparent\s*!important/,
      'styler 必須有 `html.${HTML_CLASS} body { scrollbar-color: transparent transparent !important }` 繼承牆');
  });
});

// ---- D. space-scroll collectBlocks 快取（行為） ----------------------------
describe('perf v1.6.29 — collectBlocks 結果快取', () => {
  function setupEnv() {
    const dom = new JSDOM(`<!doctype html><html><body>
      <article id="art">
        <p id="p1">第一段主文內容，長度足夠當作段落焦點單位使用。</p>
        <p id="p2">第二段主文內容，一樣有足夠的文字長度可以收錄。</p>
        <p id="p3">第三段主文內容，維持一致的結構與長度即可。</p>
      </article></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 'test-ext', sendMessage: () => {}, getURL: (p) => p } };
    window.eval(NAMESPACE_SRC);
    window.eval(SPACE_SCROLL_SRC);
    const doc = window.document;
    const stub = (el, top) => { el.getBoundingClientRect = () => ({ top, bottom: top + 40, left: 0, right: 600, width: 600, height: 40, x: 0, y: top }); };
    let y = 0;
    for (const p of doc.querySelectorAll('p')) { stub(p, y); y += 60; }
    return { window, doc, NS: window.__JRead, stub };
  }

  it('DOM 未變時第二次 getBlocks 回同一個陣列參照（快取命中）', () => {
    const { doc, NS } = setupEnv();
    const art = doc.getElementById('art');
    const b1 = NS.spaceScroll.getBlocks(art);
    assert.strictEqual(b1.length, 3, '三個 <p> 都要收為焦點單位');
    const b2 = NS.spaceScroll.getBlocks(art);
    assert.strictEqual(b2, b1,
      '無 DOM / 幾何變化時必須回快取（同參照）——否則 position-memory 每秒存檔都全 DOM 重掃');
  });

  it('同一 tick 內 append 新段落 → getBlocks 立即看到（takeRecords 同步失效）', () => {
    const { doc, NS, stub } = setupEnv();
    const art = doc.getElementById('art');
    const b1 = NS.spaceScroll.getBlocks(art);
    const p4 = doc.createElement('p');
    p4.id = 'p4';
    p4.textContent = '第四段：mutation 後同步查詢也必須拿到最新清單。';
    stub(p4, 180);
    art.appendChild(p4);
    // 不等 microtask——takeRecords 必須同步排空 pending 紀錄並失效快取
    const b2 = NS.spaceScroll.getBlocks(art);
    assert.notStrictEqual(b2, b1, 'mutation 後不得回 stale 快取');
    assert.ok(b2.indexOf(p4) !== -1, '新段落必須在清單內');
  });

  it('uninstall 後快取與 observer 拆除、再查詢仍可用（懶重建）', () => {
    const { doc, NS, stub } = setupEnv();
    const art = doc.getElementById('art');
    const b1 = NS.spaceScroll.getBlocks(art);
    NS.spaceScroll.uninstall();
    const p5 = doc.createElement('p');
    p5.textContent = '拆除後新增的段落，重建快取時必須收得到。';
    stub(p5, 240);
    art.appendChild(p5);
    const b2 = NS.spaceScroll.getBlocks(art);
    assert.notStrictEqual(b2, b1, 'uninstall 必須清快取');
    assert.ok(b2.indexOf(p5) !== -1, '懶重建後包含新段落');
  });

  it('window resize 失效快取', () => {
    const { window, doc, NS } = setupEnv();
    const art = doc.getElementById('art');
    const b1 = NS.spaceScroll.getBlocks(art);
    window.dispatchEvent(new window.Event('resize'));
    const b2 = NS.spaceScroll.getBlocks(art);
    assert.notStrictEqual(b2, b1, 'resize 改變幾何過濾結果，必須重掃');
  });
});

// ---- E. detector probe() 記憶化（行為） ------------------------------------
describe('perf v1.6.29 — detector probe() 記憶化', () => {
  const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eet-china-title-sibling.html');

  it('TTL 內同 href 重複 probe 回快取（不重跑偵測）', () => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const r1 = env.window.__JRead.detector.probe();
    // 把主文與所有段落整個移除（與對照組同款拆除——只拆 article/main 時
    // heuristic 仍可能靠殘餘 <p> 回 'article'，偽陽性通過）；快取命中則維持原結果
    for (const a of Array.from(env.document.querySelectorAll('article, main'))) a.remove();
    for (const p of Array.from(env.document.querySelectorAll('p'))) p.remove();
    const r2 = env.window.__JRead.detector.probe();
    assert.deepStrictEqual(r2, r1,
      'TTL 內同 href 必須回快取——popup 開啟 / SW 快速鍵流程短時間重複 GET_READER_STATE 不得重跑全頁掃描');
  });

  it('對照組：無快取時（首次呼叫）移除主文 → probe 回 siteMode null', () => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    for (const a of Array.from(env.document.querySelectorAll('article, main'))) a.remove();
    for (const p of Array.from(env.document.querySelectorAll('p'))) p.remove();
    const r = env.window.__JRead.detector.probe();
    assert.strictEqual(r.siteMode, null,
      '首次 probe（無快取）必須反映當下 DOM——證明上一條的結果來自快取而非偵測邏輯');
  });
});
