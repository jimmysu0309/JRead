// JRead — regression spec: absolute overlay h1 guard (v0.7.148)
// -----------------------------------------------------------------------------
// Forcing function for hideInsideArticleAbsoluteOverlays v0.7.148 guard：
// 含 `<h1>` 的 absolute wrapper 視為「hero header title overlay」設計，skip
// 不 hide（hide 後 h1 雖自身 visible 但 ancestor display:none 連帶 0×0
// 不可見，標題完全消失）。
//
// Trigger: Jimmy 2026-05-20 回報 TBIJ thebureauinvestigates.com 標題消失。
// probe 確認 `<div class="tb-c-story-header__heading">` position:absolute
// 包 h1，被 v0.7.111 absolute overlay rule hide → 標題消失。
//
// 5 條 forcing function:
//   (a) fixture 結構驗證
//   (b) absolute-h1-wrapper 不可被 hide（核心保護點）
//   (c) hero h1 自身 + visible（沒 ancestor hidden 連帶 0×0）
//   (d) overlay-no-h1-aside / overlay-no-h1-authors 仍被 hide（v0.7.111 行為不退步）
//   (e) 主文 body-p-1, body-p-2 全保留

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tbij-absolute-h1-overlay.html');

describe('cleaner — absolute overlay h1 guard (TBIJ, v0.7.148)', () => {
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
    assert.ok(articleEl, 'fixture 必須含 <article>');
    window.__JRead.cleaner.clean(articleEl);
  });

  // -------- (a) fixture 結構數值驗證 --------
  it('(a) fixture: hero h1 結構符合最小重現條件', () => {
    const wrapper = articleEl.querySelector('[data-test="absolute-h1-wrapper"]');
    assert.ok(wrapper, 'absolute h1 wrapper 必須存在');
    const cs = window.getComputedStyle(wrapper);
    assert.strictEqual(cs.position, 'absolute',
      'wrapper 必須 position:absolute（v0.7.111 absolute rule 觸發條件）');
    assert.ok(wrapper.querySelector('h1'),
      'wrapper 必須含 h1（v0.7.148 guard 觸發條件）');
  });

  // -------- (b) absolute-h1-wrapper 不可被 hide（核心保護點）--------
  it('(b) absolute h1 wrapper 必須未被 hideInsideArticleAbsoluteOverlays hide', () => {
    const wrapper = articleEl.querySelector('[data-test="absolute-h1-wrapper"]');
    assert.notStrictEqual(wrapper.dataset.jreadHidden, '1',
      'absolute h1 wrapper 不可被 hide（核心保護點：含 h1 的 absolute wrapper = hero title overlay）');
    assert.notStrictEqual(wrapper.style.display, 'none',
      'absolute h1 wrapper inline display 不可為 none');
  });

  // -------- (c) hero h1 自身保留 + 未被 ancestor hide 連帶 --------
  it('(c) hero h1 自身未被 hide、parent 也未被 hide（連帶保證）', () => {
    const h1 = articleEl.querySelector('[data-test="hero-h1"]');
    assert.ok(h1, 'hero h1 必須存在');
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
    // 沿祖先鏈到 articleEl 確認都沒 hidden
    let cur = h1;
    while (cur && cur !== articleEl) {
      assert.notStrictEqual(cur.dataset.jreadHidden, '1',
        `h1 祖先 ${cur.tagName}.${(cur.className || '').toString().slice(0, 40)} 不可被 hide（連帶會讓 h1 0×0 消失）`);
      cur = cur.parentElement;
    }
  });

  // -------- (d) 無 h1 的 absolute overlay 仍被 hide（v0.7.111 行為不退步）--------
  it('(d) overlay-no-h1-aside 與 overlay-no-h1-authors 仍被 hide（v0.7.111 行為延續）', () => {
    const aside = articleEl.querySelector('[data-test="overlay-no-h1-aside"]');
    const authors = articleEl.querySelector('[data-test="overlay-no-h1-authors"]');
    assert.ok(aside, 'overlay-no-h1-aside 必須存在');
    assert.ok(authors, 'overlay-no-h1-authors 必須存在');
    assert.strictEqual(aside.dataset.jreadHidden, '1',
      '無 h1 的 absolute overlay (aside, fixed-left-sidebar) 必須被 hide（v0.7.111 case 不退步）');
    assert.strictEqual(authors.dataset.jreadHidden, '1',
      '無 h1 的 absolute overlay (authors widget) 必須被 hide（v0.7.111 case 不退步）');
  });

  // -------- (e) 主文段落保留 --------
  it('(e) 主文 body-p-1 + body-p-2 全部保留', () => {
    for (let i = 1; i <= 2; i++) {
      const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(p, `主文 body-p-${i} 必須存在`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 body-p-${i} 不可被 hide`);
    }
  });
});
