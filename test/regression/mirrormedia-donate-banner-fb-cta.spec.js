// JRead — regression spec: mirrormedia 文末促銷殘留 hide（v0.8.88）
//
// Trigger: Page Rounds 2026-06-16 mirrormedia.mg/story/20190308cul003 文末
// 「支持鏡週刊」募款 banner + 「按讚加入…臉書粉絲專頁」社群追蹤 CTA 段落殘留
//（strict residual 命中、截圖肉眼可見）。real DOM probe 確認兩條結構。
//
// Forcing function（5 條）:
//   (a) 募款 banner（DIV.support-...-banner__Container）整塊被 hide
//   (b) 社群追蹤 CTA 段落（含 facebook fan page anchor）整段被 hide
//   (c) 主文 Draft.js block 段落保留
//   (d) 引言段落保留
//   (e) 主標題 h1 保留

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'mirrormedia-donate-banner-fb-cta.html');

describe('cleaner — mirrormedia 文末促銷殘留（v0.8.88）', () => {
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
    assert.ok(articleEl, 'fixture must contain <article>');
    env.window.__JRead.cleaner.clean(articleEl);
  });

  it('(a) 募款 banner（support-...-banner container）整塊被 hide', () => {
    const banner = articleEl.querySelector('[class*="support-mirrormedia-banner__Container"]');
    assert.ok(banner, 'donate banner container must exist');
    assert.strictEqual(banner.dataset.jreadHidden, '1',
      'support/donate banner container must be hidden');
  });

  it('(b) 社群追蹤 CTA 段落（含 facebook fan page anchor）整段被 hide', () => {
    const ctaBlock = articleEl.querySelector('#last-para-x');
    assert.ok(ctaBlock, 'fb CTA block must exist');
    assert.strictEqual(ctaBlock.dataset.jreadHidden, '1',
      '「按讚加入…臉書粉絲專頁」CTA 段落 must be hidden (parent upgrade)');
  });

  it('(c) 主文 Draft.js block 段落保留', () => {
    const blocks = articleEl.querySelectorAll('.public-DraftStyleDefault-block');
    let kept = 0;
    for (const b of blocks) {
      if (b.id === 'last-para-x') continue;
      assert.notStrictEqual(b.dataset.jreadHidden, '1',
        'main body paragraph must not be hidden');
      kept++;
    }
    assert.ok(kept >= 2, 'at least the two real body paragraphs must survive');
  });

  it('(d) 引言段落保留', () => {
    const brief = articleEl.querySelector('.brief p');
    assert.ok(brief, 'brief paragraph must exist');
    assert.notStrictEqual(brief.dataset.jreadHidden, '1',
      'brief intro paragraph must not be hidden');
  });

  it('(e) 主標題 h1 保留', () => {
    const h1 = articleEl.querySelector('h1');
    assert.ok(h1, 'h1 must exist');
    assert.notStrictEqual(h1.dataset.jreadHidden, '1', 'h1 title must not be hidden');
  });
});
