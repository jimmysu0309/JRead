// JRead — v1.7.41（review 批次 3 S2）：SPAN_TEXT_SEL 排除 figcaption 後代 span
// -----------------------------------------------------------------------------
// 根因：figcaption 刻意不在 BODY_TEXT_CORE（v0.7.120：圖說保留比 body 小的
// 階層），但 caption / photo credit 包 <span> 時，span 自己命中 SPAN_TEXT_SEL
// 被注入 body 字級——同一條圖說 span 部分 17px+、非 span 部分 11px，字級分裂。
//
// 修法：SPAN_TEXT_SEL 加 `:not(figcaption *)`——與 :not(h1 *)（heading 內 span
// 跟 heading 走）、:not(pre *)（code 框 span 跟 pre 走）同一原則：容器被豁免，
// 其 span 後代必須跟著豁免，兩條 path 不可 drift。
//
// 驗法（比照 styler-meta-date-sibling-span.spec）：(a) 注入的 font-size rule
// selector 含 :not(figcaption *)；(b) 行為——用注入的 selector 實跑
// querySelectorAll，figcaption 內 span 須被排除、主文 span 須仍命中。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'figcaption-span-caption.html');

function setup(overrides) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected, 'detector 必須選到主文');
  const settings = Object.assign({
    theme: 'light',
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    lineHeight: 1.7
  }, overrides);
  env.NS.styler.apply(detected.el, settings);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl, '必須注入 __jread-style');
  return { css: styleEl.textContent, env };
}

function getFontSizeSelectorList(css) {
  const m = css.match(/([^}]*)\{[^}]*font-size\s*:/i);
  return m ? m[1].trim() : null;
}

describe('styler v1.7.41 — figcaption 內 span 不吃 body 字級（S2）', () => {
  it('(a) 注入的 font-size rule selector 含 :not(figcaption *)', () => {
    const { css } = setup({ fontSize: 22 });
    const sel = getFontSizeSelectorList(css);
    assert.ok(sel, 'CSS 必須注入 font-size rule');
    assert.ok(/span[^,{]*:not\(\s*figcaption\s+\*\s*\)/i.test(sel),
      'font-size rule 的 span selector 必須含 :not(figcaption *)——圖說 span 被拉成 body 字級會與 figcaption 本體字級分裂');
  });

  it('(b) 行為：figcaption 內 span 不命中注入 selector、主文 span 仍命中', () => {
    const { css, env } = setup({ fontSize: 22 });
    const sel = getFontSizeSelectorList(css);
    const matched = Array.from(env.document.querySelectorAll(sel));
    const captionSpan = env.document.getElementById('caption-span');
    const creditSpan = env.document.getElementById('credit-span');
    const bodySpan = env.document.getElementById('body-span');
    assert.ok(!matched.includes(captionSpan), 'figcaption 內 caption span 不得命中字級注入');
    assert.ok(!matched.includes(creditSpan), 'figcaption 內 credit span 不得命中字級注入');
    assert.ok(matched.includes(bodySpan), '主文段落內 span 必須照常命中（豁免不可外溢）');
  });
});
