// JRead — 主文內 float 推廣 aside（v0.8.48，page rounds 第五輪 quanta C1/C2）
//
// 對應 bug：quantamagazine.org「The Quanta Podcast」推廣區塊（H4 + 宣傳文 +
// ALL EPISODES 連結 + 播放器）殘留。ASIDE float:right 306px 高——sidebar-column
// 條件 B 要 rectH > 400 漏網；class post__aside 無 noise keyword。
//
// 修法：hideInsideArticleFloatedPromoAsides——float aside + textLen < 600 +
// （含 a[href] 或 audio/iframe/video）命中 hide。
// 控制組：float caption aside（無連結無媒體）、未 float 的內容 aside 都保留。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'quanta-floated-promo-aside.html');

describe('cleaner — float 推廣 aside（v0.8.48 quanta）', () => {
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
    articleEl = document.querySelector('#postBody');
    assert.ok(articleEl);
    window.__JRead.cleaner.clean(articleEl);
  });

  it('podcast 推廣 aside（float + 連結 + audio）被 hide', () => {
    const aside = document.querySelector('#podcast-aside');
    assert.ok(aside);
    assert.strictEqual(aside.dataset.jreadHidden, '1');
  });

  it('float caption aside（無連結無媒體）保留', () => {
    const aside = document.querySelector('#caption-aside');
    assert.ok(aside);
    assert.notStrictEqual(aside.dataset.jreadHidden, '1',
      '合法 margin-note / caption aside 不可被誤殺');
  });

  it('未 float 的內容 aside 不被本規則動（float 是必要條件）', () => {
    const aside = document.querySelector('#static-aside');
    assert.ok(aside);
    assert.notStrictEqual(aside.dataset.jreadHidden, '1');
  });

  it('主文 p 全保留', () => {
    for (const p of document.querySelectorAll('.post__content > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 p 不可被 hide: "${p.textContent.slice(0, 30)}…"`);
    }
  });
});
