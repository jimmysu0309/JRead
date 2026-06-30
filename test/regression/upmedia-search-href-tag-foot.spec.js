// JRead — upmedia 文末標籤列（tag chip 連 /search/ 站內搜尋頁）殘留（v1.5.25）
//
// 對應 fixture：test/regression/fixtures/upmedia-search-href-tag-foot.html
// Trigger：Jimmy 2026-06-30 回報 upmedia.mg 文章末尾「還有些許雜訊」。cage
// （real Chrome、過 Cloudflare）probe：.news-foot > .news-label 內 4 個 tag chip
// `<a href="/search/<關鍵字>">` 殘留。
//
// 根因：tag chip 連到站內搜尋頁 /search/<關鍵字>（用 search 結果頁當 tag landing）。
// 舊 TAXONOMY_HREF_RE 只認 /tags?/ /category/ /topics?/ /labels?/，不認 /search/
// → hideInsideArticleHashtagClusters 的 hashtagHits 0、ratioPass/tagBarPass 皆 fail
// → 整列漏網。class（news-foot/news-label）不在 NOISE_KEYWORD_RE，anchor 僅 4 個
// （< hideInsideArticleDirectChildLinkBlocks 的 5 門檻）且巢狀非 article 直接子
// → 唯一能命中的 path 就是 taxonomy-href，是有效 forcing function。
//
// 修法：TAXONOMY_HREF_RE 加 `search(?:es)?`（不可寫 searches?——後者要 "searche"）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'upmedia-search-href-tag-foot.html');

function isHiddenOrAncestorHidden(el) {
  let cur = el;
  while (cur && cur !== cur.ownerDocument.body) {
    if (cur.dataset && cur.dataset.jreadHidden === '1') return true;
    cur = cur.parentElement;
  }
  return false;
}

describe('cleaner — upmedia 文末 /search/ tag chip 列（v1.5.25 search-href taxonomy）', () => {
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

  it('前置：4 個 tag chip 都連 /search/、文字不以 # 起手（確認走 taxonomy-href path）', () => {
    const anchors = Array.from(document.querySelectorAll('.news-label a'));
    assert.strictEqual(anchors.length, 4, '.news-label 應有 4 個 anchor');
    assert.ok(anchors.every(a => /^\/search\//.test(a.getAttribute('href') || '')),
      '所有 tag chip 都連 /search/<關鍵字>');
    assert.ok(anchors.every(a => !a.textContent.trim().startsWith('#')),
      '所有 anchor 文字都不以 # 起手（否則無法 forcing 新 search-href 邏輯）');
  });

  it('核心：.news-foot 標籤列被 hide', () => {
    const foot = document.querySelector('.news-foot');
    assert.ok(foot, 'fixture 應有 .news-foot');
    assert.ok(isHiddenOrAncestorHidden(foot),
      '.news-foot（4 個 /search/ tag chip）必須被 search-href taxonomy path hide');
  });

  it('每個 tag chip 連結都不可見', () => {
    const anchors = Array.from(document.querySelectorAll('.news-label a'));
    for (const a of anchors) {
      assert.ok(isHiddenOrAncestorHidden(a), `tag chip「${a.textContent.trim()}」應被 hide`);
    }
  });

  it('主文 h1 + 兩段內文保留（無誤殺）', () => {
    const h1 = document.querySelector('h1');
    assert.ok(h1 && !isHiddenOrAncestorHidden(h1), 'h1 主標題保留');
    const ps = Array.from(document.querySelectorAll('.news-box-text > p'));
    assert.strictEqual(ps.length, 2, 'fixture 有兩段主文 p');
    for (const p of ps) {
      assert.ok(!isHiddenOrAncestorHidden(p), `主文段落「${p.textContent.slice(0, 12)}…」必須保留`);
    }
  });
});
