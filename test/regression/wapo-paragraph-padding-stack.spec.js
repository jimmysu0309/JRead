// JRead — 段落 padding 與 paragraphSpacing margin 雙倍間距修正（v0.8.92）
//
// 對應 bug（cage 實測 washingtonpost Opinion 文章，Jimmy 2026-06-16 回報「段落
// 之間有額外的空白」）：WaPo article-body 對每個內文 <p> 設 `padding-bottom: 24px`
// 撐段距（不是 margin）。reader 的 paragraphSpacing 注入 `margin-bottom: 1em`(16px)
// 後，與站點 padding 疊成 40px 雙倍段距——reader 看起來比原站更鬆。
//
// 修法（結構通則，非站點特判，硬規則 3）：段落垂直間距改由 reader margin 單一
// 決定（單一資料源原則）。paragraphSpacing 注入（>= 0）時一併清掉 <p> 的
// padding-top/bottom，段距 = paragraphSpacing 值，與站點用 margin 或 padding 撐
// 段距無關、跨站一致。Auto sentinel（-1）下不注入 margin、也不清 padding（保留
// 原站 typography），與 v0.7.201 register-paragraph-padding 的 top/bottom 保留
// 決策在 Auto 模式下並存。只清 <p>：list 縮排是 padding-left、blockquote 引言框
// 靠 padding 撐內距且 reader 保留其背景，皆不在清除範圍。
//
// 本 spec 驗注入 CSS 字串（forcing function）；真實視覺間距由 cage / harness 驗。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'wapo-paragraph-padding-stack.html');

const BASE = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function getCss(settings) {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['detector', 'styler'] });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須命中 fixture 主文');
  env.NS.styler.apply(detected.el, settings);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, '必須注入 __jread-style');
  return styleEl.textContent;
}

// 抓「只含 p selector」的 padding-top/bottom 歸零 rule block
function pPaddingRule(css) {
  return css.match(/\[data-jread-active="1"\]\s+p\s*\{([^}]*)\}/g) || [];
}

describe('styler — 段落 padding 與 paragraphSpacing 雙倍間距修正（v0.8.92）', () => {
  it('paragraphSpacing 預設（1.0）：注入 [data-jread-active] p 的 padding-top/bottom: 0', () => {
    const css = getCss(BASE);
    const blocks = pPaddingRule(css);
    const hit = blocks.find(b => /padding-top\s*:\s*0\s*!important/.test(b) && /padding-bottom\s*:\s*0\s*!important/.test(b));
    assert.ok(hit,
      'paragraphSpacing 注入時必須有 `[data-jread-active="1"] p { padding-top:0; padding-bottom:0 }` ' +
      '規則（否則站點 padding-bottom 與 reader margin 疊成雙倍段距）');
  });

  it('paragraphSpacing = 0（段落緊貼）也要清 p 垂直 padding（>= 0 條件分支）', () => {
    const css = getCss({ ...BASE, paragraphSpacing: 0 });
    const blocks = pPaddingRule(css);
    const hit = blocks.find(b => /padding-bottom\s*:\s*0\s*!important/.test(b));
    assert.ok(hit, 'paragraphSpacing=0 仍走 >= 0 注入分支、仍須清 p 垂直 padding');
  });

  it('paragraphSpacing = -1（Auto）：不清 p 垂直 padding（保留原站段距）', () => {
    const css = getCss({ ...BASE, paragraphSpacing: -1 });
    const blocks = pPaddingRule(css);
    const hit = blocks.find(b => /padding-bottom\s*:\s*0\s*!important/.test(b) && /padding-top\s*:\s*0\s*!important/.test(b));
    assert.ok(!hit,
      'Auto 模式不注入 reader margin、也不可清 p 垂直 padding（否則原站唯一的段距' +
      '機制被清掉、段落緊貼）');
  });

  it('padding-left/right 不被本規則動到（水平版心交給 v0.7.201 register 規則）', () => {
    const css = getCss(BASE);
    // 本 v0.8.92 規則只設垂直 padding；不可在同一 p-only block 內出現 padding-left/right
    const blocks = pPaddingRule(css);
    const vertOnly = blocks.find(b => /padding-top\s*:\s*0/.test(b));
    assert.ok(vertOnly && !/padding-left|padding-right/.test(vertOnly),
      'v0.8.92 的 p 垂直 padding 歸零 block 不應混入 left/right（避免與 register 規則語意重疊）');
  });
});
