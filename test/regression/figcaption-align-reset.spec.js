// JRead — regression spec: figcaption 靠尾端對齊 reset（v1.7.19）
// -----------------------------------------------------------------------------
// Forcing function for styler 的 caption alignment reset pass（caption 字級
// 下限 pass 之後）。
//
// Trigger: Jimmy 2026-07-27 回報 archive.ph WSJ 存檔頁翻譯後 hero 圖說折行
// 不對——figcaption 帶站方 text-align:right（WSJ credit 靠右慣例、archive.today
// inline 化），reader 窄版心下 caption + credit 連排折成兩行 → 非末行填滿
// 整寬、末行孤懸右緣。
//
// 規則（結構通則）：figcaption computed text-align 是「文向尾端」（ltr right /
// rtl left / 兩者 end）→ inline text-align:start !important。center 與自然
// 流向不碰。
//
// 驗證層次：本 spec 驗 jsdom 端寫入 / 負控制 / restore。真實 Chrome 端由
// cage 截圖驗收（archive.ph 擋 headless，見 CHANGELOG v1.7.19）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'figcaption-align-reset.html');

const OPTS = {
  theme: 'light', fontSize: 18, contentWidth: 720,
  fontFamily: 'system-ui', lineHeight: 1.7
};

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['styler'],
    viewport: { width: 1280, height: 900 },
    pretendToBeVisual: true
  });
  const articleEl = env.document.querySelector('[data-test="article"]');
  articleEl.setAttribute('data-jread-active', '1');
  return { env, articleEl };
}

describe('styler — figcaption 靠尾端對齊 reset（v1.7.19）', () => {
  it('(a) ltr text-align:right 的 figcaption 被寫 text-align:start !important', () => {
    const { env, articleEl } = setup();
    env.window.__JRead.styler.apply(articleEl, OPTS);
    const cap = articleEl.querySelector('[data-test="cap-right"]');
    assert.strictEqual(cap.style.getPropertyValue('text-align'), 'start',
      '靠右圖說必須被 reset 為 start');
    assert.strictEqual(cap.style.getPropertyPriority('text-align'), 'important',
      'reset 必須帶 !important（蓋站方 inline 化的值）');
  });

  it('(b) 負控制：center 與無對齊的 figcaption 不可碰', () => {
    const { env, articleEl } = setup();
    env.window.__JRead.styler.apply(articleEl, OPTS);
    assert.strictEqual(
      articleEl.querySelector('[data-test="cap-center"]').style.getPropertyValue('text-align'),
      'center', 'center 是排版意圖，必須原樣保留');
    assert.strictEqual(
      articleEl.querySelector('[data-test="cap-plain"]').style.getPropertyValue('text-align'),
      '', '無對齊的圖說不可被寫入 inline text-align');
  });

  it('(c) rtl 文向：right（自然流向）不碰、left（尾端）要 reset', () => {
    const { env, articleEl } = setup();
    env.window.__JRead.styler.apply(articleEl, OPTS);
    assert.strictEqual(
      articleEl.querySelector('[data-test="cap-rtl-natural"]').style.getPropertyValue('text-align'),
      'right', 'rtl 的 right 是自然流向，不可碰');
    assert.strictEqual(
      articleEl.querySelector('[data-test="cap-rtl-tail"]').style.getPropertyValue('text-align'),
      'start', 'rtl 的 left 是尾端對齊，必須 reset 為 start');
  });

  it('(d) restore：退出後 inline text-align 還原原值', () => {
    const { env, articleEl } = setup();
    const snap = env.window.__JRead.styler.apply(articleEl, OPTS);
    env.window.__JRead.styler.restore(articleEl, snap);
    const cap = articleEl.querySelector('[data-test="cap-right"]');
    assert.strictEqual(cap.style.getPropertyValue('text-align'), 'right',
      'restore 必須還原原 inline text-align（fixture 以 inline 模擬站方值）');
    assert.strictEqual(
      articleEl.querySelector('[data-test="cap-rtl-tail"]').style.getPropertyValue('text-align'),
      'left', 'rtl 尾端圖說 restore 還原 left');
  });
});
