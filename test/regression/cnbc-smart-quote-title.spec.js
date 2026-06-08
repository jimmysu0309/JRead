// JRead — regression spec: 標題消失（canonical title 智慧撇號比對）(v0.7.251)
//
// Forcing function：hideInsideArticleDirectChildLinkBlocks 的 containsCanonicalTitle
// guard 必須在折疊 typographic 標點後比對 og:title vs heading direct text。
//
// Trigger: Page Rounds CNBC nvidia 文章標題消失。文章 header row 是 article 的
// direct child DIV，含 >= 5 anchor（byline + 股票連結）、無長 p，符合「link-only
// block」hide 條件；但它含主標 <h1>。og:title 用 ASCII 撇號（U+0027）、渲染 h1
// 用 typographic 撇號（U+2019），strict `===` 不折疊標點 → guard 假性不等 → 整塊
// header（含主標）被砍 → 標題消失。
//
// 3 條 forcing function：
//   (a) 含主標的 header row 不被 hide（撇號折疊後 guard 命中 canonical title）
//   (b) 主標 <h1> 不落在任何 data-jread-hidden 子樹內（標題可見）
//   (c) NS.foldTitlePunct 把 U+2019 折成 ASCII U+0027（helper 單元驗證）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'cnbc-smart-quote-title.html');

describe('cleaner — 標題消失 canonical 智慧撇號比對 (v0.7.251)', () => {
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
    articleEl = document.querySelector('article');
    assert.ok(articleEl, 'fixture must contain <article>');
    window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) 含主標的 header row（>= 5 anchor、無長 p）不被 hide', () => {
    const headerRow = articleEl.querySelector('.article-header-row');
    assert.ok(headerRow, 'header row must exist');
    assert.notStrictEqual(headerRow.dataset.jreadHidden, '1',
      '含 canonical title 的 header row 不可被當 link-only block 砍掉');
  });

  it('(b) 主標 <h1> 不落在任何 hidden 子樹內（標題可見）', () => {
    const h1 = articleEl.querySelector('h1.ArticleHeader-headline');
    assert.ok(h1, 'title h1 must exist');
    assert.strictEqual(h1.dataset.jreadHidden, undefined,
      '主標 h1 自身不可被 hide');
    assert.ok(!h1.closest('[data-jread-hidden="1"]'),
      '主標 h1 不可落在被 hide 的祖先子樹內');
  });

  it('(c) NS.foldTitlePunct 折疊 typographic 撇號到 ASCII', () => {
    const fold = window.__JRead.foldTitlePunct;
    assert.strictEqual(typeof fold, 'function', 'NS.foldTitlePunct 必須存在');
    // U+2019 RIGHT SINGLE QUOTATION MARK → U+0027 APOSTROPHE
    assert.strictEqual(fold('Huang’s'), "Huang's");
    // 雙引號家族 + 刪節號
    assert.strictEqual(fold('“PC”…'), '"PC"...');
  });
});
