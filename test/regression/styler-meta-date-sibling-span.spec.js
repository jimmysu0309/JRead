// JRead — regression spec: meta/日期列 time 旁 bare span 字級保留 (v0.8.13)
// -----------------------------------------------------------------------------
// Trigger: Jimmy 2026-06-09 回報 roomie.tw /posts/73403「『更新』這兩個字的尺寸
// 很突兀」。meta 列 DOM：
//   <time class="post-date">2023/5/24</time><span>更新</span>
// `<time>` 不在 BODY_TEXT_SEL → 保留站點 .post-date 小字（實測 11px）；相鄰
// 的 bare <span>更新</span> 被 SPAN_TEXT_SEL 拉成 body fontSize（18px）→ 同一條
// meta 列 11px 日期 + 18px「更新」字級斷層。
//
// Root cause: time 與其相鄰 span 是同一份「日期/meta 列」事實，卻被兩條 path
// 各自處理（time 排除、span 命中）→ drift。
//
// v0.8.13 修法：SPAN_TEXT_SEL 加 `:not(time ~ span)`——time 的後續兄弟 span 視為
// meta 列標籤，跟 time 一起保留站點 typography，不被 body 字級/字型/字重覆寫。
// `time ~ span` 是結構訊號（非站點/class 特判），複合 selector in :not() 走
// Selectors 4（Chrome 88+，同 :not(pre *)）。
//
// jsdom 不算 cascade，但 nwsapi 支援 querySelectorAll(':not(time ~ span)')，故
// 本 spec 同時驗 (a) 注入字串含子句 + (b) 行為：用注入的 font-size selector list
// 實跑 querySelectorAll，meta span 須被排除、主文 span 須仍命中。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'roomie-meta-date-span.html');

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

describe('styler — meta/date sibling span 字級保留 (v0.8.13)', () => {
  it('(a) 注入的 font-size rule selector 含 :not(time ~ span)', () => {
    const { css } = setup({ fontSize: 22 });
    const sel = getFontSizeSelectorList(css);
    assert.ok(sel, 'CSS 必須注入 font-size rule');
    assert.ok(/span[^,{]*:not\(\s*time\s*~\s*span\s*\)/i.test(sel),
      'font-size rule 的 span selector 必須含 :not(time ~ span)（v0.8.13：time 旁 meta span 不被 body 字級覆寫）');
  });

  it('(b) 行為：meta 列「更新」span 被排除、主文 span 仍命中', () => {
    const { css, env } = setup({ fontSize: 22 });
    const sel = getFontSizeSelectorList(css);
    assert.ok(sel);
    const matched = [...env.document.querySelectorAll(sel)];
    // article 確實被標記 data-jread-active
    const metaSpan = [...env.document.querySelectorAll('time ~ span')]
      .find(s => s.textContent.trim() === '更新');
    assert.ok(metaSpan, 'fixture 必須含 time 旁的「更新」span');
    assert.ok(!matched.includes(metaSpan),
      '「更新」span 不應被 font-size selector 命中（會被拉成 body 18px，跟 11px 日期斷層）');
    const bodySpan = [...env.document.querySelectorAll('p span')]
      .find(s => s.textContent.trim() === '30 元');
    assert.ok(bodySpan, 'fixture 必須含主文內 span');
    assert.ok(matched.includes(bodySpan),
      '主文 <p> 內 span 仍須被 font-size selector 命中（SPAN_TEXT_SEL 對主文 span 的原意不變）');
  });

  it('(c) sanity：拿掉 :not(time ~ span) 子句後 meta span 會被命中（破壞驗證）', () => {
    const { css, env } = setup({ fontSize: 22 });
    const sel = getFontSizeSelectorList(css);
    const broken = sel.replace(/:not\(\s*time\s*~\s*span\s*\)/gi, '');
    const matched = [...env.document.querySelectorAll(broken)];
    const metaSpan = [...env.document.querySelectorAll('time ~ span')]
      .find(s => s.textContent.trim() === '更新');
    assert.ok(matched.includes(metaSpan),
      '移除子句後「更新」span 應重新被命中（證明此子句是排除的唯一原因）');
  });
});
