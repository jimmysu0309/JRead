// JRead — 主文內 inset 相關文章嵌入卡（v0.8.48，page rounds 第五輪 npr C2）
//
// 對應 bug：npr.org 主文中段 float:right 嵌入卡（縮圖 + kicker + 標題連結）
// 殘留。class 無語意（bucketwrap/internallink），keyword 規則不命中；
// sidebar-column 條件 A/C 的 textLen 門檻不符（卡只有 ~90 chars、main 段落
// < 900 chars）。
//
// 修法：hideInsideArticleInsetLinkCards——結構特徵（linkDensity >= 0.9 +
// 15-300 chars + h2-4>a 標題連結 + float/窄欄）命中 hide。
// 控制組驗證不誤殺：主文圖 wrapper（無 heading 連結）、自連結 permalink
// 標題卡（translate-proof guard）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'npr-inset-link-card.html');

describe('cleaner — inset 相關文章嵌入卡（v0.8.48 npr）', () => {
  let window, document, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['detector', 'cleaner'],
      viewport: { width: 1280, height: 900 },
      pretendToBeVisual: true,
      url: 'https://example.org/fixture-current-page'
    });
    window = env.window;
    document = env.document;
    articleEl = document.querySelector('article#story');
    assert.ok(articleEl);
    window.__JRead.cleaner.clean(articleEl);
  });

  it('float 嵌入卡（ld≈1 + h3>a）被 hide', () => {
    const card = document.querySelector('#inset-card');
    assert.ok(card);
    assert.strictEqual(card.dataset.jreadHidden, '1',
      'float:right + 全連結文字 + h3>a 標題的嵌入卡必須被 hide');
  });

  it('主文圖 wrapper（img + 短 credit 連結、無 heading 連結）保留', () => {
    const photo = document.querySelector('#photo-wrapper');
    assert.ok(photo);
    assert.notStrictEqual(photo.dataset.jreadHidden, '1',
      '無 h2-4>a 結構的圖片 wrapper 不可被誤殺');
  });

  it('自連結 permalink 標題卡保留（translate-proof guard）', () => {
    const titleCard = document.querySelector('#self-link-card');
    assert.ok(titleCard);
    assert.notStrictEqual(titleCard.dataset.jreadHidden, '1',
      'href 指向本頁 pathname 的標題 heading 卡不可被誤殺');
  });

  it('主文 p 全保留', () => {
    for (const p of document.querySelectorAll('article > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 p 不可被 hide: "${p.textContent.slice(0, 30)}…"`);
    }
  });
});
