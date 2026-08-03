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

  it('titleFontSize=72 → h1 rule 同步注入 line-height: 1.3（v1.7.14）', () => {
    // NYT h1 64px 配 px 鎖死 line-height:67px，titleFontSize 縮小後行高
    // 不縮 = 每行之間空出一行、標題像被拆成多段。override 字級必須連帶
    // 注入 unitless 標題行高。
    window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 72
    });
    const css = window.document.getElementById('__jread-style').textContent;
    assert.ok(/h1\s*\*\s*\{[^}]*line-height:\s*1\.3\s*!important/.test(css),
      'h1 rule 必須含 line-height: 1.3 !important');
  });

  it('titleFontSize=72 + lineHeight Auto(0) → h1 rule 不注入 line-height', () => {
    // 行距 Auto sentinel = 使用者顯式要求保留原站行距，title 分支跟 body
    // 分支同一 trade-off、一併跳過
    window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 0, titleFontSize: 72
    });
    const css = window.document.getElementById('__jread-style').textContent;
    assert.ok(!/h1\s*\*\s*\{[^}]*line-height/.test(css),
      '行距 Auto 時 h1 rule 不可注入 line-height');
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

  it('titleFontSize 未提供 → 落到 DEFAULTS 32、注入 h1 font-size（v1.7.33 預設改 32）', () => {
    // v1.7.33 前預設 0 = Auto；改版後未提供（storage 缺欄 / 損壞）落到預設 32。
    // 「保留原站標題」仍可用明確 sentinel 0 表達（上一個 case 驗證）。
    window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7
    });
    const css = window.document.getElementById('__jread-style').textContent;
    assert.ok(/h1\s*\*\s*\{[^}]*font-size:\s*32px\s*!important/.test(css) ||
      /font-size:\s*32px\s*!important/.test(css),
      '未提供 titleFontSize 時必須落到預設 32、注入 h1 font-size: 32px');
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

// v0.8.3：hero 字級下限（Jimmy 2026-06-09 規則）。Auto 模式下原站標題太小時
// 把 hero 拉到至少 1.5× 內文字級（roomie.tw 23px span 類站）。
describe('styler — hero 字級下限（v0.8.3）', () => {
  const FLOOR_FIXTURE = path.join(__dirname, 'fixtures', 'hero-title-font-floor.html');

  function applyWith(opts) {
    const env = loadFixtureWithScripts({
      fixturePath: FLOOR_FIXTURE,
      scripts: ['styler'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const articleEl = env.document.querySelector('.article-body');
    articleEl.setAttribute('data-jread-active', '1');
    env.window.__JRead.styler.apply(articleEl, opts);
    return { window: env.window, articleEl };
  }

  it('Auto 模式：過小的 hero h1 被拉到 1.5× 內文字級（18 → 27px inline）', () => {
    const { articleEl } = applyWith({
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 0
    });
    const h1 = articleEl.querySelector('h1.post-title');
    assert.strictEqual(h1.style.getPropertyValue('font-size'), '27px',
      `Auto 模式下過小 hero 應被拉到 27px，實際 "${h1.style.getPropertyValue('font-size')}"`);
    assert.strictEqual(h1.style.getPropertyPriority('font-size'), 'important',
      'hero 字級下限必須用 !important');
  });

  it('內文 36px → 下限 54px（隨內文字級縮放）', () => {
    const { articleEl } = applyWith({
      theme: 'light', fontSize: 36, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 0
    });
    const h1 = articleEl.querySelector('h1.post-title');
    assert.strictEqual(h1.style.getPropertyValue('font-size'), '54px',
      `內文 36px 時 hero 下限應為 54px，實際 "${h1.style.getPropertyValue('font-size')}"`);
  });

  it('override 模式（titleFontSize>0）：hero floor 不介入，由 titleFontSize 精準覆寫', () => {
    const { articleEl } = applyWith({
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 72
    });
    const h1 = articleEl.querySelector('h1.post-title');
    assert.strictEqual(h1.style.getPropertyValue('font-size'), '72px',
      `override 模式 hero 應為 72px（非 floor），實際 "${h1.style.getPropertyValue('font-size')}"`);
  });

  it('restore 後 hero inline font-size 完全還原', () => {
    const env = loadFixtureWithScripts({
      fixturePath: FLOOR_FIXTURE,
      scripts: ['styler'],
      viewport: { width: 1000, height: 800 },
      pretendToBeVisual: true
    });
    const articleEl = env.document.querySelector('.article-body');
    articleEl.setAttribute('data-jread-active', '1');
    const snap = env.window.__JRead.styler.apply(articleEl, {
      theme: 'light', fontSize: 18, contentWidth: 720,
      fontFamily: 'system-ui', lineHeight: 1.7, titleFontSize: 0
    });
    env.window.__JRead.styler.restore(articleEl, snap);
    const h1 = articleEl.querySelector('h1.post-title');
    assert.strictEqual(h1.style.getPropertyValue('font-size'), '',
      `restore 後 hero inline font-size 應清空，實際 "${h1.style.getPropertyValue('font-size')}"`);
  });
});
