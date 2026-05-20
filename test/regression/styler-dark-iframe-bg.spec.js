// JRead — regression spec: dark/sepia theme iframe 白底 (v0.7.151)
// -----------------------------------------------------------------------------
// Forcing function for styler v0.7.151 修法。
// Trigger: Jimmy 2026-05-20 回報 healthsystemtracker.org dark theme「圖表
// 區塊也使用深底色，導致文字難以閱讀」。
//
// Root cause: dark / sepia theme reader card bg 深、跨 origin iframe
// （datawrapper / flourish 等 chart embed）預設 transparent 背景 + 為
// light theme 嵌入站設計的深色文字 → 跟 dark reader card bg 完全融在一起。
//
// v0.7.151 修法：styler dark/sepia theme override 區塊加 iframe
// background-color: #fff，讓 transparent area 透出白色、deeper text 可見。
// 用 `html.__jread-active [data-jread-active="1"] iframe` 提升 specificity
// 到 (0,2,2) 避免站點 `iframe.datawrapper` (0,1,2) 勝出。
//
// jsdom 不算 layout，spec 驗 stylesheet 字串注入。
//
// 4 條 forcing function:
//   (a) dark theme 注入 iframe background:#fff rule
//   (b) sepia theme 注入 iframe background:#fff rule
//   (c) light theme 不注入 iframe background rule（避免多餘 CSS）
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

describe('styler — dark/sepia theme iframe background fix (v0.7.151)', () => {
  it('(a) dark theme: stylesheet 含 iframe background-color: #fff rule', () => {
    const css = setup('dark');
    assert.ok(/iframe[^}]*background-color:\s*#fff\s*!important/i.test(css),
      `dark theme stylesheet 必須含「iframe { background-color: #fff !important }」rule，實際 stylesheet 不含此 rule`);
  });

  it('(b) sepia theme: stylesheet 含 iframe background-color: #fff rule', () => {
    const css = setup('sepia');
    assert.ok(/iframe[^}]*background-color:\s*#fff\s*!important/i.test(css),
      `sepia theme stylesheet 必須含「iframe { background-color: #fff !important }」rule`);
  });

  it('(c) light theme: stylesheet 不注入 iframe background rule（避免多餘 CSS）', () => {
    const css = setup('light');
    // light theme 不該 override iframe bg（light reader card 已是 #fff、iframe
    // transparent 透出來也是 #fff，重複注入無意義）
    // 驗：iframe rule 不含 background-color
    const iframeBgRules = css.match(/iframe[^}]*background-color/g) || [];
    assert.strictEqual(iframeBgRules.length, 0,
      `light theme 不該注入 iframe background-color rule，實際命中 ${iframeBgRules.length} 條`);
  });

  it('(d) dark theme: iframe rule selector 用 html.__jread-active 提升 specificity', () => {
    const css = setup('dark');
    // 避免站點 iframe.datawrapper (0,1,2) 等具體 class selector 勝出
    assert.ok(/html\.__jread-active\s+\[data-jread-active="1"\]\s+iframe\s*\{[^}]*background-color:\s*#fff/i.test(css),
      `iframe bg rule 必須用 html.__jread-active + [data-jread-active="1"] 雙層 selector（specificity 0,2,2），避免站點 (0,1,2) rule 勝出`);
  });
});
