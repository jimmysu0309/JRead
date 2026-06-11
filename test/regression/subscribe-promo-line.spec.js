// JRead — byline 下訂閱促銷行（v0.8.48，page rounds 第五輪 cw.com.tw C4）
//
// 對應 bug：cw.com.tw byline 下方「首次訂閱 3 個月只要$499(原價$790)
// 領取優惠」促銷行殘留在 article__body 內。
//
// 修法：NOISE_LINK_TEXT_RE 加 ^領取優惠$（CTA 連結）；CTA_PROMO_P_RE 加
// 「首次訂閱 / 訂閱…只要 / 訂閱…優惠 / 原價…優惠」（訂閱制媒體跨站促銷
// 句式）→ link 命中後升級 hide 整個 parent P。
// 控制組：主文段落句中含「訂閱」字樣（無 CTA 連結）不誤殺。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'subscribe-promo-line.html');

describe('cleaner — 訂閱促銷行（v0.8.48 cw.com.tw）', () => {
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

  it('促銷行整個 P 被 hide（link 命中 + CTA_PROMO_P_RE 升級）', () => {
    const promo = document.querySelector('#promo-line');
    assert.ok(promo);
    assert.strictEqual(promo.dataset.jreadHidden, '1',
      '「領取優惠」連結命中後必須升級 hide 含「首次訂閱…只要」的整個 P');
  });

  it('早鳥優惠課程促銷行整個 DIV 被 hide（cage 重驗變體）', () => {
    const promo = document.querySelector('#promo-line-2');
    assert.ok(promo);
    assert.strictEqual(promo.dataset.jreadHidden, '1',
      '「早鳥優惠」連結命中後必須升級 hide 含「早鳥優惠」的整個 parent');
  });

  it('句中含「訂閱」的主文段落保留', () => {
    const p = document.querySelector('#legit-para');
    assert.ok(p);
    assert.notStrictEqual(p.dataset.jreadHidden, '1');
  });

  it('其餘主文 p 全保留', () => {
    for (const p of document.querySelectorAll('.article__body > p')) {
      if (p.id === 'promo-line') continue;
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 p 不可被 hide: "${p.textContent.slice(0, 30)}…"`);
    }
  });
});
