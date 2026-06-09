// JRead — C5：heading 雜訊 target 解析單一資料源（v0.8.22）
//
// 對應 code review C5：原本「命中雜訊 pattern 的 heading → 決定 hide 哪個元素」
// 的解析邏輯（closest('section,aside') → tooWide → walk-up fallback → tail-cleanup
// / 最後防線 hide(h)）在兩處各維護一份：
//   - hideInsideArticleByHeadingText（初次 clean 靜態掃描）
//   - checkDynamicNoise（MutationObserver 動態注入雜訊）
// 是同一份事實的雙實作，必然 drift——dynamic 版歷史上就漏同步靜態的 p/div/span
// 擴展 + walk-up（v0.7.31 cnyes 修法註解自承），且一直缺 tail-cleanup + 最後防線。
//
// 修法：抽共用 resolveHeadingNoiseTarget（+ hideHeadingNoiseTail），兩條 path 都
// 呼叫它。CLAUDE.md 工作流原則 5：path 合一、不靠註解防 drift。
//
// 本 spec 分兩層（CLAUDE.md 硬規則 3 訊號層次）：
//   1. 結構 forcing：兩 call site 都呼叫 resolveHeadingNoiseTarget，且不再各自
//      內嵌 closest('section,aside') 解析 / tail-cleanup literal（anti-drift）
//   2. 行為：dynamic path 因合一而補齊 tail-cleanup——動態注入「heading + 文末
//      widget sibling」（heading 為 articleEl 直接子、walk-up 回 null）時，舊
//      dynamic 直接放棄，新版比照靜態做尾段清除

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');
const { SRC } = require('../helpers');

const CLEANER_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'jread', 'content', 'cleaner.js'), 'utf8'
);

describe('cleaner C5 — heading 雜訊 target 解析單一資料源（結構 forcing）', () => {
  it('resolveHeadingNoiseTarget + hideHeadingNoiseTail 必須宣告', () => {
    assert.match(CLEANER_SRC, /function\s+resolveHeadingNoiseTarget\s*\(\s*h,\s*articleEl,\s*hidden\s*\)/,
      'cleaner.js 必須有共用 resolveHeadingNoiseTarget(h, articleEl, hidden)');
    assert.match(CLEANER_SRC, /function\s+hideHeadingNoiseTail\s*\(\s*h,\s*articleEl,\s*hidden\s*\)/,
      'cleaner.js 必須有 hideHeadingNoiseTail（walk-up 失敗的尾段清除 + 最後防線）');
  });

  it('兩條 path（靜態 hideInsideArticleByHeadingText + 動態 checkDynamicNoise）都呼叫 resolveHeadingNoiseTarget', () => {
    const staticFn = CLEANER_SRC.match(/function\s+hideInsideArticleByHeadingText[\s\S]*?\n  \}/);
    assert.ok(staticFn, '必須能抓到 hideInsideArticleByHeadingText body');
    assert.match(staticFn[0], /resolveHeadingNoiseTarget\(h,\s*articleEl,\s*hidden\)/,
      '靜態 path 必須呼叫 resolveHeadingNoiseTarget');

    const dynFn = CLEANER_SRC.match(/function\s+checkDynamicNoise[\s\S]*?\n  \}/);
    assert.ok(dynFn, '必須能抓到 checkDynamicNoise body');
    assert.match(dynFn[0], /resolveHeadingNoiseTarget\(h,\s*articleEl,\s*hiddenList\)/,
      '動態 path 必須呼叫 resolveHeadingNoiseTarget');
  });

  it('anti-drift：兩 call site 不得再各自內嵌 closest(section,aside) 解析 / tail-cleanup literal', () => {
    const staticFn = CLEANER_SRC.match(/function\s+hideInsideArticleByHeadingText[\s\S]*?\n  \}/)[0];
    const dynFn = CLEANER_SRC.match(/function\s+checkDynamicNoise[\s\S]*?\n  \}/)[0];
    for (const [name, body] of [['hideInsideArticleByHeadingText', staticFn], ['checkDynamicNoise', dynFn]]) {
      assert.ok(!/h\.closest\('section, aside'\)/.test(body),
        `${name} 不得再內嵌 h.closest('section, aside') 解析（應在 resolveHeadingNoiseTarget 內）`);
      assert.ok(!/findSafeWrapperForHeading\(h,\s*articleEl\)/.test(body),
        `${name} 不得再直接呼叫 walk-up fallback（已收斂進 resolveHeadingNoiseTarget）`);
      assert.ok(!/tailApplies/.test(body),
        `${name} 不得再內嵌 tail-cleanup（已收斂進 hideHeadingNoiseTail）`);
    }
  });
});

describe('cleaner C5 — 動態 path 補齊 tail-cleanup（行為）', () => {
  function setupDom() {
    const dom = new JSDOM(`<!DOCTYPE html><html><body><main>
      <article id="art"><h1>主標題</h1>
      <p>這是第一段夠長的主文內容，包含逗號、句號等標點，足夠通過字數門檻與含主文保護判定不被誤砍。</p>
      <p>這是第二段主文內容，持續描述補充，維持足夠長度避免整個容器被當成空殼或雜訊處理。</p>
      </article></main></body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
    const { window } = dom;
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    window.chrome = { runtime: { getManifest: () => ({ version: '0.0.0-test' }), id: 't', sendMessage: () => {}, getURL: (p) => 'x/' + p } };
    window.eval(SRC.namespace);
    window.eval(SRC.cleaner);
    return window;
  }

  it('動態注入「延伸閱讀 heading + 文末 widget」（heading 為 articleEl 直接子）→ 兩者都被 hide', async () => {
    const window = setupDom();
    const doc = window.document;
    const art = doc.getElementById('art');
    const NS = window.__JRead;

    const hidden = NS.cleaner.clean(art);
    assert.ok(Array.isArray(hidden), 'clean 必須回傳 hidden 陣列');

    // 動態注入：heading（命中 NOISE_HEADING_TEXT_RE）+ 文末 widget（無主文長 p、
    // 無 noise class——只能靠 heading 的 tail-cleanup 連坐 hide）。兩者皆 articleEl
    // 直接子 → walk-up 回 null → 走 hideHeadingNoiseTail。
    const heading = doc.createElement('h2');
    heading.textContent = '延伸閱讀';
    const widget = doc.createElement('ul');
    widget.innerHTML = '<li><a href="#a">相關文章一</a></li><li><a href="#b">相關文章二</a></li>';
    art.append(heading, widget);

    // 等 MutationObserver callback（checkDynamicNoise → resolveHeadingNoiseTarget）
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(heading.dataset.jreadHidden, '1',
      '動態注入的「延伸閱讀」heading 應被 hide');
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      '文末 widget（heading 之後的 sibling）應被 tail-cleanup 連坐 hide（dynamic 補齊靜態行為）');

    NS.cleaner.restore(hidden);
  });

  it('保護：動態注入「heading + 仍含主文長 p 的 sibling」→ tail-cleanup abort，不誤殺主文', async () => {
    const window = setupDom();
    const doc = window.document;
    const art = doc.getElementById('art');
    const NS = window.__JRead;

    const hidden = NS.cleaner.clean(art);

    const heading = doc.createElement('h2');
    heading.textContent = '延伸閱讀';
    // heading 之後的 sibling 仍含主文長 p（>= 100 chars，包在內容塊 div 內——
    // tail-cleanup 的 allWidgetsAfter guard 查的是後代 p）→ allWidgetsAfter=false
    // → tail-cleanup abort（只剩最後防線 hide heading 自己，不碰主文塊）
    const realBlock = doc.createElement('div');
    realBlock.innerHTML = '<p>這是動態補進來的延續主文長段落，內容充足、標點齊全，長度明顯超過一百字門檻，'
      + '不應該因為前面那個延伸閱讀 heading 而被 tail-cleanup 誤判為文末 widget 一起砍掉，必須被保留下來。</p>';
    art.append(heading, realBlock);

    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(heading.dataset.jreadHidden, '1',
      'heading 本身仍應被 hide（最後防線）');
    assert.notStrictEqual(realBlock.dataset && realBlock.dataset.jreadHidden, '1',
      'heading 之後仍含主文長 p 時 tail-cleanup 必須 abort，主文塊不可被誤殺');

    NS.cleaner.restore(hidden);
  });
});
