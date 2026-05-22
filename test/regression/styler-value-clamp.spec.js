// JRead — styler 數值 clamp（v0.7.143）
//
// Bug：styler.apply 收 settings.fontSize / contentWidth / lineHeight 時只擋 0/負/
// NaN，但不擋上限——外部寫入 `fontSize: 1e308` 或 storage 損壞時極大值會直接
// 注入 CSS。popup UI 已 clamp [12, 32]、options 也有 HTML5 min/max，但儲存層
// 沒驗、第二道防線缺失。
//
// 修法：
//   fontSize: clamp [8, 200]px，保留 0 = Auto sentinel
//   contentWidth: clamp [300, 2000]px
//   lineHeight: clamp [1.0, 3.0]（unitless ratio）
//
// 本 spec 是 forcing function：驗極端值傳入後、生成 CSS 不可出現極端值字面。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eet-china-title-sibling.html');

describe('styler — 數值 clamp（v0.7.143）', () => {
  let window, articleEl;

  before(() => {
    const env = loadFixtureWithScripts({
      fixturePath: FIXTURE_PATH,
      scripts: ['styler'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    window = env.window;
    articleEl = env.document.querySelector('.article-text-con');
    assert.ok(articleEl);
  });

  it('極大 fontSize (1e308) 必須 clamp 到上限 200 以下', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light',
      fontSize: 1e308,
      contentWidth: 720,
      fontFamily: 'system-ui',
      lineHeight: 1.7
    });
    const styleEl = window.document.getElementById('__jread-style');
    assert.ok(styleEl, '必須有 jread style 注入');
    const css = styleEl.textContent;
    assert.ok(!/font-size:\s*1e\+?\d+/.test(css),
      'CSS 不可含 1e+308 字面（極大值未 clamp）');
    // 應找到 200px 或更小的 font-size
    const match = css.match(/font-size:\s*(\d+(?:\.\d+)?)px\s*!important/);
    if (match) {
      const px = parseFloat(match[1]);
      assert.ok(px <= 200, `clamp 後 font-size 應 <= 200px，實際 ${px}px`);
    }
    window.__JRead.styler.restore(articleEl, null);
  });

  it('極大 contentWidth (1e308) 必須 clamp 到上限 2000 以下', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light',
      fontSize: 18,
      contentWidth: 1e308,
      fontFamily: 'system-ui',
      lineHeight: 1.7
    });
    const styleEl = window.document.getElementById('__jread-style');
    const css = styleEl.textContent;
    assert.ok(!/max-width:\s*1e\+?\d+/.test(css), 'CSS 不可含 1e+308 字面');
    const match = css.match(/max-width:\s*(\d+(?:\.\d+)?)px/);
    if (match) {
      const px = parseFloat(match[1]);
      assert.ok(px <= 2000, `clamp 後 max-width 應 <= 2000px，實際 ${px}px`);
    }
    window.__JRead.styler.restore(articleEl, null);
  });

  it('微小 fontSize (0.001) 必須 clamp 到下限 8 以上', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light',
      fontSize: 0.001,
      contentWidth: 720,
      fontFamily: 'system-ui',
      lineHeight: 1.7
    });
    const styleEl = window.document.getElementById('__jread-style');
    const css = styleEl.textContent;
    const match = css.match(/font-size:\s*(\d+(?:\.\d+)?)px\s*!important/);
    assert.ok(match, '必須注入 font-size override');
    const px = parseFloat(match[1]);
    assert.ok(px >= 8, `clamp 後 font-size 應 >= 8px，實際 ${px}px`);
    window.__JRead.styler.restore(articleEl, null);
  });

  it('fontSize = 0（Auto sentinel）必須保留、不可 clamp 到 8', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light',
      fontSize: 0,
      contentWidth: 720,
      fontFamily: 'system-ui',
      lineHeight: 1.7
    });
    const styleEl = window.document.getElementById('__jread-style');
    const css = styleEl.textContent;
    // fontSize = 0 是 Auto 模式——styler 完全不該注入 font-size override
    assert.ok(!/font-size:\s*\d+(?:\.\d+)?px\s*!important/.test(css),
      `fontSize=0 (Auto) 不可注入 font-size override（保留原站字級）；實際 CSS:\n${css.slice(0, 500)}`);
    window.__JRead.styler.restore(articleEl, null);
  });

  it('極大 lineHeight (1000) 必須 clamp 到上限 3.0 以下', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light',
      fontSize: 18,
      contentWidth: 720,
      fontFamily: 'system-ui',
      lineHeight: 1000
    });
    const styleEl = window.document.getElementById('__jread-style');
    const css = styleEl.textContent;
    const match = css.match(/line-height:\s*(\d+(?:\.\d+)?)\s*!important/);
    if (match) {
      const lh = parseFloat(match[1]);
      assert.ok(lh <= 3.0, `clamp 後 line-height 應 <= 3.0，實際 ${lh}`);
    }
    window.__JRead.styler.restore(articleEl, null);
  });

  // v0.7.162 paragraphSpacing clamp
  it('極大 paragraphSpacing (1e308) 必須 clamp 到上限 5em 以下', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light',
      fontSize: 18,
      contentWidth: 720,
      fontFamily: 'system-ui',
      lineHeight: 1.7,
      paragraphSpacing: 1e308
    });
    const styleEl = window.document.getElementById('__jread-style');
    const css = styleEl.textContent;
    assert.ok(!/margin-bottom:\s*1e\+?\d+em/.test(css), 'CSS 不可含 1e+308em 字面');
    const match = css.match(/margin-bottom:\s*(\d+(?:\.\d+)?)em\s*!important/);
    if (match) {
      const em = parseFloat(match[1]);
      assert.ok(em <= 5, `clamp 後 paragraphSpacing 應 <= 5em，實際 ${em}em`);
    }
    window.__JRead.styler.restore(articleEl, null);
  });

  it('paragraphSpacing = -1（Auto sentinel）必須保留、不可 clamp 到 0', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light',
      fontSize: 18,
      contentWidth: 720,
      fontFamily: 'system-ui',
      lineHeight: 1.7,
      paragraphSpacing: -1
    });
    const styleEl = window.document.getElementById('__jread-style');
    const css = styleEl.textContent;
    // -1 是 Auto sentinel——不該注入 p/ul/ol/blockquote margin-bottom 規則
    assert.ok(!/\[data-jread-active="1"\]\s+p,[\s\S]*?\[data-jread-active="1"\]\s+blockquote\s*\{[^}]*margin-bottom/.test(css),
      `paragraphSpacing=-1 (Auto) 不可注入 p/ul/ol/blockquote margin-bottom 規則；實際 CSS:\n${css.slice(0, 500)}`);
    window.__JRead.styler.restore(articleEl, null);
  });

  it('paragraphSpacing = -2（無效負值）必須 fallback 到 DEFAULTS（1.0），不可注入 -2em', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light',
      fontSize: 18,
      contentWidth: 720,
      fontFamily: 'system-ui',
      lineHeight: 1.7,
      paragraphSpacing: -2
    });
    const styleEl = window.document.getElementById('__jread-style');
    const css = styleEl.textContent;
    assert.ok(!/margin-bottom:\s*-\d+(?:\.\d+)?em/.test(css),
      'CSS 不可含負值 em（-2 不應通過 clamp）');
    // -2 應 fallback 到 DEFAULTS.paragraphSpacing = 1.0 → 注入 1em
    const m = css.match(/\[data-jread-active="1"\]\s+p[\s\S]*?\[data-jread-active="1"\]\s+blockquote\s*\{([^}]*)\}/);
    assert.ok(m, 'paragraphSpacing 無效負值應 fallback 到 1.0，仍有 rule block');
    assert.ok(/margin-bottom\s*:\s*1em\s*!important/.test(m[1]),
      'paragraphSpacing 無效負值應 fallback 到 1.0 → margin-bottom: 1em');
    window.__JRead.styler.restore(articleEl, null);
  });
});
