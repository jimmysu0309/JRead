// JRead — regression spec: inline-block child overflow after grid collapse (v0.7.195)
//
// Forcing function for CHILD_DECLS max-width change:
// collapseGridWithHiddenCell sets width:auto + max-width on visible children.
// For inline-block children, max-width:none allows unbounded shrink-wrap
// growth beyond parent → overflow. Fix: max-width:100% caps at parent width.
//
// Trigger: Page Rounds 2026-05-26 CNN layout__center (display:inline-block,
// min-width:500px) overflowed 136px past reader card.
//
// 2 forcing functions:
//   (a) sidebar hidden → collapse fires → inline-block child gets max-width:100%
//   (b) main article <p> preserved

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'cnn-inline-block-overflow.html');

describe('cleaner — inline-block child max-width after grid collapse (v0.7.195)', () => {
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

  it('(a) sidebar aside is hidden by keyword', () => {
    const aside = articleEl.querySelector('aside.sidebar-col');
    assert.ok(aside, 'sidebar aside must exist');
    assert.strictEqual(aside.dataset.jreadHidden, '1',
      'sidebar aside must be hidden');
  });

  it('(b) inline-block child gets max-width:100% not none', () => {
    const center = articleEl.querySelector('.layout-center');
    assert.ok(center, 'layout-center must exist');
    const mw = center.style.getPropertyValue('max-width');
    assert.ok(mw === '100%',
      `inline-block child max-width should be "100%" but got "${mw}"`);
  });

  it('(c) main article <p> preserved', () => {
    const paragraphs = articleEl.querySelectorAll('.article-body p');
    assert.ok(paragraphs.length >= 2, 'must have at least 2 paragraphs');
    for (const p of paragraphs) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        'main text <p> must not be hidden');
    }
  });
});
