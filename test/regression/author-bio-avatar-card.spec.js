// JRead — 作者 bio 卡（avatar 錨定）hide 規則（v0.8.52 theverge 實測）
//
// 對應 bug：theverge.com 閱讀模式下，主文開頭殘留「作者頭像 + 短 bio」卡
// （{頭像} David Pierce is editor-at-large and Vergecast co-host…）。站點用
// CSS modules，class 全 hash（_4aoxp30），author-bio keyword 規則攔不到。
//
// 修法（hideInsideArticleAuthorBioCards）：
//   - 小尺寸近方形 img + 身分訊號（作者頁路徑 <a> 或 avatar 慣例命名 src）
//   - 向上走找 textContent <= 400、無長 p、無內容媒體的最高層祖先 hide
//   - byline row（BYLINE_TEXT_RE 開頭）/ 長 p 容器 / 標題區保護
//
// probe 實證（2026-06-12）：theverge 卡 wrapper 一路到 lede-bottom 都是
// 310 chars、再上一層跳 14.5K chars，界線清楚；頂部「by David Pierce」
// byline 為獨立區塊、命中 BYLINE_TEXT_RE 受 guard 保護。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'author-bio-avatar-card.html');

describe('cleaner — 作者 bio 卡（avatar 錨定，v0.8.52 theverge）', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true,
      url: 'https://example.com/tech/944942/some-article'
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    // 幾何 stub：jsdom rect 全 0，規則要求頭像 rendered > 0 且 <= 80 近方形
    stubRect(document.querySelector('#avatar'), { top: 970, left: 355, width: 19, height: 19 });
    stubRect(document.querySelector('#byline-avatar'), { top: 200, left: 0, width: 36, height: 36 });
    stubRect(document.querySelector('#inline-avatar'), { top: 1500, left: 400, width: 24, height: 24 });
    window.__JRead.cleaner.clean(articleEl);
  });

  it('bio 卡整塊（最高層 lede-bottom wrapper）被 hide', () => {
    const lede = document.querySelector('#lede-bottom');
    assert.strictEqual(lede.dataset.jreadHidden, '1',
      '作者頭像錨定的 bio 卡 wrapper 必須整塊清掉');
  });

  it('bio 文字與頭像都在 hidden 子樹內（視覺不殘留）', () => {
    const bioText = document.querySelector('#bio-text');
    const avatar = document.querySelector('#avatar');
    assert.ok(bioText.closest('[data-jread-hidden="1"]'),
      'bio 文字必須在 hidden 子樹內');
    assert.ok(avatar.closest('[data-jread-hidden="1"]'),
      '頭像必須在 hidden 子樹內');
  });

  it('byline row（by X + 日期 + 頭像）保留——BYLINE guard', () => {
    const byline = document.querySelector('#byline-row');
    assert.notStrictEqual(byline.dataset.jreadHidden, '1',
      '「by 作者 + 日期」署名列不可被 bio 卡規則誤殺');
  });

  it('含 inline 小圖的主文長段落保留——長文字容器 break guard', () => {
    const p2 = document.querySelector('#content-p2');
    assert.notStrictEqual(p2.dataset.jreadHidden, '1',
      '主文段落內 avatar 風格 inline 圖不可導致整段消失');
    assert.ok(!p2.closest('[data-jread-hidden="1"]'));
  });

  it('主文其餘段落全保留', () => {
    for (const id of ['content-p1', 'content-p3']) {
      const p = document.getElementById(id);
      assert.notStrictEqual(p.dataset.jreadHidden, '1', `#${id} 不可被誤殺`);
      assert.ok(!p.closest('[data-jread-hidden="1"]'), `#${id} 不可在 hidden 子樹內`);
    }
  });
});
