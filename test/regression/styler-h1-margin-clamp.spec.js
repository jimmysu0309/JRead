// JRead — regression spec: h1-h6 margin clamp (v0.7.171)
// -----------------------------------------------------------------------------
// 修法：v0.7.100 對 h1-h6 注入 `margin-top: 1.5em !important`，意圖確保「站點
// 把 heading margin 砍光」時仍有視覺斷層。但對「H1 font-size 巨大」站點
// (CNBC h1.headline font-size: 54px) 變成 1.5em = 81px margin-top、產生「LIFE
// 標籤跟標題中間 80-90px 空白」、dark mode 特別明顯。Jimmy 2026-05-23 CNBC
// blob 截圖揭穿。
//
// v0.7.171 改用 clamp() 上下限封頂：
//   margin-top: clamp(16px, 1em, 32px)
//   margin-bottom: clamp(8px, 0.4em, 16px)
//
// jsdom 不算 CSS layout，但能驗 styler 注入的 CSS 字串含此 declaration。
// 真實視覺由 cage 在 CNBC 實測驗證 (gap 從 91px → 42px)。
//
// 4 條 forcing function:
//   (a) CSS 必須含 h1-h6 selector
//   (b) margin-top declaration 必須是 clamp(16px, 1em, 32px) !important
//   (c) margin-bottom declaration 必須是 clamp(8px, 0.4em, 16px) !important
//   (d) 必須不存在舊的 `margin-top: 1.5em !important` 行 (防 v0.7.100 殘留)

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'businessweekly-7014035.html');

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

describe('styler — h1-h6 margin clamp (v0.7.171 CNBC big h1 font)', () => {
  it('(a) CSS 必須含 [data-jread-active="1"] h1-h6 selector group', () => {
    const css = getInjectedCss();
    // h1-h6 全在同一 rule group 內
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      const re = new RegExp(`\\[data-jread-active="1"\\]\\s*${tag}\\b`);
      assert.ok(re.test(css), `CSS 必須含 [data-jread-active="1"] ${tag} selector`);
    }
  });

  it('(b) heading rule margin-top 必須是 clamp(16px, 1em, 32px) !important', () => {
    const css = getInjectedCss();
    // 抓 h1-h6 rule body（找 h6 後面的 {...}）
    const m = css.match(/\[data-jread-active="1"\]\s*h6\s*\{([^}]+)\}/);
    assert.ok(m, '必須找到 h6 rule 區塊（h1-h6 合併 selector 最末條）');
    const body = m[1];
    assert.ok(/margin-top\s*:\s*clamp\(\s*16px\s*,\s*1em\s*,\s*32px\s*\)\s*!important/.test(body),
      'rule body 必須含 margin-top: clamp(16px, 1em, 32px) !important');
  });

  it('(c) heading rule margin-bottom 必須是 clamp(8px, 0.4em, 16px) !important', () => {
    const css = getInjectedCss();
    const m = css.match(/\[data-jread-active="1"\]\s*h6\s*\{([^}]+)\}/);
    assert.ok(m, '必須找到 h6 rule 區塊');
    const body = m[1];
    assert.ok(/margin-bottom\s*:\s*clamp\(\s*8px\s*,\s*0\.4em\s*,\s*16px\s*\)\s*!important/.test(body),
      'rule body 必須含 margin-bottom: clamp(8px, 0.4em, 16px) !important');
  });

  it('(d) 必須不存在舊的 `margin-top: 1.5em !important` 在 h1-h6 rule 內（防 v0.7.100 殘留）', () => {
    const css = getInjectedCss();
    const m = css.match(/\[data-jread-active="1"\]\s*h6\s*\{([^}]+)\}/);
    assert.ok(m);
    const body = m[1];
    assert.ok(!/margin-top\s*:\s*1\.5em\s*!important/.test(body),
      'h1-h6 rule body 不可仍有 margin-top: 1.5em !important（舊版 v0.7.100 殘留）');
  });
});
