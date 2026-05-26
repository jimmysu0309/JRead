// JRead — regression spec: article direct child link-grid hide (v0.7.194)
//
// Forcing function for hideInsideArticleDirectChildLinkBlocks:
// article 的 direct child DIV 若含 >= 3 anchor 且無 >= 50 chars <p>，
// 視為推薦文章 card grid，hide。
//
// Trigger: Page Rounds 2026-05-26 cnyes.com「鉅亨號貼文」推薦卡片殘留。
// 結構：ARTICLE > DIV.hao-posts（10 張卡片，每張含 <a> 標題連結，無 <p>）。
//
// 3 條 forcing function:
//   (a) link grid（>= 3 anchor、無長 p）被 hide
//   (b) 含長 p 的 DIV（同時有 >= 3 anchor）不被 hide
//   (c) 主文 <p> 保留

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'direct-child-link-grid.html');

describe('cleaner — direct child link-grid hide (v0.7.194)', () => {
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

  it('(a) link grid DIV（>= 5 anchor、無長 p）被 hide', () => {
    const grid = articleEl.querySelector('.rec-posts');
    assert.ok(grid, 'rec-posts DIV must exist');
    assert.strictEqual(grid.dataset.jreadHidden, '1',
      'link grid（>= 5 anchor、無長 p）must be hidden');
  });

  it('(b) 含長 p 的 DIV（>= 5 anchor）不被 hide', () => {
    const contentBlock = articleEl.querySelector('.content-with-links');
    assert.ok(contentBlock, 'content-with-links DIV must exist');
    assert.notStrictEqual(contentBlock.dataset.jreadHidden, '1',
      'DIV with long <p> must NOT be hidden even with >= 3 anchors');
  });

  it('(c) 主文 <p> 保留', () => {
    const paragraphs = articleEl.querySelectorAll('article > p');
    for (const p of paragraphs) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        'main text <p> must not be hidden');
    }
  });
});
