// JRead — og:title 站名尾綴導致錯誤標題注入（v0.8.48，page rounds 第五輪
// zh.wikipedia B1 + C5）
//
// 對應 bug：zh.wikipedia 卡片主標題變成站台標語「維基百科，自由的百科全書」、
// 真條目標題「珍珠奶茶」降級小字。根因：markPromotedTitleIfMissing 的
// baseTitle 沒對 og:title 做 stripSiteSuffix，整串含站名 → 站台標語 div
// 被選為 bestCand 注入成 H1。
// 修法：og 也過 stripSiteSuffix；Wikipedia 場景 baseTitle 變 4 chars < 5
// → 不注入（真標題 #firstHeading 本來就在）。
// C5：vector-dropdown 語言切換由新 dropdown token 命中 hide。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'wikipedia-og-site-suffix-title.html');

describe('detector/cleaner — og 站名尾綴與 dropdown（v0.8.48 zh.wikipedia）', () => {
  let document, articleEl, NS;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true
    });
    document = env.document;
    NS = env.NS;
    articleEl = document.querySelector('main#content');
    articleEl.setAttribute('data-jread-active', '1');
    NS.cleaner.clean(articleEl, []);
    NS.detector.markPromotedTitleIfMissing(articleEl);
  });

  it('不得注入站台標語 H1（og 必須先去站名尾綴）', () => {
    const injected = document.querySelector('[data-jread-injected-title="1"]');
    assert.strictEqual(injected, null,
      'baseTitle 去尾綴後不該再注入「維基百科，自由的百科全書」假標題');
  });

  it('真標題 #firstHeading 保留可見', () => {
    const h1 = document.querySelector('#firstHeading');
    assert.ok(h1);
    assert.notStrictEqual(h1.dataset.jreadHidden, '1');
  });

  it('站台標語 #siteSub 不得被標成 promoted title source', () => {
    const siteSub = document.querySelector('#siteSub');
    assert.ok(siteSub);
    assert.notStrictEqual(siteSub.getAttribute('data-jread-promoted-title'), '1');
  });

  it('站台標語 #siteSub（class noprint）被 hide', () => {
    const siteSub = document.querySelector('#siteSub');
    assert.strictEqual(siteSub.dataset.jreadHidden, '1',
      'MediaWiki noprint 語意標記必須被 keyword rule 清掉');
  });

  it('vector-dropdown 語言切換被 hide（dropdown token）', () => {
    const dd = document.querySelector('#p-lang-btn');
    assert.ok(dd);
    assert.strictEqual(dd.dataset.jreadHidden, '1');
  });

  it('主文 p 全保留', () => {
    for (const p of document.querySelectorAll('#bodyContent > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});
