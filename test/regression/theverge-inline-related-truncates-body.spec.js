// JRead — The Verge 行內 Related 推薦 widget 把後半正文整段截斷（v0.8.133）
//
// 對應 bug（Jimmy 2026-06-20 截圖，Miniflux share 頁 + cage 真 Chrome 重現）：
//   進閱讀模式後文章在中段「ROUND LAB'S ORIGINAL KOREAN FORMULATION…」說明處
//   被截斷，後半正文（FDA 灰市段等）全部消失。
//
// 根因（cleaner.js hideHeadingNoiseTail）：文章中段插一個行內「Related」推薦
// widget（<h3>Related</h3> + 無 class 的 link-feed <ul>）。tail-cleanup 的
// after-check 舊版只查 next.querySelectorAll('p')（後代 p），對「sibling 自身
// 就是直接 <p>」回傳空 → The Verge 正文段落（article 的直接 <p> 子節點）被
// 誤判成 widget → allWidgetsAfter 維持 true → 從 Related 一路 hide 到文末。
//
// 修法：tail-cleanup 改逐 sibling 走、遇第一個「含主文長段（自身是長 <p> 或
// 內含長 <p>）」的 sibling 即停 — 行內 widget 只藏到正文段前、保住後續主文；
// 文末整段 widget（無後續主文）仍藏到底（與舊行為等價）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'theverge-inline-related-truncates-body.html');

describe('cleaner — The Verge 行內 Related widget 不可截斷後半正文（v0.8.133）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    articleEl = document.querySelector('article');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  const sel = s => document.querySelector(`[data-test="${s}"]`);
  function isHiddenWithin(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
      cur = cur.parentElement;
    }
    return false;
  }

  it('fixture 結構：行內 Related widget 後的正文是 article 的「直接 <p> 子節點」（bug 觸發條件）', () => {
    const after1 = sel('body-after-1');
    assert.strictEqual(after1.tagName, 'P');
    assert.strictEqual(after1.parentElement, articleEl, '正文段落必須是 article 直接子（querySelectorAll(p) 對它回空）');
    assert.ok(after1.textContent.replace(/\s+/g, ' ').trim().length >= 100, '正文段 >= 100 chars');
    assert.strictEqual(sel('inline-related-list').querySelectorAll('p').length, 0, 'Related widget 內無 <p>（link feed）');
  });

  it('核心保護：行內 Related widget 之後的真正文段落全部保留（不可截斷）', () => {
    for (const k of ['body-after-1', 'body-after-2', 'body-after-3']) {
      assert.ok(!isHiddenWithin(sel(k)), `${k} 是 Related widget 之後的真正文，必須保留不被 tail-cleanup 連坐截斷`);
    }
  });

  it('行內 Related widget 本身（heading + 連結列表）仍須被 hide', () => {
    assert.ok(isHiddenWithin(sel('inline-related-heading')), '行內 Related heading 須被 hide');
    assert.ok(isHiddenWithin(sel('inline-related-list')), '行內 Related 連結列表（無 class）須由 heading tail-cleanup 連坐 hide');
  });

  it('文末真噪 section（Top Stories + 連結列表）仍須藏到底（tail-cleanup 末段行為不變）', () => {
    assert.ok(isHiddenWithin(sel('trailing-noise-heading')), '文末 Top Stories heading 須被 hide');
    assert.ok(isHiddenWithin(sel('trailing-noise-list')), '文末推薦列表須被 hide');
  });

  it('文末「Most Popular」排行 widget heading 須被 hide（v0.8.133 補 NOISE_HEADING regex）', () => {
    // 修法移除舊貪婪 tail 連坐後，「Most Popular」這類以 Most 開頭的排行 widget
    // 標題（^popular 錨定吃不到）會漏網 → 補 ^most\s+(popular|read|…) clause
    assert.ok(isHiddenWithin(sel('trailing-most-popular')),
      '「Most Popular」是跨站文末排行 widget heading，須由 NOISE_HEADING_TEXT_RE 兜底 hide');
  });

  it('Related widget 之前的正文段落保留', () => {
    assert.ok(!isHiddenWithin(sel('body-before-1')));
    assert.ok(!isHiddenWithin(sel('body-before-2')));
  });
});
