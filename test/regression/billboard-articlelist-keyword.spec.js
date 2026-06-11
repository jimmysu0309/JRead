// JRead — billboard / article-list keyword token（v0.8.48，page rounds 第五輪
// dev.to C4 + theregister C2）
//
// 對應 bug：
// - dev.to 文末 Promoted billboard 整塊殘留（body-billboard-container /
//   crayons-bb）。廣告文案是 100+ chars 長 p → 長 p guard 誤豁免，billboard
//   token 必須 strong（跳過 guard）。
// - theregister「MORE CONTEXT」相關文章列殘留（DIV.articleList），缺
//   article[-_]?list 系 token。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'billboard-articlelist.html');

describe('cleaner — billboard / article-list keyword（v0.8.48）', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    window.__JRead.cleaner.clean(articleEl);
  });

  it('billboard 廣告塊被 hide（strong：長文案 p 不豁免）', () => {
    const bb = document.querySelector('#billboard');
    assert.ok(bb);
    assert.strictEqual(bb.dataset.jreadHidden, '1',
      'billboard token 必須走 strong path、不被廣告長文案 p 豁免');
  });

  it('articleList 相關文章列被 hide', () => {
    const list = document.querySelector('#article-list');
    assert.ok(list);
    assert.strictEqual(list.dataset.jreadHidden, '1');
  });

  it('主文 p 全保留', () => {
    for (const p of document.querySelectorAll('article#story > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 p 不可被 hide: "${p.textContent.slice(0, 30)}…"`);
    }
  });
});
