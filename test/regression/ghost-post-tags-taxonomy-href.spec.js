// JRead — Ghost tag chip 列（taxonomy href、無文字 #）翻譯後殘留（v0.8.77）
//
// 對應 fixture：test/regression/fixtures/ghost-post-tags-taxonomy-href.html
// Trigger：Jimmy 2026-06-15 回報 0xkato.xyz/how-llms-actually-work 用 Shinkansen
// 翻譯後進閱讀模式，標題下 tag chip 列（# 機器學習 / TRANSFORMERS / LLM ...）跑出來。
//
// 根因（real DOM probe，translate-first 與 plain 皆重現——非翻譯專屬）：tag chip
// 是 `<a class="item">機器學習</a>`，`#` 由 `.item::before{content:'#'}` 裝飾、
// 不在 textContent 內。hideInsideArticleHashtagClusters 只看 anchor 文字起手 `#`
// → 5 個全 0 命中、ratioPass / tagBarPass 皆 fail → 整列漏網。
//
// 修法：tag chip 認定加判 href 指向 taxonomy 頁（TAXONOMY_HREF_RE：/tags?/ /
// category(y|ies)/ /topics?/ /labels?/）。href 不隨翻譯改、是比文字 / class 更穩的
// 跨 CMS 結構訊號（Ghost /tags/#x、WP /tag/x/・/category/x/、Medium /tag/x）。
//
// fixture class（post-tags / item）刻意不在 NOISE_KEYWORD_RE 內，確保 hide 只能
// 來自 taxonomy-href path，是有效 forcing function。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'ghost-post-tags-taxonomy-href.html');

function isHiddenOrAncestorHidden(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument.body) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — Ghost tag chip 列 taxonomy href 偵測（v0.8.77 0xkato）', () => {
  let document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      pretendToBeVisual: true
    });
    document = env.document;
    const detected = env.window.__JRead.detector.detect();
    assert.ok(detected && detected.el, 'detector 應命中 fixture 主文容器');
    articleEl = detected.el;
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('前置：5 個 tag chip 文字都不以 # 起手（確認走的是新 taxonomy-href path）', () => {
    const anchors = Array.from(document.querySelectorAll('.post-tags a'));
    assert.strictEqual(anchors.length, 5, '.post-tags 應有 5 個 anchor');
    const withHash = anchors.filter(a => a.textContent.trim().startsWith('#'));
    assert.strictEqual(withHash.length, 0,
      '所有 anchor 文字都不以 # 起手（# 是 ::before 裝飾），否則無法 forcing 新邏輯');
  });

  it('核心：.post-tags tag chip 列被 hide', () => {
    const tags = document.querySelector('.post-tags');
    assert.ok(tags, 'fixture 應有 .post-tags');
    assert.ok(isHiddenOrAncestorHidden(tags),
      '.post-tags（5 個 taxonomy href tag chip、無文字 #）必須被 taxonomy-href path hide');
  });

  it('每個 tag chip 連結都不可見', () => {
    const anchors = Array.from(document.querySelectorAll('.post-tags a'));
    for (const a of anchors) {
      assert.ok(isHiddenOrAncestorHidden(a), `tag chip「${a.textContent.trim()}」應被 hide`);
    }
  });

  it('主文 h1 + 三段內文保留（無誤殺）', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1 && !isHiddenOrAncestorHidden(h1), 'h1 主標題保留');
    const ps = Array.from(document.querySelectorAll('article > p'));
    assert.strictEqual(ps.length, 3, 'fixture 有三段主文 p');
    for (const p of ps) {
      assert.ok(!isHiddenOrAncestorHidden(p), `主文段落「${p.textContent.slice(0, 12)}…」必須保留`);
    }
  });

  it('內文段落裡指向非 taxonomy 的正常連結（arxiv 論文）保留', () => {
    const link = Array.from(document.querySelectorAll('article p a'))
      .find(a => /arxiv/.test(a.getAttribute('href') || ''));
    assert.ok(link, 'fixture 內文應有一個 arxiv 連結');
    assert.ok(!isHiddenOrAncestorHidden(link),
      '內文中的正常 inline 連結必須保留——所在 p 有長敘述、guard 應擋住誤殺');
  });
});
