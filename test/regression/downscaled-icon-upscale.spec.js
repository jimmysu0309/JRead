// JRead — 作者刻意縮小的小圖防放大 regression spec（v0.8.90）
//
// 根因（2026-06-16 Jimmy 回報 washingtonpost Opinion 文章「標題上方有額外的雜訊」）：
// WaPo Opinion 區的 lightbulb section badge 是裸 <img>（非 a 包），原站
// HTML width=160 height=160、CSS 顯示 56×56，但來源檔 natural 1200×1200。
// styler 的 inline-img 判定上限 INLINE_IMG_MAX=48、content-img 下限
// CONTENT_IMG_MIN=200——56px 落在兩門檻中間，兩邊都 miss，落入
// img:not(a>img) 的 width:auto → 退回 naturalWidth 1200 → max-width:100% cap
// 成 788px 巨圖佔滿標題上方（probe 實證 56→788）。
//
// 通則修法（結構性、不綁站點 class）：apply() 量 pre-reader rendered rect，
// 對「已載入、rect 兩維皆 48 < x < 200、且 natural 明顯大於 rendered」的裸 img
// 標 data-jread-icon-img + inline !important max-width 釘回原始顯示寬。
// natural ≈ rendered 的真實小圖不命中（width:auto 本來就不放大）。
//
// 本 spec 驗的訊號層：apply() 後 icon img 的 data-jread-icon-img 標記 + inline
// max-width 釘寬正確性 + restore() 可逆性。不驗實際視覺 layout（jsdom 不算
// layout；視覺由 Playwright harness 驗）。

const path = require('path');
const assert = require('assert');
const { loadFixtureWithScripts, stubRect } = require('../helpers');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'downscaled-icon-upscale.html');

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
function stubComplete(img) {
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
}

function setup() {
  const env = loadFixtureWithScripts({ fixturePath: FIXTURE_PATH, scripts: ['styler'] });
  const articleEl = env.document.querySelector('article');
  assert.ok(articleEl, 'fixture 應有 <article>');

  // 作者縮小的 section badge：natural 1200×1200、顯示 56×56 → 應被釘寬
  const icon = env.document.getElementById('downscaled-icon');
  stubNatural(icon, 1200, 1200); stubComplete(icon);
  stubRect(icon, { top: 10, left: 360, width: 56, height: 56 });

  // 內容照片：natural 與 rendered 都大（rect 576 >= 200）→ 不可釘寬
  const photo = env.document.getElementById('content-photo');
  stubNatural(photo, 1200, 800); stubComplete(photo);
  stubRect(photo, { top: 300, left: 0, width: 576, height: 384 });

  // 真實小圖（natural ≈ rendered，作者沒縮小）→ width:auto 本來就不放大、不釘
  const small = env.document.getElementById('genuine-small');
  stubNatural(small, 60, 60); stubComplete(small);
  stubRect(small, { top: 800, left: 360, width: 56, height: 56 });

  // a 包的 icon（natural 1200、rect 56）→ icon-link 結構、交給既有 a>img 規則、不走本支
  const linked = env.document.getElementById('linked-icon');
  stubNatural(linked, 1200, 1200); stubComplete(linked);
  stubRect(linked, { top: 900, left: 360, width: 56, height: 56 });

  return { ...env, articleEl, icon, photo, small, linked };
}

describe('downscaled-icon-upscale — 作者縮小的小圖不被 width:auto 反向放大（v0.8.90）', () => {
  it('裸 img（natural 1200 / rect 56）標 data-jread-icon-img', () => {
    const { NS, articleEl, icon } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(icon.getAttribute('data-jread-icon-img'), '1',
      'downscaled section badge 必須被標 icon-img（否則 width:auto 退回 natural 撐成滿版）');
  });

  it('icon img 的 inline max-width 釘回原始顯示寬（56px、!important）', () => {
    const { NS, articleEl, icon } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(icon.style.getPropertyValue('max-width'), '56px',
      'inline max-width 必須釘回 rendered 寬 56px');
    assert.strictEqual(icon.style.getPropertyPriority('max-width'), 'important',
      'max-width 必須 !important（蓋過 stylesheet 的 max-width:100%）');
  });

  it('內容照片（rect 576 >= 200）不可被標 icon-img', () => {
    const { NS, articleEl, photo } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(photo.getAttribute('data-jread-icon-img'), null,
      '正常內容圖不可誤標 icon（會被釘成小圖）');
    assert.strictEqual(photo.style.getPropertyValue('max-width'), '',
      '內容照片不可被加 inline max-width');
  });

  it('真實小圖（natural ≈ rendered，無放大）不可被標 icon-img', () => {
    const { NS, articleEl, small } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(small.getAttribute('data-jread-icon-img'), null,
      'natural ≈ rendered 的小圖 width:auto 本來就不放大、不必釘（避免無謂副作用）');
  });

  it('a 包的 icon（icon-link 結構）不走本支、不標 icon-img', () => {
    const { NS, articleEl, linked } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(linked.getAttribute('data-jread-icon-img'), null,
      'a > img 是 icon-link 結構，交給既有 :not(a>img) 排除 + a>img 規則處理');
  });

  it('restore() 移除 icon-img 標記與 inline max-width（可逆性）', () => {
    const { NS, articleEl, icon } = setup();
    const snapshot = NS.styler.apply(articleEl, SETTINGS);
    NS.styler.restore(articleEl, snapshot);
    assert.strictEqual(icon.getAttribute('data-jread-icon-img'), null,
      'restore 必須移除 data-jread-icon-img');
    assert.strictEqual(icon.style.getPropertyValue('max-width'), '',
      'restore 必須清掉注入的 inline max-width（原站無 inline max-width）');
  });
});
