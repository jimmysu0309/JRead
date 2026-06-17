// JRead — WordPress block theme 主標題上方殘留自連結 post-title 卡片（v0.8.97）
//
// 對應 bug（Jimmy 2026-06-17 截圖回報，itsmicracing.xyz）：reader mode 後主
// 標題（大字置中「三搶一 or 一擋三」）上方殘留一張 compact 卡片——分類 chip
// 「Haas F1」+ 自連結 post-title「三搶一 or 一擋三」+ 作者「Huang Mike」。
//
// 根因：promoteArticleTitleClassHeadingInto 只檢查 articleEl 內有沒有 visible
// h1（此 WordPress block theme 整篇無 h1、主標題是 h2.wp-block-post-title）→
// 去 page-wide 找第一個 title-class heading＝articleEl 外那張 compact 卡片的
// 「自連結 post-title」→ wrapper 文字 ≈ 標題 → 把整張卡（含分類/作者）clone
// 進 reader card 頂部當主標題，成「標題上方雜訊」。
//
// 修法：promoteArticleTitleClassHeadingInto 補上「inner h2/h3 帶 strict 標題
// class（wp-block-post-title 等）且 visible」的偵測——主標題已在 reader card
// 內就不該 promote。section heading（wp-block-heading）不命中 strict regex，
// 故 Stratechery 類「articleEl 內只有 section h2、主標題 h2 在外」場景仍照常
// promote、不受影響。
//
// 本 spec 驗「clean() 後 DOM」（jsdom 層）；視覺由 /harness-verify 覆蓋。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'wordpress-pretitle-selflink-card.html');
// 與 fixture 卡片自連結 href（/three-vs-one/）對應的頁面 URL
const PAGE_URL = 'https://example.com/three-vs-one/';

describe('cleaner — WordPress 自連結 post-title 卡片不被 clone 進 reader card（v0.8.97）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true,
      url: PAGE_URL
    });
    document = env.document;
    articleEl = document.querySelector('[data-test="article-root"]');
    assert.ok(articleEl);
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('articleEl 內不產生 title clone（外面那張卡不被當主標題複製進來）', () => {
    const clones = articleEl.querySelectorAll('[data-jread-title-clone="1"]');
    assert.strictEqual(clones.length, 0,
      'articleEl 內已有 h2.wp-block-post-title 主標題，不該再 promote/clone 外部' +
      '自連結卡片標題；否則 reader card 頂部殘留「分類 + 標題 + 作者」雜訊卡');
  });

  it('reader card 內沒有自連結卡片標題的文字殘留（分類 chip 等）', () => {
    // clone 進來的卡會帶 rel="tag" 的分類 chip <a>；確認 articleEl 內沒有
    const tagChips = articleEl.querySelectorAll('a[rel="tag"]');
    assert.strictEqual(tagChips.length, 0,
      'clone 卡片會把分類 chip（a[rel=tag]）帶進 articleEl，應為 0');
  });

  it('真標題（inner 純文字 post-title）與內文保留', () => {
    const mainTitle = document.querySelector('[data-test="main-title"]');
    assert.notStrictEqual(mainTitle.dataset.jreadHidden, '1', '純文字主標題不可被誤殺');
    const mainContent = document.querySelector('[data-test="main-content"]');
    assert.notStrictEqual(mainContent.dataset.jreadHidden, '1');
    for (const p of mainContent.querySelectorAll('p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
    assert.notStrictEqual(
      document.querySelector('[data-test="section-heading"]').dataset.jreadHidden, '1');
  });
});
