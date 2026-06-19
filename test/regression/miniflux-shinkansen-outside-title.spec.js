// JRead — regression spec: 翻譯頁標題改放 articleEl 外（v0.8.131）
// -----------------------------------------------------------------------------
// Forcing function for placePromotedTitleClone：當頁面被翻譯擴充（Shinkansen 等）
// 接管時，promote 進 articleEl 的標題 clone 會被該擴充的 content guard 每秒
// reconcile articleEl 子節點時清掉（cage 實證：插入後 ~200ms 內被移走、之後每秒
// 重清；換 plain h1 / div wrap / 移 Shinkansen 自己的 h1 進 articleEl 全部撐不過
// 幾秒）。唯一存活位置是 articleEl「外」（前一個 sibling）。
//
// Trigger: Jimmy 2026-06-19 回報 https://afu.jacob-themis.ts.net:8443/history/entry/1803
// 「Shinkansen 翻譯後進入閱讀模式，大標題就不見了」。
//
// 修法：promoteUniqueTitleH1Into / promoteArticleTitleClassHeadingInto 的插入
// 位置改由 placePromotedTitleClone 決定——translationGuardActive()（頁面存在
// [data-shinkansen-translated] / [data-shinkansen-dual-source]）為真時把 clone
// 插在 articleEl 前一個 sibling、標 data-jread-promoted-outside；否則維持原本
// in-article promote（baseline 不動）。styler 對齊卡片寬度/置中/背景。
//
// 訊號層次：本 spec 驗「placement 決策邏輯」（jsdom 跑得到）；翻譯擴充 guard 不
// 清外層、與 styler 視覺合併（卡片融合）只能在真實 Chrome + Shinkansen 驗，已於
// cage 自驗（outside clone 存活 8s+、標題以卡片標題樣式顯示、與卡片合併單張）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'miniflux-shinkansen-outside-title.html');

describe('cleaner — 翻譯頁標題放 articleEl 外（v0.8.131，guard active）', () => {
  let window, document, articleEl, hidden;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('.entry-content');
    assert.ok(articleEl, 'fixture 必須含 .entry-content（articleEl）');
    hidden = window.__JRead.cleaner.clean(articleEl);
  });

  // -------- (a) fixture 結構數值驗證 --------
  it('(a) fixture: doc title 英文、h1 中文 + data-shinkansen-translated、唯一 h1', () => {
    assert.ok(/Ferrari to blend/.test(document.title), `doc title 必須英文，實際：${document.title}`);
    // 原始 h1（不含 promote 出來的 clone 內副本）必須恰好 1 個——promote 前置條件
    const origH1s = Array.from(document.querySelectorAll('h1'))
      .filter(h => !h.closest('[data-jread-promoted-outside="1"]'));
    assert.strictEqual(origH1s.length, 1, `原始 h1 必須恰好 1 個（promote 前置條件），實際 ${origH1s.length}`);
    const h1 = origH1s[0];
    assert.strictEqual(h1.id, 'page-header-title', 'h1 id 必須 page-header-title（fallback title token 訊號）');
    assert.strictEqual(h1.getAttribute('data-shinkansen-translated'), '1',
      'h1 必須帶 data-shinkansen-translated（翻譯 guard 訊號）');
    assert.ok(/將於七月初發表/.test(h1.textContent), `h1 必須是中文譯文，實際：${h1.textContent}`);
    assert.ok(!articleEl.contains(h1), 'h1 必須在 articleEl 外（Miniflux entry-header 結構）');
  });

  // -------- (b) 核心：標題 clone 放 articleEl「外」（前一個 sibling）--------
  it('(b) 標題 clone 放 articleEl 外、標 data-jread-promoted-outside', () => {
    const outside = document.querySelector('[data-jread-promoted-outside="1"]');
    assert.ok(outside, '必須有 data-jread-promoted-outside 標題 clone');
    assert.ok(outside.hasAttribute('data-jread-title-clone'),
      'promoted-outside clone 必須同時帶 data-jread-title-clone（restore 走 __titleClone path）');
    assert.ok(!articleEl.contains(outside), 'clone 必須在 articleEl 外（避開翻譯 guard reconcile）');
    assert.strictEqual(outside.parentNode, articleEl.parentNode,
      'clone 必須是 articleEl 的兄弟（同一 parent）');
    assert.strictEqual(outside.nextElementSibling, articleEl,
      'clone 必須緊鄰排在 articleEl 前（卡片標題位置）');
    // articleEl 內不得殘留 in-article clone（否則標題重複）
    assert.strictEqual(articleEl.querySelectorAll('[data-jread-title-clone="1"]').length, 0,
      'articleEl 內不得有 in-article title clone（guard active 時一律走外層）');
  });

  // -------- (c) clone 內容含中文譯文標題 --------
  it('(c) 外層 clone 含中文譯文標題', () => {
    const outside = document.querySelector('[data-jread-promoted-outside="1"]');
    assert.ok(/將於七月初發表新作/.test(outside.textContent),
      `clone 必須含中文標題，實際：${outside.textContent}`);
  });

  // -------- (d) 原 header wrapper 被 hide（避免標題重複顯示）--------
  it('(d) 原 header.entry-header 被 hideAncestorSiblings hide', () => {
    const headers = Array.from(document.querySelectorAll('header.entry-header'))
      .filter(h => !h.hasAttribute('data-jread-promoted-outside'));
    const original = headers.find(h => !articleEl.contains(h));
    assert.ok(original, '原 header（非 clone）必須存在');
    assert.strictEqual(original.dataset.jreadHidden, '1',
      '原 header 必須被 hide（標題只在 clone 顯示一次）');
  });

  // -------- (e) 主文段落全部保留 --------
  it('(e) 主文 body-p-1 ~ p-3 全部保留', () => {
    for (let i = 1; i <= 3; i++) {
      const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(p, `主文 body-p-${i} 必須存在`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1', `主文 body-p-${i} 不可被 hide`);
    }
  });

  // -------- (f) 可逆：restore 後外層 clone 整個從 DOM 移除 --------
  it('(f) restore 後 promoted-outside clone 從 DOM 移除（不殘留 / 不堆疊）', () => {
    window.__JRead.cleaner.restore(hidden);
    assert.strictEqual(document.querySelectorAll('[data-jread-promoted-outside="1"]').length, 0,
      'restore 後不得殘留 promoted-outside clone');
  });
});

describe('cleaner — 非翻譯頁標題維持 in-article promote（v0.8.131 gating 對照）', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    // 拿掉翻譯標記 → translationGuardActive() 為 false → 走原本 in-article promote
    document.querySelectorAll('[data-shinkansen-translated]').forEach(el =>
      el.removeAttribute('data-shinkansen-translated'));
    articleEl = document.querySelector('.entry-content');
    window.__JRead.cleaner.clean(articleEl);
  });

  it('無翻譯標記時 clone 放 articleEl 內、且不標 promoted-outside（baseline 不動）', () => {
    assert.strictEqual(document.querySelectorAll('[data-jread-promoted-outside="1"]').length, 0,
      '非翻譯頁不得走外層 placement');
    const inArt = articleEl.querySelectorAll('[data-jread-title-clone="1"]');
    assert.strictEqual(inArt.length, 1,
      `非翻譯頁標題 clone 必須 promote 進 articleEl（in-article，與 v0.8.130 前行為一致），實際 ${inArt.length}`);
  });
});
