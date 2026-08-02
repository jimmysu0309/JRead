// JRead — 標題 flex 內 inline icon 不被 gallery gap 補償抬離 baseline（v1.7.29）
//
// 根因（2026-08-02 Jimmy 截圖回報 macstories club 頁 icon 與標題錯位）：
// 站點 h1 為 flex 容器（flex-column 疊排 30px 品牌 icon + 標題文字，icon 帶
// margin-bottom:.75rem）。閱讀模式兩條 path 疊打：
//   1. gallery flex 攤平（v0.7.144）把「flex 容器 + 直接子 img」當 gallery，
//      攤成 block 後 gap 補償（v0.7.94）對 icon 塞 inline margin-bottom:12px
//      !important——inline 圖的 margin-bottom 不產生流間距，只把圖沿 baseline
//      往上抬（margin box 底緣對齊 baseline）
//   2. 站點自己的 margin-bottom:.75rem 進 inline flow 後同樣是純錯位來源
//
// 修法（結構性通則）：
//   1. gap 補償 loop 跳過已標 data-jread-inline-img / data-jread-icon-img 的
//      IMG 子（攤平本身保留——h1 → block 讓 icon 進 inline flow 與標題同行）
//   2. inline-img CSS 規則垂直 margin 歸零（margin-top/bottom: 0 !important），
//      擋掉站點 CSS 給 icon 的版面 margin
//
// 本 spec 驗的訊號層：apply() 後 icon 的 inline style（gap 補償是否誤塞）+
// buildCss 注入的 inline-img 規則內容 + restore() 可逆性。不驗實際視覺
// baseline 位置（jsdom 不算 layout；視覺由 Playwright harness 驗）。

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'heading-flex-inline-icon.html');

const SETTINGS = {
  theme: 'light',
  fontSize: 18,
  contentWidth: 720,
  fontFamily: 'system-ui',
  lineHeight: 1.7,
  paragraphSpacing: 1.0
};

function stubNatural(img, w, h) {
  Object.defineProperty(img, 'naturalWidth', { value: w, configurable: true });
  Object.defineProperty(img, 'naturalHeight', { value: h, configurable: true });
}

function setup() {
  const env = loadFixtureWithScripts({
    fixturePath: FIXTURE_PATH,
    scripts: ['styler']
  });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');

  // 品牌 icon SVG：natural 60×60（> INLINE_IMG_MAX 48）、rendered 30×30 →
  // 走 rect fallback 標 inline（對應 macstories logo-shape-gold.svg 實況）
  const icon = env.document.getElementById('brand-icon');
  stubNatural(icon, 60, 60);
  stubRect(icon, { top: 100, left: 50, width: 30, height: 30 });

  // 對照組真 gallery 的兩張大內容圖
  const photo1 = env.document.getElementById('gallery-photo-1');
  stubNatural(photo1, 1200, 800);
  stubRect(photo1, { top: 400, left: 0, width: 360, height: 240 });
  const photo2 = env.document.getElementById('gallery-photo-2');
  stubNatural(photo2, 1200, 800);
  stubRect(photo2, { top: 400, left: 380, width: 360, height: 240 });

  return { ...env, articleEl, icon, photo1, photo2 };
}

describe('heading-flex-inline-icon — 標題 flex 內 inline icon 的 gallery 誤傷', () => {
  it('inline icon 被標 data-jread-inline-img（前提 sanity）', () => {
    const { NS, articleEl, icon } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(icon.getAttribute('data-jread-inline-img'), '1',
      '30px rendered 的品牌 icon 必須走 rect fallback 標 inline');
  });

  it('gap 補償不對 inline icon 塞 inline margin-bottom（v1.7.29 guard）', () => {
    const { NS, articleEl, icon } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(icon.style.getPropertyValue('margin-bottom'), '',
      'inline icon 不可被 gallery gap 補償塞 margin-bottom（inline 圖的 ' +
      'margin-bottom 只會把圖沿 baseline 往上抬、不產生流間距）');
  });

  it('真 gallery 的大圖子仍照常拿到 margin-bottom:12px（v0.7.94 行為不可誤傷）', () => {
    const { NS, articleEl, photo1, photo2 } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(photo1.style.getPropertyValue('margin-bottom'), '12px',
      '真 gallery 攤平後大圖子必須有 gap 補償 margin-bottom');
    assert.strictEqual(photo2.style.getPropertyValue('margin-bottom'), '12px',
      '真 gallery 第二張大圖子必須有 gap 補償 margin-bottom');
  });

  it('注入 CSS 的 inline-img 規則含垂直 margin 歸零（擋站點 CSS 的 icon margin）', () => {
    const { NS, articleEl, document } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    const styleEl = document.getElementById('__jread-style');
    assert.ok(styleEl, '應有注入 style');
    // 抓 inline-img 規則區塊（img[data-jread-inline-img] { ... }）驗內容
    const m = styleEl.textContent.match(/img\[data-jread-inline-img\]\s*{[^}]*}/);
    assert.ok(m, '注入 CSS 應含 inline-img 規則');
    assert.ok(/margin-top:\s*0\s*!important/.test(m[0]),
      'inline-img 規則必須歸零 margin-top');
    assert.ok(/margin-bottom:\s*0\s*!important/.test(m[0]),
      'inline-img 規則必須歸零 margin-bottom（站點給 icon 的版面 margin 在 ' +
      'inline flow 是純錯位來源）');
  });

  it('restore() 後 icon 與 gallery 大圖的 inline style 全數還原', () => {
    const { NS, articleEl, icon, photo1 } = setup();
    const snapshot = NS.styler.apply(articleEl, SETTINGS);
    NS.styler.restore(articleEl, snapshot);
    assert.strictEqual(icon.getAttribute('data-jread-inline-img'), null,
      'restore 後 inline-img 標記應移除');
    assert.strictEqual(photo1.style.getPropertyValue('margin-bottom'), '',
      'restore 後 gallery 大圖的 gap 補償 margin 應還原');
  });
});
