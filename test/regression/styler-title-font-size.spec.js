// JRead — styler titleFontSize（v0.7.175）
//
// 使用者調大內文字級（如 54px）後，原站 h1 常只有 30-36px，標題反而比內文小。
// 新增 titleFontSize 設定：0 = Auto 保留原站、非 0 覆寫 h1 font-size。
//
// v0.7.175 修正：CNA 等站 h1 文字包在 <span> 裡，SPAN_TEXT_SEL 把 span 字級壓
// 成 body fontSize。CSS rule 必須同時 target h1 和 h1 *，穿透子元素。
//
// 本 spec 驗：
//   1. titleFontSize > 0 → CSS 注入 h1 + h1 * font-size override
//   2. titleFontSize = 0 (Auto) → 不注入 h1 font-size rule
//   3. titleFontSize 極端值 clamp [8, 200]

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'eet-china-title-sibling.html');

describe('styler — titleFontSize（v0.7.175）', () => {
  let window, articleEl;

  beforeEach(() => {
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

  it('titleFontSize=72 → CSS 注入 h1 + h1 * font-size override', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 72
    });
    const css = window.document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('font-size: 72px !important'),
      'CSS 必須含 font-size: 72px !important');
    assert.ok(/h1\s*\*/.test(css),
      'CSS 必須含 h1 * selector（穿透 h1 內 span 等子元素）');
  });

  it('titleFontSize=0 (Auto) → CSS 不含 h1 font-size rule', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 0
    });
    const css = window.document.getElementById('__jread-style').textContent;
    assert.ok(!/h1\s*\*\s*\{[^}]*font-size:/.test(css),
      'Auto 模式不可注入 h1 * font-size rule');
  });

  it('titleFontSize 未提供 → 預設 Auto、不注入 h1 font-size', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7
    });
    const css = window.document.getElementById('__jread-style').textContent;
    assert.ok(!/h1\s*\*\s*\{[^}]*font-size:/.test(css),
      '未提供 titleFontSize 時預設 Auto，不可注入 h1 * font-size rule');
  });

  it('titleFontSize=1e308 → clamp 到 200px 以下', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 1e308
    });
    const css = window.document.getElementById('__jread-style').textContent;
    const match = css.match(/font-size:\s*(\d+)px\s*!important/g);
    const h1Sizes = match.filter(m => {
      const n = Number(m.match(/(\d+)/)[1]);
      return n > 18;
    });
    assert.ok(h1Sizes.length > 0, 'h1 font-size rule 必須存在');
    for (const s of h1Sizes) {
      const n = Number(s.match(/(\d+)/)[1]);
      assert.ok(n <= 200, `font-size (${n}px) 必須 <= 200px`);
    }
  });

  it('titleFontSize=2 → clamp 到 8px 下限', () => {
    window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 2
    });
    const css = window.document.getElementById('__jread-style').textContent;
    assert.ok(css.includes('font-size: 8px !important'),
      'titleFontSize=2 應 clamp 到 8px');
  });
});
