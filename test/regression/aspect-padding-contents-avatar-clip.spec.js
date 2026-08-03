// JRead — regression spec: display:contents 中間層後的 padding hack 盒 +
// height:0 變體（v1.7.32）
// -----------------------------------------------------------------------------
// Trigger: Jimmy 2026-08-03 截圖回報 tomsguide.com 文末作者頭像底部被截斷。
// Playwright probe 真實 DOM 釘出兩個獨立結構缺口（tools/probe-tomsguide-avatar*.js，
// 用完即刪）：
//   1. hack 盒（.image-wrapped__aspect-padding：height:0 + padding-bottom 撐高 +
//      overflow:hidden）與 picture 之間隔一層 display:contents div。
//      resetMediaPlaceholderPadding 舊版只看 media.parentElement——display:contents
//      不產生 box、量不到 hack 特徵 → Pattern A 永遠 miss。styler 把 img 拉回
//      static flow 並套 block margin 後，img 在固定 70px 高 clip 盒內被往下推
//      27px、底部被裁（頭像頂圓底平）。
//   2. 即使 Pattern A 命中，舊 parentDecls 只清 padding-bottom——對「高度全由
//      padding 撐（content 高度 0）」的變體，清完盒子塌 0、overflow:hidden 把
//      media 整個裁掉（probe 實測 clipH 70 → 0，比不清更糟）。
//
// 修法（cleaner.js resetMediaPlaceholderPadding，皆為結構通則）：
//   1. 取 parent 時往上跳過 display:contents 祖先（不產生 box 的元素不是結構
//      上的容器），用「產生 box 的最近祖先」判定 hack。
//   2. isHack 且 content 高度 ≈ 0（clientHeight − padding < 8px）→ 一併
//      height:auto，讓盒子由 flow 內 media 自然撐起（probe 實測 clip 盒撐到
//      121px、頭像完整無裁切）。content 有實際高度的盒不動 height。
//
// forcing function：
//   - 暫時還原「parent = media.parentElement 直取」→ (b)(c) fail
//   - 保留 skip、拿掉 height:auto 分支 → (c) fail
//
// 訊號層次：本 spec 驗「cleaner runtime 對 hack 盒寫入 inline reset」這層
// （DOM inline style 字串）。**不驗**真實 Chrome 的 clip 幾何（jsdom 無
// layout）——該層由 debug-harness 截圖覆蓋（本輪已跑 tomsguide 實站驗證）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'aspect-padding-contents-avatar-clip.html');

describe('cleaner — display:contents 後的 padding hack 盒 + height:0 變體（v1.7.32）', () => {
  let window, document, articleEl, hackBox;

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
    hackBox = articleEl.querySelector('[data-test="hack-box"]');
    assert.ok(hackBox, 'hack-box 必須存在');
    window.__JRead.cleaner.clean(articleEl);
  });

  // -------- (a) fixture 結構：display:contents 中間層 + static img --------
  it('(a) fixture: picture 的直接父層是 display:contents、img 為 static', () => {
    const pic = articleEl.querySelector('[data-test="bio-picture"]');
    const img = articleEl.querySelector('[data-test="bio-img"]');
    assert.ok(pic && img, 'bio-picture 與 bio-img 必須存在');
    assert.strictEqual(
      window.getComputedStyle(pic.parentElement).display, 'contents',
      'picture 的直接父層必須是 display:contents（舊版 parent 直取在此 miss）');
    assert.strictEqual(window.getComputedStyle(img).position, 'static',
      'img 必須是 static（emulate styler 已解 absolute）');
  });

  // -------- (b) 核心 1：隔著 display:contents 也要命中 hack 盒 --------
  it('(b) hack-box 的 padding-bottom 必須被 reset 為 0（隔 display:contents 也要命中）', () => {
    const pb = hackBox.style.getPropertyValue('padding-bottom');
    assert.ok(/^0(px|%)?$/.test(pb.trim()),
      `hack-box padding-bottom 必須 reset 為 0，實際為「${pb}」` +
      '（舊版 parent = media.parentElement 直取，display:contents 中間層讓 Pattern A 永遠 miss）');
    assert.strictEqual(hackBox.style.getPropertyPriority('padding-bottom'), 'important',
      'padding-bottom: 0 必須帶 !important');
  });

  // -------- (c) 核心 2：height:0 變體必須一併解 height:auto --------
  it('(c) hack-box 的 height 必須被 reset 為 auto（content 高度 0 的變體）', () => {
    const h = hackBox.style.getPropertyValue('height');
    assert.strictEqual(h.trim(), 'auto',
      `hack-box height 必須 reset 為 auto，實際為「${h}」` +
      '（只清 padding-bottom 會讓「高度全由 padding 撐」的盒塌 0、overflow:hidden 整個裁掉 media）');
    assert.strictEqual(hackBox.style.getPropertyPriority('height'), 'important',
      'height: auto 必須帶 !important');
  });

  // -------- (d) 頭像 media 與 bio 內容全保留 --------
  it('(d) bio img / picture / 作者段落全保留、不被 hide', () => {
    for (const sel of ['bio-img', 'bio-picture', 'bio-p', 'body-p-1', 'body-p-2']) {
      const el = articleEl.querySelector(`[data-test="${sel}"]`);
      assert.ok(el, `${sel} 必須存在`);
      assert.notStrictEqual(el.dataset.jreadHidden, '1', `${sel} 不可被 hide`);
    }
  });
});
