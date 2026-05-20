// JRead — regression spec: hero figure shrink fix (v0.7.146)
// -----------------------------------------------------------------------------
// Forcing function for `forceMediaContainerBlock` v0.7.146 修法。
// Trigger: Jimmy 2026-05-20 回報 GQ Taiwan omega-swatch-moonwatch
// 「原本全版面的主圖變超小一個」(原 1152 → reader mode 62)。
//
// Root cause: GQ hero figure 用 `display: grid` + `grid-template-columns: 1152px`
// 撐 width=1152。cleaner.forceMediaContainerBlock 把 display:grid → block 後，
// grid-template-columns 對 block element 失效，figure 失去寬度撐持、
// shrink-to-fit content (62px ~= picture intrinsic min-width)。
//
// 修法：對 grid/inline-grid/flex/inline-flex 改 block 時，**同時**設
// `width: 100%` + 清 grid-template-columns/rows + margin:0—— 把「grid/flex
// 撐寬」換成「block + width:100% 撐寬」，整體寬度行為連續。inline /
// inline-block → block 維持只改 display 不動 width。
//
// jsdom 無 layout，不能驗 width 數值。驗 inline style 是 forcing function：
// cleaner.clean 跑完後 figure inline style 必須含預期 declaration。
//
// 5 條 spec:
//   (a) fixture 結構數值驗證
//   (b) hero grid figure：display:block + width:100% + grid-template:none + margin:0
//   (c) flex figure 同樣套（grid/flex 同 path）
//   (d) inline-block figure：只設 display:block、不動 width
//   (e) block figure 完全不該被動（既有保護）

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'gq-hero-grid-figure.html');

describe('cleaner — hero grid figure shrink fix (GQ Taiwan / Condé Nast CMS, v0.7.146)', () => {
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

  // -------- (a) fixture 結構數值驗證 --------
  it('(a) fixture: 四種 figure 都存在', () => {
    assert.ok(articleEl.querySelector('[data-test="hero-figure"]'), 'hero figure 必須存在');
    assert.ok(articleEl.querySelector('[data-test="normal-block-figure"]'), 'normal block figure 必須存在');
    assert.ok(articleEl.querySelector('[data-test="flex-figure"]'), 'flex figure 必須存在');
    assert.ok(articleEl.querySelector('[data-test="inline-block-figure"]'), 'inline-block figure 必須存在');
  });

  // -------- (b) hero grid figure (display:grid) --------
  it('(b) hero grid figure: cleaner 必須設 display:block + width:100% + grid-template:none + margin:0', () => {
    const hero = articleEl.querySelector('[data-test="hero-figure"]');
    const style = hero.getAttribute('style') || '';
    assert.ok(/display:\s*block\s*!important/i.test(style),
      `hero figure inline style 必須含 'display: block !important'，實際：${style}`);
    assert.ok(/width:\s*100%\s*!important/i.test(style),
      `hero figure inline style 必須含 'width: 100% !important'（v0.7.146 修法核心保護點），實際：${style}`);
    assert.ok(/grid-template-columns:\s*none\s*!important/i.test(style),
      `hero figure inline style 必須含 'grid-template-columns: none !important'，實際：${style}`);
    assert.ok(/margin-left:\s*0(?:px)?\s*!important/i.test(style),
      `hero figure inline style 必須含 'margin-left: 0 !important'（避免 collapse 後 auto-center 偏移），實際：${style}`);
  });

  // -------- (c) flex figure (display:flex) 同路徑 --------
  it('(c) flex figure (display:flex): 同樣設 display:block + width:100% + grid-template:none', () => {
    const flex = articleEl.querySelector('[data-test="flex-figure"]');
    const style = flex.getAttribute('style') || '';
    assert.ok(/display:\s*block\s*!important/i.test(style),
      `flex figure inline style 必須含 display:block，實際：${style}`);
    assert.ok(/width:\s*100%\s*!important/i.test(style),
      `flex figure inline style 必須含 width:100%（grid+flex 同 path），實際：${style}`);
  });

  // -------- (d) inline-block figure: 只設 display，不動 width --------
  // 注意：jsdom 對「原 inline style 含 display: inline-block」的 setProperty
  // 處理有 quirk（important priority 沒保留），real Chrome 無此問題（probe
  // 已驗）。spec 不檢查 !important、只驗「display: block」+「不含 width:100%」
  // —— 後者是 inline-block path vs grid/flex path 的關鍵差異 forcing function。
  it('(d) inline-block figure: 只改 display:block、不動 width', () => {
    const ib = articleEl.querySelector('[data-test="inline-block-figure"]');
    const style = ib.getAttribute('style') || '';
    assert.ok(/display:\s*block/i.test(style),
      `inline-block figure 必須含 display: block，實際：${style}`);
    assert.ok(!/width:\s*100%/i.test(style),
      `inline-block figure 不該被加 width:100%（block 默認 fill parent；只 grid/flex 場景需要），實際：${style}`);
  });

  // -------- (e) normal block figure: 完全不該動 --------
  it('(e) normal block figure: cleaner 完全不該動（既有保護不退步）', () => {
    const normal = articleEl.querySelector('[data-test="normal-block-figure"]');
    const style = normal.getAttribute('style') || '';
    // 不該被 forceMediaContainerBlock 套（原本 display:block，rule 早 return）
    assert.ok(!/display:\s*block\s*!important/i.test(style),
      `normal block figure 不該被 forceMediaContainerBlock 動到（block 早 return），實際：${style}`);
    assert.ok(!/width:\s*100%\s*!important/i.test(style),
      `normal block figure 不該被加 width:100%，實際：${style}`);
  });
});
