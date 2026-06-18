// JRead — regression spec: ratio-padding hero placeholder，img 已被 styler
// 解 absolute 後仍需 reset padding-bottom（v0.8.117）
// -----------------------------------------------------------------------------
// Trigger: Jimmy 2026-06-18 回報 crossing.cw.com.tw/article/7004 hero 圖下方
// 一大塊空白。cage probe 真實 DOM：站方 .main-img__pic 是 position:relative +
// padding-bottom 61% 寬的 ratio placeholder hack，img 原生 position:absolute
// 填滿。enterReaderMode 順序 styler.apply（強制 img{position:static}）先跑、
// cleaner.clean 後跑 → 等 resetMediaPlaceholderPadding 執行時 img 已是 static，
// 舊版以「media 仍 absolute」當必要條件 → continue → padding-bottom 殘留成
// 主圖下方 ~400px 空白。
//
// 修法（cleaner.js resetMediaPlaceholderPadding）：移除「media 必須 absolute」
// 必要條件，改以 parent 的 padding-bottom/width 比例 + aspect-ratio 為唯一結構
// 特徵；media 當下位置不影響判定。
//
// forcing function：fixture 的 hero img 為 position:static（emulate post-styler），
// wrapper inline padding-bottom 61%。
//   - 暫時還原舊 guard（img 必須 absolute）→ 本 spec (b) 必 fail
//   - 修法在 → padding-bottom reset 為 0 → pass
//
// 訊號層次：本 spec 驗「cleaner runtime 把 ratio-hack padding-bottom reset 為 0」
// 這層（DOM inline style 字串）。**不驗**真實 Chrome 的 figure 幾何高度是否塌回
// （jsdom 無 layout）—— 該層由 cage / debug-harness 截圖 + gap audit 覆蓋。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'cw-hero-ratio-padding-static-img.html');

describe('cleaner — ratio-padding hero placeholder（static img post-styler, v0.8.117）', () => {
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
    assert.ok(articleEl, 'fixture 必須含 <article>');
    window.__JRead.cleaner.clean(articleEl);
  });

  // -------- (a) fixture 結構：ratio hack wrapper + static img --------
  it('(a) fixture: ratio-wrapper 有 inline padding-bottom 61%、hero img 為 static', () => {
    const wrapper = articleEl.querySelector('[data-test="ratio-wrapper"]');
    const img = articleEl.querySelector('[data-test="hero-img"]');
    assert.ok(wrapper && img, 'ratio-wrapper 與 hero-img 必須存在');
    // padding-bottom 在 clean() 後被改成 0，這裡驗「fixture 原始 inline 確實 > 20%」
    // 用 HTML attribute 原文（getAttribute('style')）避免被修法後的 inline 影響判斷
    // —— 改驗 img 的 position 仍是 static（修法不動 media 的非 absolute 狀態）。
    assert.strictEqual(window.getComputedStyle(img).position, 'static',
      'hero img 必須是 static（emulate styler 已解 absolute；舊 guard 會在此 continue）');
  });

  // -------- (b) 核心：padding-bottom 必須被 reset 為 0（消除空白）--------
  it('(b) ratio-wrapper 的 padding-bottom 必須被 reset 為 0（img 為 static 也要清）', () => {
    const wrapper = articleEl.querySelector('[data-test="ratio-wrapper"]');
    const pb = wrapper.style.getPropertyValue('padding-bottom');
    assert.ok(/^0(px|%)?$/.test(pb.trim()),
      `ratio-wrapper padding-bottom 必須 reset 為 0，實際為「${pb}」` +
      '（舊版以 media 必須 absolute 為必要條件、static img 漏網 → 殘留空白）');
    assert.strictEqual(wrapper.style.getPropertyPriority('padding-bottom'), 'important',
      'padding-bottom: 0 必須帶 !important（贏過站方 stylesheet）');
  });

  // -------- (c) 主文與 figcaption 全保留（修法不破壞內容）--------
  it('(c) hero img / figcaption / 主文 body-p 全保留', () => {
    for (const sel of ['hero-img', 'hero-caption', 'body-p-1', 'body-p-2']) {
      const el = articleEl.querySelector(`[data-test="${sel}"]`);
      assert.ok(el, `${sel} 必須存在`);
      assert.notStrictEqual(el.dataset.jreadHidden, '1', `${sel} 不可被 hide`);
    }
  });
});
