// JRead — regression spec: "related-content" class keyword (v0.7.195)
//
// Forcing function for NOISE_KEYWORD_RE related-content pattern:
// "related-content" in class names (e.g. "related-content-elevate") should be
// matched by the keyword regex and hidden. Previously only related-articles,
// related-news, related-posts, related-stories were matched.
//
// Trigger: Page Rounds 2026-05-26 CNN "STREAMING NOW" block with class
// "related-content-elevate" not hidden.
//
// 2 forcing functions:
//   (a) div.related-content-elevate hidden
//   (b) main article <p> preserved

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'related-content-keyword.html');

describe('cleaner — related-content keyword hide (v0.7.195)', () => {
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

  it('(a) related-content-elevate DIV is hidden', () => {
    const widget = articleEl.querySelector('.related-content-elevate');
    assert.ok(widget, 'related-content-elevate DIV must exist');
    assert.strictEqual(widget.dataset.jreadHidden, '1',
      'DIV with class "related-content-elevate" must be hidden by keyword');
  });

  it('(b) main article <p> preserved', () => {
    const paragraphs = articleEl.querySelectorAll('article > p');
    assert.ok(paragraphs.length >= 3, 'must have at least 3 paragraphs');
    for (const p of paragraphs) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        'main text <p> must not be hidden');
    }
  });
});
