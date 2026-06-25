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

  // a 包的縮小大圖（natural 1200、rect 56）→ v1.0.7 起同樣走 capIcon 釘小
  // （autocar 作者頭像 <a><img> 結構：舊行為被 tryMarkContentImg 標 content-img →
  // 放大滿欄溢出容器疊文；新行為 capIcon 釘回 rendered 寬）
  const linked = env.document.getElementById('linked-icon');
  stubNatural(linked, 1200, 1200); stubComplete(linked);
  stubRect(linked, { top: 900, left: 360, width: 56, height: 56 });

  // a 包的大內容圖（lightbox：natural 1200、rect 600 >= 200）→ 不命中 capIcon
  // 幾何 gate、照走 content-img 分支（forcing：確認移除 !closest('a') 後 lightbox 不退步）
  const linkedBig = env.document.getElementById('linked-content');
  if (linkedBig) { stubNatural(linkedBig, 1200, 800); stubComplete(linkedBig); stubRect(linkedBig, { top: 1100, left: 0, width: 600, height: 400 }); }

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

  it('a 包的縮小大圖（natural 1200 / rect 56）v1.0.7 起標 icon-img 釘小', () => {
    const { NS, articleEl, linked } = setup();
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(linked.getAttribute('data-jread-icon-img'), '1',
      'a 包的縮小大圖（autocar 作者頭像家族）必須走 capIcon 釘小；' +
      '舊行為被 tryMarkContentImg 標 content-img 放大滿欄、溢出容器疊到 bio 文字');
    assert.strictEqual(linked.style.getPropertyValue('max-width'), '56px',
      'inline max-width 釘回 rendered 寬 56px');
    assert.strictEqual(linked.style.getPropertyPriority('max-width'), 'important');
    assert.strictEqual(linked.getAttribute('data-jread-content-img'), null,
      '縮小頭像不可被標 content-img（capIcon 必須在 content-img 分支之前命中）');
  });

  it('a 包的大內容圖（lightbox：rect 600 >= 200）不命中 capIcon、仍標 content-img', () => {
    const { NS, articleEl, linkedBig } = setup();
    if (!linkedBig) return; // fixture 無此元素時跳過
    NS.styler.apply(articleEl, SETTINGS);
    assert.strictEqual(linkedBig.getAttribute('data-jread-icon-img'), null,
      'lightbox 大圖 render >= 200 不命中 capIcon 幾何 gate');
    assert.strictEqual(linkedBig.getAttribute('data-jread-content-img'), '1',
      '移除 !closest(a) 後 lightbox 大內容圖必須仍標 content-img（不退步）');
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
