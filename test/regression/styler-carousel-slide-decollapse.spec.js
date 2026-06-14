// JRead — carousel / slider 版面中和（v0.8.67）
//
// Bug：christies.com stories 頁進 reader mode 後，pure-react-carousel 的
// 「Auction Highlights」promo carousel 圖片疊在「20TH & 21ST CENTURY ART |
// AUCTION HIGHLIGHTS」圖說文字上（Jimmy 2026-06-14 截圖）。
//
// 根因：carousel library（pure-react-carousel / slick / swiper / splide /
// flickity）三層共通結構——slider 根 overflow:hidden + JS 寫死 inline height、
// slide track display:flex + transform:translateX、每張 slide padding-bottom
// aspect hack + 內層 position:absolute inset:0。reader mode 拆掉 overflow/
// transform 後 JS 寫死的 height 與 slide absolute 內層仍在 → slide 圖片溢出
// 被壓縮的 aspect box、疊到上一張 slide 的圖說上。
//
// 通則修法：carousel library 的 class 名是跨站共用結構慣例（library 公開
// CSS API、非單一站點 hash class）。把 slider 根 / track / slide / inner 拉回
// normal vertical flow——height auto + transform none + display block +
// position static + 清 padding-bottom hack——slide 改成乾淨垂直堆疊。
//
// 註：jsdom 不計算 layout（transform / position / overflow 的視覺結果），本
// spec 只驗 styler CSS 字串注入（CLAUDE.md「驗哪層訊號」說明）；實際「不再
// 重疊」的視覺結果由 debug-harness probe 在真實 christies 頁驗（page-04 截圖）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'christies-carousel-overlap.html');

const DEFAULT_SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function getInjectedCss() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  env.NS.styler.apply(detected.el, DEFAULT_SETTINGS);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, '必須注入 __jread-style');
  return styleEl.textContent;
}

// 抽出「包含 needle selector 的那一條 CSS rule」的 body
function ruleBodyContaining(css, needle) {
  const idx = css.indexOf(needle);
  assert.ok(idx >= 0, `CSS 必須含 selector：${needle}`);
  const open = css.indexOf('{', idx);
  const close = css.indexOf('}', open);
  assert.ok(open >= 0 && close >= 0, `${needle} 必須有完整 rule body`);
  return css.slice(open + 1, close);
}

describe('styler — carousel / slider 版面中和（v0.8.67 christies pure-react-carousel）', () => {
  it('CSS 必須涵蓋五大 carousel library 的 slide selector', () => {
    const css = getInjectedCss();
    for (const sel of ['carousel__slide', 'carousel__inner-slide', 'slick-slide', 'swiper-slide', 'splide__slide', 'carousel-cell']) {
      assert.ok(css.includes(`[class*="${sel}"]`),
        `CSS 必須含 slide selector [class*="${sel}"]（跨 library 通則）`);
    }
  });

  it('slide rule body 必須拉回 normal flow（position static + display block + 清 padding-bottom + height auto）', () => {
    const css = getInjectedCss();
    const body = ruleBodyContaining(css, '[class*="carousel__inner-slide"]');
    assert.ok(/position\s*:\s*static\s*!important/.test(body),
      'slide rule 必須 position: static !important（解除 inner-slide 的 absolute）');
    assert.ok(/display\s*:\s*block\s*!important/.test(body),
      'slide rule 必須 display: block !important（slide 由 inline/flex 子改垂直堆疊）');
    assert.ok(/padding-bottom\s*:\s*0\s*!important/.test(body),
      'slide rule 必須 padding-bottom: 0 !important（清 aspect-ratio hack 撐的假高度）');
    assert.ok(/height\s*:\s*auto\s*!important/.test(body),
      'slide rule 必須 height: auto !important（高度由內容自然撐起）');
    assert.ok(/float\s*:\s*none\s*!important/.test(body),
      'slide rule 必須 float: none !important（slick/pure-react slide 常 float:left 並排）');
  });

  it('slide track rule body 必須清除 transform（slideTray translateX 平移）', () => {
    const css = getInjectedCss();
    const body = ruleBodyContaining(css, '[class*="sliderTray" i]');
    assert.ok(/transform\s*:\s*none\s*!important/.test(body),
      'track rule 必須 transform: none !important（解除 translateX slide 平移）');
    assert.ok(/display\s*:\s*block\s*!important/.test(body),
      'track rule 必須 display: block !important（flex nowrap 橫排改垂直）');
  });

  it('slider 根 rule body 必須解除 overflow + JS 寫死的固定高度', () => {
    const css = getInjectedCss();
    const body = ruleBodyContaining(css, '[class*="carousel__slider"]');
    assert.ok(/overflow\s*:\s*visible\s*!important/.test(body),
      'slider 根 rule 必須 overflow: visible !important（露出被裁掉的 slide）');
    assert.ok(/height\s*:\s*auto\s*!important/.test(body),
      'slider 根 rule 必須 height: auto !important（解除 JS 寫死的 inline 固定高）');
    assert.ok(/max-height\s*:\s*none\s*!important/.test(body),
      'slider 根 rule 必須 max-height: none !important');
  });
});
