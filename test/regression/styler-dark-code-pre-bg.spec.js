// JRead — regression spec: dark/sepia theme pre/code 對比修法 (v0.7.164)
// -----------------------------------------------------------------------------
// Forcing function for v0.7.164 修法。
// Trigger: Jimmy 2026-05-22 回報 Medium @ddsakura-blog M5 Max 評測文 dark theme
// 「白底卡片內淺灰字閱讀困難」截圖。Probe 確認真兇是 <pre>（站點 .pre 套
// bg #f9f9f9）+ inline <code>（站點 .code 套 bg #f2f2f2），styler dark theme
// 把 color 覆寫 #d4d4d4 → 對比 1.04:1（比 blockquote 的 1.38:1 更糟）。
//
// Root cause: styler line 463 `*:not(pre):not(code)...` background 清除規則
// 刻意保留 pre / code 原站 bg（程式碼框視覺區隔），light theme 下淺灰底 + 黑字
// 可讀；但 dark theme 下 jread `* { color: theme.text }` 把文字色覆寫成淺色，
// pre / code bg 仍是站點 light theme 設計的淺灰 → 不可讀。
//
// v0.7.164 修法：把 v0.7.154 的 dark/sepia blockquote transparent rule 擴成
// blockquote, pre, code 共用同一條（單一通則覆蓋所有「站點 light bg + jread
// dark text」的程式碼類元素）。bg 透出 reader card dark bg (#1a1a1a) → 對比
// 11.74:1（AAA）。light theme 不注入。
//
// jsdom 不算 layout / 不解析 cascade，spec 驗 stylesheet 字串注入。
//
// 6 條 forcing function:
//   (a) dark theme 注入 pre background-color: transparent rule
//   (b) dark theme 注入 code background-color: transparent rule
//   (c) sepia theme 同 (pre)
//   (d) sepia theme 同 (code)
//   (e) light theme 不注入 pre rule
//   (f) light theme 不注入 code rule

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

function setup(themeName) {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['detector', 'styler']
  });
  const detected = env.NS.detector.detect();
  assert.ok(detected);
  const settings = {
    theme: themeName,
    fontSize: 18,
    contentWidth: 720,
    fontFamily: 'system-ui',
    lineHeight: 1.7
  };
  env.NS.styler.apply(detected.el, settings);
  const styleEl = env.document.getElementById('__jread-style');
  assert.ok(styleEl);
  return styleEl.textContent;
}

// regex 容忍 v0.7.164 multi-selector list（blockquote, pre, code 共用同條 rule
// body）：對單一 tag 命中即可，rule body 在 selector list 末尾的 `{` 後。
function buildBgRule(tag) {
  return new RegExp(
    `html\\.__jread-active\\s+\\[data-jread-active="1"\\]\\s+${tag}\\b[^{]*\\{[^}]*background-color:\\s*transparent\\s*!important`,
    'i'
  );
}

describe('styler — dark/sepia theme pre/code bg fix (v0.7.164)', () => {
  const PRE_BG_RULE = buildBgRule('pre');
  const CODE_BG_RULE = buildBgRule('code');

  it('(a) dark theme: stylesheet 含 pre background-color: transparent rule', () => {
    const css = setup('dark');
    assert.ok(PRE_BG_RULE.test(css),
      `dark theme stylesheet 必須含「html.__jread-active [data-jread-active="1"] pre { background-color: transparent !important }」rule，否則 Medium / dev.to 等站點 <pre> 在 dark bg 下對比不足`);
  });

  it('(b) dark theme: stylesheet 含 code background-color: transparent rule', () => {
    const css = setup('dark');
    assert.ok(CODE_BG_RULE.test(css),
      `dark theme stylesheet 必須含 code background-color: transparent rule，否則 inline <code> 在 dark bg 下對比不足`);
  });

  it('(c) sepia theme: stylesheet 含 pre background-color: transparent rule', () => {
    const css = setup('sepia');
    assert.ok(PRE_BG_RULE.test(css),
      `sepia theme stylesheet 必須含 pre background-color: transparent rule`);
  });

  it('(d) sepia theme: stylesheet 含 code background-color: transparent rule', () => {
    const css = setup('sepia');
    assert.ok(CODE_BG_RULE.test(css),
      `sepia theme stylesheet 必須含 code background-color: transparent rule`);
  });

  it('(e) light theme: stylesheet 不注入 pre background rule', () => {
    const css = setup('light');
    // light theme 不該 override pre bg——既有 styler line 463 preserve 清單
    // 對 light bg + 黑文字情境是合理視覺設計，dark/sepia 才需要清。
    assert.ok(!PRE_BG_RULE.test(css),
      `light theme 不該注入 pre background-color rule`);
  });

  it('(f) light theme: stylesheet 不注入 code background rule', () => {
    const css = setup('light');
    assert.ok(!CODE_BG_RULE.test(css),
      `light theme 不該注入 code background-color rule`);
  });
});
