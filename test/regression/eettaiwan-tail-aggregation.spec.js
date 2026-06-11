// JRead — eettaiwan 文章尾巴 aggregation 雜訊（v0.8.44）
// 對應 fixture：test/regression/fixtures/eettaiwan-tail-aggregation.html
//
// 三條通則：
// 1) NOISE token `tags?[-_]?list`：CMS tag 列 class 用複數 `tags-list` 時，
//    原 `tag[-_]?list` 不命中（`tag` 後接 `s` 非邊界字元）→ 補複數變體。
// 2) NOISE token `(?:posts?|articles?|news|stor(?:y|ies))[-_]related`（strong）：
//    CMS 也用名詞在前的反序命名（`post-related`），原 token 只涵蓋
//    `related-posts` 順序 → 漏網。
// 3) hasUnhiddenContentMedia icon-size 豁免：已 layout 且 rendered rect
//    <= 32×32 的 img / svg 視為裝飾 icon、不算內容媒體——tags-list 被 hide
//    後 `.content-footer` 只剩 24×24 tags icon，原判定把 icon 當內容媒體、
//    empty-wrapper collapse 被 guard 擋下 → icon 孤兒殘留。
//    注意：icon 判定必須用 rendered rect、不可用 naturalWidth（viewBox-only
//    SVG 的 `<img>` 無內在尺寸、natural 回 CSS 預設 150×150，eettaiwan
//    tags.svg 實測）。
//
// jsdom 無 layout engine（getBoundingClientRect 全回 0），icon / wrapper rect
// 由 spec stub——這是測試環境限制的妥協，不是真實世界邏輯變形。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eettaiwan-tail-aggregation.html');

function stubRectAt(el, w, h, top) {
  el.getBoundingClientRect = () => ({
    top, bottom: top + h, left: 0, right: w, width: w, height: h, x: 0, y: top
  });
}

function load() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'cleaner'],
    viewport: { width: 1000, height: 600 },
    pretendToBeVisual: true
  });
  const d = env.document;
  // 真實站 rect：tags icon 24×24（icon-size 豁免閾值 32 之內）、
  // aggregation / content-footer 滿足 empty-collapse 的 min 8h × 80w
  stubRectAt(d.querySelector('[data-test="tags-icon"]'), 24, 24, 5000);
  stubRectAt(d.querySelector('[data-test="content-footer"]'), 600, 107, 5000);
  stubRectAt(d.querySelector('[data-test="aggregation"]'), 600, 176, 5000);
  // 主文圖 stub 為內容尺寸，確保不被任何空殼/icon 邏輯波及
  stubRectAt(d.querySelector('[data-test="main-img"]'), 600, 400, 1000);
  return env.window;
}

describe('eettaiwan — 文章尾巴 aggregation 雜訊（tags 列 / 相關文章 / 孤兒 icon）', () => {
  let window, document, hidden;

  before(() => {
    window = load();
    document = window.document;
    const detected = window.__JRead.detector.detect();
    assert.ok(detected, 'detector 應命中 <article>');
    hidden = window.__JRead.cleaner.clean(detected.el);
  });

  after(() => {
    if (hidden) window.__JRead.cleaner.restore(hidden);
  });

  it('tags-list（複數 class）被 keyword hide', () => {
    assert.strictEqual(document.querySelector('[data-test="tags-list"]').dataset.jreadHidden, '1',
      '`tags?[-_]?list` token 應命中 class="tags-list"');
  });

  it('post-related（反序 related 命名）被 strong keyword hide', () => {
    assert.strictEqual(document.querySelector('[data-test="post-related"]').dataset.jreadHidden, '1',
      '`posts?[-_]related` 反序 token 應命中 class="post-related"');
  });

  it('tags icon 孤兒不殘留（icon-size 豁免讓空殼 wrapper 可 collapse）', () => {
    const icon = document.querySelector('[data-test="tags-icon"]');
    const hiddenAncestor = icon.closest('[data-jread-hidden="1"]');
    assert.ok(hiddenAncestor,
      'tags-list 被 hide 後 content-footer 只剩 24×24 icon，' +
      'empty-wrapper collapse 應把空殼 wrapper（content-footer 或 aggregation）hide');
  });

  it('主文段落與內容圖不被誤殺', () => {
    for (const t of ['main-p1', 'main-p2', 'main-p3', 'main-img']) {
      const el = document.querySelector(`[data-test="${t}"]`);
      assert.notStrictEqual(el.dataset.jreadHidden, '1', `${t} 不得被 hide`);
      assert.strictEqual(el.closest('[data-jread-hidden="1"]'), null,
        `${t} 的祖先鏈不得被 hide`);
    }
  });

  it('restore 後全部還原', () => {
    window.__JRead.cleaner.restore(hidden);
    hidden = null;
    for (const t of ['tags-list', 'post-related', 'content-footer', 'aggregation']) {
      const el = document.querySelector(`[data-test="${t}"]`);
      assert.notStrictEqual(el.dataset.jreadHidden, '1', `${t} restore 後不得仍標記 hidden`);
    }
  });
});
