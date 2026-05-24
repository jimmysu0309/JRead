// JRead — v0.7.180 regression: MSNBC/ms.now hidden category label
//
// MSNBC opinion-header 結構：
//   HEADER(display:contents)
//     DIV.opinion-header(padding:100px, background:blue)
//       DIV.opinion-column(display:none)
//         P "Opinion"               ← DOM order 比 H1 早
//       DIV.title-and-dek-column
//         H1 "article title"
//         P "subtitle"
//
// Bug: querySelector('h1,h2,h3,h4,p') DOM order 命中隱藏 P "Opinion"，
//   firstInk 指向 display:none 內的 P，導致：
//   1. ancestor padding strip 走 P 祖先鏈 → 可能 miss（getComputedStyle
//      在 display:none 子樹行為不穩定）
//   2. titleFontSize inline override 檢查 firstInk.tagName !== 'H1' → skip
//
// Fix: firstInk 搜尋跳過 display:none 祖先鏈內的元素；titleFontSize
//   獨立搜尋 h1（不依賴 firstInk 是否 H tag）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'msnow-hidden-category-label.html');

describe('v0.7.180 — hidden category label skipped by firstInk', () => {
  let window, document, articleEl;

  beforeEach(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['styler'],
      viewport: { width: 1200, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('.wp-site-blocks');
    assert.ok(articleEl, 'articleEl (.wp-site-blocks) must exist');
  });

  it('titleFontSize inline override 命中 h1（不是隱藏 P）', () => {
    const snap = window.__JRead.styler.apply(articleEl, {
      theme: 'dark', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 32
    });
    const h1 = articleEl.querySelector('h1');
    assert.ok(h1, 'h1 must exist');
    assert.strictEqual(
      h1.style.getPropertyValue('font-size'), '32px',
      'h1 inline font-size 必須是 32px'
    );
    assert.strictEqual(
      h1.style.getPropertyPriority('font-size'), 'important',
      'h1 inline font-size 必須帶 !important'
    );
    // restore 後 h1 inline font-size 清除
    window.__JRead.styler.restore(articleEl, snap);
    assert.strictEqual(
      h1.style.getPropertyValue('font-size'), '',
      'restore 後 h1 inline font-size 必須清除'
    );
  });

  it('ancestor padding strip 命中 opinion-header（padding > 48）', () => {
    const oh = articleEl.querySelector('.opinion-header');
    assert.ok(oh, '.opinion-header must exist');
    assert.strictEqual(oh.style.paddingTop, '100px', 'fixture padding-top 100px');

    const snap = window.__JRead.styler.apply(articleEl, {
      theme: 'dark', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 0
    });
    const pt = oh.style.getPropertyValue('padding-top');
    assert.ok(pt === '0' || pt === '0px',
      'opinion-header padding-top 必須被 strip 為 0，got: ' + pt);
    const pb = oh.style.getPropertyValue('padding-bottom');
    assert.ok(pb === '0' || pb === '0px',
      'opinion-header padding-bottom 必須被 strip 為 0，got: ' + pb);
    // restore 後還原
    window.__JRead.styler.restore(articleEl, snap);
    assert.strictEqual(
      oh.style.paddingTop, '100px',
      'restore 後 opinion-header padding-top 必須還原 100px'
    );
  });

  it('firstInk margin-top=0 命中可見 H1（不是隱藏 P）', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'dark', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 0
    });
    const h1 = articleEl.querySelector('h1');
    const mt = h1.style.getPropertyValue('margin-top');
    assert.ok(mt === '0' || mt === '0px',
      'h1 margin-top 必須被設為 0（firstInk 命中 h1 而非隱藏 P），got: ' + mt);
    // 隱藏 P 不該被 touch
    const hiddenP = articleEl.querySelector('.opinion-column p');
    assert.strictEqual(
      hiddenP.style.getPropertyValue('margin-top'), '',
      '隱藏 P 的 margin-top 不該被修改'
    );
  });
});
