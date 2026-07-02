// JRead — 翻頁模式連結保留 iOS 長按 callout 選單（v1.6.6）
//
// Bug（Jimmy 2026-07-02 真機回報）：翻頁模式下長按文章內連結，iOS Safari 沒有
// 彈出「在新標籤頁開啟 / 拷貝連結」的原生 callout 選單。根因：v0.8.7 為了擋圖片
// drag-lift 搶走左右滑翻頁手勢，把 `a` 與 media（img/picture/figure/video/svg）
// 綁在同一條 selector 一起套 `-webkit-touch-callout: none !important`，連帶把
// 連結的長按 callout 選單也一起關掉。
//
// 修法：拆開 selector。media 保留三個屬性（drag-lift 會真的搶手勢，需 callout
// none）；`a` 只保留 touch-action: pan-y pinch-zoom + -webkit-user-drag: none
// （足夠保護水平翻頁 swipe——長按是靜止手勢、不與 swipe 衝突），移除 callout none。
//
// 訊號層次：本檔驗生成 CSS 字串——翻頁模式下 `a` 規則不含 touch-callout: none、
// media 規則仍含。不驗真實 iOS WebKit 長按選單（-webkit-touch-callout 是 WebKit
// 專屬、Chromium/Playwright 不重現長按 callout），該層靠 TestFlight 真機驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'paged-mode.html');

const BASE_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function applyAndGetCss(settings) {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  env.NS.styler.apply(articleEl, settings);
  return env.document.getElementById('__jread-style').textContent;
}

// 取 selector 到 `}` 之間的規則主體
function ruleBodyFor(css, selector) {
  const selIdx = css.indexOf(selector);
  if (selIdx === -1) return null;
  const braceIdx = css.indexOf('{', selIdx);
  const endIdx = css.indexOf('}', braceIdx);
  return css.slice(braceIdx, endIdx);
}

describe('styler — 翻頁模式連結保留長按 callout（v1.6.6）', () => {
  it('pagedMode: true → `a` 規則含 touch-action + user-drag，但不得含 touch-callout: none', () => {
    const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });

    const aBody = ruleBodyFor(css, '="1"] a {');
    assert.ok(aBody !== null, '翻頁模式必須有連結 touch 規則（selector 形狀變了就同步本 spec）');
    assert.ok(/touch-action:\s*pan-y pinch-zoom/.test(aBody),
      '連結必須保留 touch-action: pan-y pinch-zoom（保護水平翻頁 swipe 不被原生攔）');
    assert.ok(/-webkit-user-drag:\s*none/.test(aBody),
      '連結必須保留 -webkit-user-drag: none');
    assert.ok(!/-webkit-touch-callout/.test(aBody),
      '連結不得含 -webkit-touch-callout（否則 iOS 長按無「在新標籤頁開啟」選單——本 bug 回歸）');
  });

  it('pagedMode: true → media 規則仍含 touch-callout: none（drag-lift 會真搶手勢）', () => {
    const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: true });
    // svg selector 只出現在 media touch 規則（break-inside block 用 iframe 不用 svg）
    const mediaBody = ruleBodyFor(css, '="1"] svg {');
    assert.ok(mediaBody !== null, '翻頁模式必須有 media touch 規則（含 svg selector）');
    assert.ok(/-webkit-touch-callout:\s*none/.test(mediaBody),
      'media 必須保留 -webkit-touch-callout: none（圖片 drag-lift 會搶走翻頁手勢）');
  });

  it('pagedMode: false → 垂直模式不注入這段（連結長按本就正常）', () => {
    const css = applyAndGetCss({ ...BASE_SETTINGS, pagedMode: false });
    assert.strictEqual(css.indexOf('="1"] a {\n  touch-action: pan-y pinch-zoom'), -1,
      '垂直模式不得出現翻頁連結 touch 規則');
  });
});
