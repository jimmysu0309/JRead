// JRead — 兩欄 lede flex collapse + absolute byline guard（v0.8.48，
// page rounds 第五輪 theverge D）
//
// 對應 bug：theverge.com hero 圖縮成小圖靠左、dek/byline 繞圖排在右側窄欄
// （pWidth=305 / 卡寬 720）、byline 被截斷。lede 是「圖欄 + 文欄」對半 flex
// row 且沒 wrap，collapseInnerFlexWrap 的 wrap 判定 miss。
//
// 修法：
// 1. collapseInnerFlexWrap 條件 B——恰 2 in-flow 欄、各佔 30-70%、一欄含
//    內容圖、另一欄含 >= 80 chars 文字 → collapse block 堆疊。
// 2. hideInsideArticleAbsoluteOverlays 加 byline guard——文字開頭命中
//    BYLINE_TEXT_RE 的 absolute 區塊保留（containsContentScaleImg 細分後
//    小頭像不再觸發 img guard，無此 guard 會整塊誤殺作者署名）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'verge-two-col-lede.html');

describe('cleaner — 兩欄 lede collapse + absolute byline guard（v0.8.48 theverge）', () => {
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
    // 幾何 stub：720px lede row、兩欄各 ~42%、圖 303px 寬、同一 row（top 相等）
    stubRect(document.querySelector('#lede-row'), { top: 100, width: 720, height: 261 });
    stubRect(document.querySelector('#col-media'), { top: 100, left: 0, width: 303, height: 261 });
    stubRect(document.querySelector('#col-text'), { top: 100, left: 415, width: 305, height: 261 });
    stubRect(document.querySelector('#lede-img'), { top: 100, width: 303, height: 202 });
    // 控制組：author row 720px、avatar 欄 40px（佔比 0.06 < 0.3）
    stubRect(document.querySelector('#author-row'), { top: 500, width: 720, height: 48 });
    stubRect(document.querySelector('#avatar-col'), { top: 500, left: 0, width: 40, height: 40 });
    stubRect(document.querySelector('#name-col'), { top: 500, left: 48, width: 672, height: 48 });
    stubRect(document.querySelector('#avatar-2'), { top: 500, width: 40, height: 40 });
    window.__JRead.cleaner.clean(articleEl);
  });

  it('兩欄 lede flex 被 collapse 成 block（條件 B）', () => {
    const row = document.querySelector('#lede-row');
    assert.strictEqual(row.dataset.jreadCollapsed, '1',
      '媒體欄 + 文字欄對半 lede 必須 collapse 堆疊');
    assert.strictEqual(row.style.getPropertyValue('display'), 'block');
  });

  it('absolute byline 區塊保留（BYLINE guard）', () => {
    const byline = document.querySelector('#byline-block');
    assert.ok(byline);
    assert.notStrictEqual(byline.dataset.jreadHidden, '1',
      '「by Author + 日期」開頭的 absolute 區塊不可被 overlay 規則誤殺');
  });

  it('byline 內作者名 chip（role=button）保留', () => {
    const chip = document.querySelector('#author-chip');
    assert.ok(chip);
    assert.notStrictEqual(chip.dataset.jreadHidden, '1',
      'byline 語境內純文字 role=button 作者名不可被 all-buttons 規則清掉');
  });

  it('byline 內 Share chip（CTA 字樣）仍被清', () => {
    const chip = document.querySelector('#share-chip');
    assert.ok(chip);
    assert.strictEqual(chip.dataset.jreadHidden, '1');
  });

  it('byline 內 Gift chip（文字不在 by 句中）仍被清', () => {
    const chip = document.querySelector('#gift-chip');
    assert.ok(chip);
    assert.strictEqual(chip.dataset.jreadHidden, '1',
      'chip 文字不在 byline 句頭內就不享作者名豁免');
  });

  it('avatar byline row 不被 collapse（控制組：頭像欄 < 30%）', () => {
    const row = document.querySelector('#author-row');
    assert.notStrictEqual(row.dataset.jreadCollapsed, '1');
  });

  it('主文 p 全保留', () => {
    for (const p of document.querySelectorAll('article > p')) {
      assert.notStrictEqual(p.dataset.jreadHidden, '1');
    }
  });
});
