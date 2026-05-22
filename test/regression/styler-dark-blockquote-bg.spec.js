// JRead — regression spec: dark/sepia theme blockquote 對比修法 (v0.7.154)
// -----------------------------------------------------------------------------
// Forcing function for v0.7.154 修法。
// Trigger: Jimmy 2026-05-21 回報商周 /Archive/Article?StrId=7014078 dark theme
// 「引文底色與文字對比太低很難閱讀」截圖。
//
// Root cause: styler line 454 `*:not(blockquote)...` background 清除規則刻意
// 保留 blockquote 原站 bg（W3C 引述語意視覺區隔），light theme 下淺灰底 + 黑字
// 可讀；但 dark theme 下 jread `* { color: theme.text }` 把文字色覆寫成淺色
// （#d4d4d4），blockquote bg 仍是站點原本 light theme 設計的淺灰（#f5f5f5）→
// 淺灰底 + 淺灰文字、對比 1.38:1（WCAG AA 需 4.5:1）。
//
// v0.7.154 修法：styler dark/sepia theme override 注入 blockquote
// background-color: transparent + background-image: none，bg 透出 reader card
// dark bg（#1a1a1a）→ 對比 11.74:1（AAA）。light theme 不注入（既有 preserve
// 設計仍有效）。selector `html.__jread-active [data-jread-active="1"] blockquote`
// specificity (0,2,1) > 站點常見 `blockquote.blockquote` (0,1,1) rule。
//
// jsdom 不算 layout / 不解析 cascade，spec 驗 stylesheet 字串注入。
//
// 4 條 forcing function:
//   (a) dark theme 注入 blockquote background-color: transparent rule
//   (b) sepia theme 同
//   (c) light theme 不注入（避免破壞既有 light blockquote 視覺設計）
//   (d) selector 用 html.__jread-active 提升 specificity（避免被站點覆蓋）

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

describe('styler — dark/sepia theme blockquote bg fix (v0.7.154)', () => {
  // 嚴格 regex：只命中「selector 含 blockquote」的 rule（避免命中 base 規則
  // `*:not(figure):not(blockquote)... { background-color: transparent }` 那條
  // `:not(blockquote)` 字串）。`[^{]*` 容忍 v0.7.164 之後 selector 變 comma list
  // （blockquote, pre, code 共用同一條 rule body），blockquote 之後到 `{` 之間
  // 可以含其他 selector。
  const BQ_BG_RULE = /html\.__jread-active\s+\[data-jread-active="1"\]\s+blockquote\b[^{]*\{[^}]*background-color:\s*transparent\s*!important/i;

  it('(a) dark theme: stylesheet 含 blockquote background-color: transparent rule', () => {
    const css = setup('dark');
    assert.ok(BQ_BG_RULE.test(css),
      `dark theme stylesheet 必須含「html.__jread-active [data-jread-active="1"] blockquote { background-color: transparent !important }」rule，否則 dark bg 下站點 blockquote 淺底 + jread 淺文字對比不足`);
  });

  it('(b) sepia theme: stylesheet 含 blockquote background-color: transparent rule', () => {
    const css = setup('sepia');
    assert.ok(BQ_BG_RULE.test(css),
      `sepia theme stylesheet 必須含 blockquote background-color: transparent rule`);
  });

  it('(c) light theme: stylesheet 不注入 blockquote background rule（保留既有 preserve 設計）', () => {
    const css = setup('light');
    // light theme 不該 override blockquote bg——既有 styler line 454 preserve
    // 清單對 light bg + 黑文字情境是合理視覺設計，dark/sepia 才需要清。
    assert.ok(!BQ_BG_RULE.test(css),
      `light theme 不該注入 blockquote background-color rule`);
  });

  it('(d) dark theme: blockquote rule selector 用 html.__jread-active 提升 specificity', () => {
    const css = setup('dark');
    // 避免站點 blockquote.blockquote (0,1,1) / .quote-block (0,1,0) 等具體
    // selector 勝出。specificity (0,2,1) > (0,1,1)，html.class selector 確保贏。
    assert.ok(BQ_BG_RULE.test(css),
      `blockquote bg rule 必須用 html.__jread-active + [data-jread-active="1"] 雙層 selector（specificity 0,2,1），避免站點 blockquote.blockquote (0,1,1) rule 勝出`);
  });
});
