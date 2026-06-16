// JRead — regression spec: absolute title overlay reflow (v0.8.87)
// -----------------------------------------------------------------------------
// Forcing function for hideInsideArticleAbsoluteOverlays v0.8.87 修法：
// h1-guard 保留含 h1 的 absolute title overlay wrapper 時，必須同時把它
// 的 position 強制成 static（可逆），讓標題回歸 normal flow——否則 absolute
// 的標題脫離 flow、不佔垂直空間，緊接其後的內文 flow 上來與標題重疊。
//
// Trigger: Jimmy 2026-06-16 回報 mag.clab.org.tw「標題和內文打架」。
// probe 確認 <div.bgcolor position:absolute> 含 h1，h1-guard 保留它但留
// 在 absolute → 內文與標題重疊 -60px（實機）。
//
// 訊號層次說明：jsdom 不做 layout，量不到「重疊 px」（那是 Playwright
// harness 的職責，見 tools/debug-harness.js GAP audit）。本 spec 驗的是
// 「結構訊號」——h1-guard 保留 wrapper 後有沒有把它 reflow 回 static。
// 不驗：實際幾何重疊（harness 層）、hero CSS 背景是否還原（設計上不還原）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'clab-absolute-title-overlap.html');

describe('cleaner — absolute title overlay reflow (clab, v0.8.87)', () => {
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
    articleEl = document.querySelector('[data-test="article-root"]');
    assert.ok(articleEl, 'fixture 必須含 article-root');
    window.__JRead.cleaner.clean(articleEl);
  });

  // -------- (a) fixture 結構數值驗證 --------
  it('(a) fixture: bgcolor 為 absolute 且含 h1（觸發條件）', () => {
    const wrapper = articleEl.querySelector('[data-test="absolute-h1-wrapper"]');
    assert.ok(wrapper, 'absolute h1 wrapper 必須存在');
    assert.ok(wrapper.querySelector('h1'),
      'wrapper 必須含 h1（h1-guard 觸發條件）');
  });

  // -------- (b) absolute h1 wrapper 不可被 hide（h1-guard 不退步）--------
  it('(b) bgcolor 必須未被 hide（h1-guard 保留 title overlay）', () => {
    const wrapper = articleEl.querySelector('[data-test="absolute-h1-wrapper"]');
    assert.notStrictEqual(wrapper.dataset.jreadHidden, '1',
      '含 h1 的 absolute wrapper 不可被 hide');
    assert.notStrictEqual(wrapper.style.display, 'none',
      'wrapper inline display 不可為 none');
  });

  // -------- (c) 核心：保留的 absolute wrapper 必須被 reflow 回 static --------
  it('(c) bgcolor 必須被強制 position:static !important（回歸 normal flow）', () => {
    const wrapper = articleEl.querySelector('[data-test="absolute-h1-wrapper"]');
    assert.strictEqual(wrapper.style.getPropertyValue('position'), 'static',
      '保留的 title overlay 必須被改成 position:static（否則 absolute 脫離 flow、標題與內文重疊）');
    assert.strictEqual(wrapper.style.getPropertyPriority('position'), 'important',
      'position:static 必須帶 !important（贏過原站 absolute !important）');
  });

  // -------- (d) hero h1 自身保留 + 祖先鏈無 hidden 連帶 --------
  it('(d) hero h1 + 祖先鏈未被 hide（標題不消失）', () => {
    const h1 = articleEl.querySelector('[data-test="hero-h1"]');
    assert.ok(h1, 'hero h1 必須存在');
    let cur = h1;
    while (cur && cur !== articleEl) {
      assert.notStrictEqual(cur.dataset.jreadHidden, '1',
        `h1 祖先 ${cur.tagName}.${(cur.className || '').toString().slice(0, 40)} 不可被 hide`);
      cur = cur.parentElement;
    }
  });

  // -------- (e) 主文段落保留 --------
  it('(e) 主文 body-p-1 + body-p-2 全部保留', () => {
    for (let i = 1; i <= 2; i++) {
      const p = articleEl.querySelector(`[data-test="body-p-${i}"]`);
      assert.ok(p, `主文 body-p-${i} 必須存在`);
      assert.notStrictEqual(p.dataset.jreadHidden, '1',
        `主文 body-p-${i} 不可被 hide`);
    }
  });
});
