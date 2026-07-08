// JRead — regression spec: 閱讀模式主文一律靠左對齊（v1.6.18）
//
// Trigger: Fox News header text-align:center → 閱讀模式標題/副標維持置中、與內文左排
//   不一致（Jimmy 2026-07-08「閱讀模式沒有指定對齊模式，請指定為靠左對齊」）。
// 修法: styler 注入 base 規則——容器 [data-jread-active="1"] 設 text-align:left +
//   逐 text 元素（h1-h6 / p / li / blockquote / dd / dt / [text-div]）覆蓋站點置中。
//   specificity 保持 (0,1,1) 以下，CJK 段落 justify（0,2,0）與 byline（0,2,0）仍優先。
//
// 訊號層次：本檔驗「左對齊規則進入注入 CSS + CJK justify 規則仍共存」；真實 Chrome
//   逐 px 對齊 + CJK justify 不被蓋由 Playwright probe 驗（udn 實測 CJK 段落仍 justify、
//   標題 left）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'reader-left-align.html');

describe('styler — 閱讀模式主文一律靠左對齊（v1.6.18）', () => {
  let document, css;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['styler'],
      viewport: { width: 720, height: 800 },
      pretendToBeVisual: true
    });
    document = env.document;
    const articleEl = document.getElementById('post');
    assert.ok(articleEl, 'fixture 應有 #post');
    env.window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720, fontFamily: '', lineHeight: 1.7
    });
    const styleEl = document.getElementById('__jread-style');
    assert.ok(styleEl, '必須注入 __jread-style');
    css = styleEl.textContent;
  });

  it('注入 CSS：容器 [data-jread-active="1"] 設 text-align:left', () => {
    const re = /\[data-jread-active="1"\]\s*\{[^}]*text-align:\s*left\s*!important/;
    assert.match(css, re, 'CSS 必須含容器層 text-align:left 規則');
  });

  it('注入 CSS：標題 + 段落 text 元素 text-align:left', () => {
    // [data-jread-active="1"] :is(h1, ... p, ...) { text-align: left !important }
    const re = /\[data-jread-active="1"\]\s*:is\([^)]*\bh1\b[^)]*\bp\b[^)]*\)[^{]*\{[^}]*text-align:\s*left\s*!important/;
    assert.match(css, re, 'CSS 必須含標題/段落 :is() text-align:left 規則');
  });

  it('CJK 段落 justify 規則仍共存（未被左對齊改動移除）', () => {
    const re = /\[data-jread-active="1"\]\s*\[data-jread-cjk-justify="1"\][^{]*\{[^}]*text-align:\s*justify\s*!important/;
    assert.match(css, re, 'CJK justify 規則必須仍在注入 CSS 內（specificity 0,2,0 > 左對齊 0,1,1）');
  });

  it('左對齊規則 specificity 不得高過 CJK justify（不可用雙屬性 / *）', () => {
    // 防呆：若日後把左對齊 selector 加成 [data-jread-active][data-jread-active]（0,2,x）
    // 或 [data-jread-active] *，會蓋掉 CJK justify。禁止這兩種寫法出現在左對齊規則附近。
    assert.doesNotMatch(css, /\[data-jread-active="1"\]\[data-jread-active="1"\][^{]*text-align:\s*left/,
      '左對齊不可用雙屬性提升 specificity（會蓋 CJK justify）');
  });
});
